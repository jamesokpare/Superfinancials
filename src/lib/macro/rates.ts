/**
 * Official interest-rate feeds (no key), replacing FRED reprints for the app's
 * yields and money-market rates. FRED's terms do not allow storing its data;
 * these publishers allow reuse with attribution:
 *
 *   U.S. Treasury   daily par yield curve (CSV)                        public domain
 *   New York Fed    SOFR, EFFR (Markets API, JSON)                     NY Fed terms: use and distribution allowed with credit
 *   Bank of England SONIA, nominal par gilt yields (IADB CSV)          Open Government Licence; SONIA attribution
 *   Bank of Canada  benchmark bond yields, CORRA (Valet JSON)          BoC terms: free use and redistribution
 *   ECB             €STR (Data API)                                    ECB reuse policy: free, source quoted, unmodified
 *
 * Yields go to app instruments (adm_inst/<id>); overnight rates become
 * economic series.
 */
import { ProviderError } from "@/lib/providers/http";
import { ecbSeries, parseCsv, type InstSeries, type MacroSeries, type Point } from "./sources";

const UA = { "user-agent": "Mozilla/5.0 (compatible; Superfinancials data sync; +https://github.com/jamesokpare/Superfinancials)" };
const sortPts = (pts: Point[]) => { const m = new Map(pts.map((p) => [p.t, p.v])); return [...m].sort(([a], [b]) => (a < b ? -1 : 1)).map(([t, v]) => ({ t, v })); };
const iso = (d: Date) => d.toISOString().slice(0, 10);
async function get(name: string, url: string, timeoutMs = 60_000): Promise<string> {
  let res: Response;
  try { res = await fetch(url, { headers: { ...UA, accept: "text/csv, application/json, */*" }, signal: AbortSignal.timeout(timeoutMs) }); }
  catch (e) { throw new ProviderError(name, `request failed: ${(e as Error).message}`); }
  const text = await res.text();
  if (!res.ok) throw new ProviderError(name, `HTTP ${res.status}: ${text.slice(0, 120)}`, res.status);
  return text;
}
const num = (s: unknown) => { const t = String(s ?? "").trim(); const v = Number(t); return t !== "" && t.toUpperCase() !== "N/A" && Number.isFinite(v) ? v : null; };

// --- U.S. Treasury par yield curve ----------------------------------------------------------------------
/** Column of the Treasury CSV → app instrument. */
export const UST_COLS: Record<string, string> = { "3 Mo": "YD.US3M", "1 Yr": "YD.US1Y", "2 Yr": "YD.US2", "5 Yr": "YD.US5", "10 Yr": "YD.US10", "30 Yr": "YD.US30" };
export async function treasuryCurve(now: Date, years = 2): Promise<InstSeries[]> {
  const by = new Map<string, Point[]>(); const errs: string[] = [];
  for (let y = now.getUTCFullYear() - years + 1; y <= now.getUTCFullYear(); y++) {
    try {
      // Responses take up to ~20 s.
      const rows = parseCsv(await get("U.S. Treasury", `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${y}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${y}&page&_format=csv`, 90_000));
      for (const r of rows) {
        const m = String(r.Date ?? "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/); if (!m) continue; const t = `${m[3]}-${m[1]}-${m[2]}`;
        for (const [col, id] of Object.entries(UST_COLS)) { const v = num(r[col]); if (v != null) (by.get(id) ?? by.set(id, []).get(id)!).push({ t, v }); }
      }
    } catch (e) { errs.push((e as Error).message); }
  }
  if (!by.size) throw errs.length ? new Error(errs[0]) : new ProviderError("U.S. Treasury", "no yields in the CSV");
  return [...by].map(([id, pts]) => ({ id, points: sortPts(pts), src: "U.S. Treasury", note: `U.S. Treasury daily par yield curve rate (${Object.keys(UST_COLS).find((k) => UST_COLS[k] === id)}), %. Public domain. home.treasury.gov` }));
}

// --- New York Fed reference rates -------------------------------------------------------------------------
const NYFED_CREDIT = "Content from the New York Fed subject to the Terms of Use at newyorkfed.org.";
async function nyFedRate(path: string, from: string, to: string): Promise<Point[]> {
  const r = JSON.parse(await get("New York Fed", `https://markets.newyorkfed.org/api/rates/${path}/search.json?startDate=${from}&endDate=${to}`)) as { refRates?: { effectiveDate?: string; percentRate?: number | string }[] };
  return sortPts((r.refRates ?? []).flatMap((x) => { const v = num(x.percentRate); return x.effectiveDate && /^\d{4}-\d{2}-\d{2}$/.test(x.effectiveDate) && v != null ? [{ t: x.effectiveDate, v }] : []; }));
}
export async function nyFed(now: Date): Promise<{ instruments: InstSeries[]; series: MacroSeries[] }> {
  const from = iso(new Date(now.getTime() - 730 * 864e5)), to = iso(now);
  const [sofr, effr] = await Promise.all([nyFedRate("secured/sofr", from, to), nyFedRate("unsecured/effr", from, to)]);
  if (!sofr.length && !effr.length) throw new ProviderError("New York Fed", "no SOFR or EFFR observations returned");
  return {
    instruments: sofr.length ? [{ id: "MM.SOFR", points: sofr, src: "Federal Reserve Bank of New York", note: `Secured Overnight Financing Rate (SOFR), %, by business day. ${NYFED_CREDIT}` }] : [],
    series: effr.length ? [{ cc: "US", code: "EFFR", name: "Effective federal funds rate", unit: "%", cat: "mp", freq: "D", src: "Federal Reserve Bank of New York", url: "https://www.newyorkfed.org/markets/reference-rates/effr", notes: `Daily effective federal funds rate. ${NYFED_CREDIT}`, points: effr }] : [],
  };
}

// --- Bank of England (IADB) ---------------------------------------------------------------------------------
const MON: Record<string, string> = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };
/** IADB series → [instrument id or series code, label]. */
export const BOE_SERIES: Record<string, [string, string]> = { IUDSOIA: ["SONIA", "Sterling overnight index average (SONIA)"], IUDSNPY: ["YD.UK5", "5-year nominal par gilt yield"], IUDMNPY: ["YD.UK10", "10-year nominal par gilt yield"] };
export async function boe(now: Date): Promise<{ instruments: InstSeries[]; series: MacroSeries[] }> {
  const d = new Date(now.getTime() - 730 * 864e5); const from = `${String(d.getUTCDate()).padStart(2, "0")}/${Object.keys(MON)[d.getUTCMonth()]}/${d.getUTCFullYear()}`;
  // The IADB answers library user agents with an error page, so a browser-like one is sent.
  const text = await get("Bank of England", `https://www.bankofengland.co.uk/boeapps/database/_iadb-fromshowcolumns.asp?csv.x=yes&Datefrom=${from}&Dateto=now&SeriesCodes=${Object.keys(BOE_SERIES).join(",")}&CSVF=TN&UsingCodes=Y&VPD=Y&VFD=N`);
  if (/<html/i.test(text.slice(0, 500))) throw new ProviderError("Bank of England", "returned a web page instead of CSV");
  const by = new Map<string, Point[]>();
  for (const r of parseCsv(text)) {
    const m = String(r.DATE ?? "").match(/^(\d{1,2}) (\w{3}) (\d{4})$/); if (!m || !MON[m[2]]) continue; const t = `${m[3]}-${MON[m[2]]}-${m[1].padStart(2, "0")}`;
    for (const code of Object.keys(BOE_SERIES)) { const v = num(r[code]); if (v != null) (by.get(code) ?? by.set(code, []).get(code)!).push({ t, v }); }
  }
  if (!by.size) throw new ProviderError("Bank of England", "no observations in the CSV");
  const credit = "Bank of England Database, Open Government Licence v3.0.";
  const instruments: InstSeries[] = []; const series: MacroSeries[] = [];
  for (const [code, pts] of by) {
    const [id, label] = BOE_SERIES[code];
    if (id.startsWith("YD.")) instruments.push({ id, points: sortPts(pts), src: "Bank of England", note: `${label} (IADB ${code}), %. ${credit}` });
    else series.push({ cc: "UK", code: id, name: label, unit: "%", cat: "mp", freq: "D", src: "Bank of England", url: "https://www.bankofengland.co.uk/markets/sonia-benchmark", notes: `IADB ${code}. SONIA is administered by the Bank of England; ${credit}`, points: sortPts(pts) });
  }
  return { instruments, series };
}

// --- Bank of Canada (Valet) -----------------------------------------------------------------------------------
export const BOC_YIELDS: Record<string, string> = { "BD.CDN.2YR.DQ.YLD": "YD.CA2", "BD.CDN.5YR.DQ.YLD": "YD.CA5", "BD.CDN.10YR.DQ.YLD": "YD.CA10", "BD.CDN.LONG.DQ.YLD": "YD.CA30" };
type Valet = { observations?: ({ d?: string } & Record<string, { v?: string } | string | undefined>)[] };
const valetPts = (r: Valet, key: string) => sortPts((r.observations ?? []).flatMap((o) => { const v = num((o[key] as { v?: string } | undefined)?.v); return o.d && /^\d{4}-\d{2}-\d{2}$/.test(o.d) && v != null ? [{ t: o.d, v }] : []; }));
export async function boc(now: Date): Promise<{ instruments: InstSeries[]; series: MacroSeries[] }> {
  const from = iso(new Date(now.getTime() - 730 * 864e5)); const base = "https://www.bankofcanada.ca/valet/observations";
  const [y, c] = await Promise.all([
    get("Bank of Canada", `${base}/group/bond_yields_benchmark/json?start_date=${from}`).then((t) => JSON.parse(t) as Valet),
    get("Bank of Canada", `${base}/AVG.INTWO/json?start_date=${from}`).then((t) => JSON.parse(t) as Valet).catch(() => ({}) as Valet),
  ]);
  const credit = "Bank of Canada (Valet API); free use and redistribution under the Bank of Canada terms.";
  const instruments = Object.entries(BOC_YIELDS).flatMap(([k, id]) => { const pts = valetPts(y, k); return pts.length ? [{ id, points: pts, src: "Bank of Canada", note: `Government of Canada benchmark bond yield (${k}${k.includes("LONG") ? ", long-term" : ""}), %. ${credit}` }] : []; });
  const corra = valetPts(c, "AVG.INTWO");
  if (!instruments.length && !corra.length) throw new ProviderError("Bank of Canada", "no benchmark yields returned");
  return { instruments, series: corra.length ? [{ cc: "CA", code: "CORRA", name: "Canadian overnight repo rate average (CORRA)", unit: "%", cat: "mp", freq: "D", src: "Bank of Canada", url: "https://www.bankofcanada.ca/rates/interest-rates/corra/", notes: credit, points: corra }] : [] };
}

// --- ECB €STR ---------------------------------------------------------------------------------------------------
export async function estr(now: Date): Promise<MacroSeries[]> {
  const pts = sortPts((await ecbSeries("EST", "B.EU000A2X2A25.WT", iso(new Date(now.getTime() - 730 * 864e5)))).flatMap((x) => (/^\d{4}-\d{2}-\d{2}$/.test(x.t) ? [x] : [])));
  if (!pts.length) throw new ProviderError("ECB", "no €STR observations returned");
  return [{ cc: "EU", code: "ESTR", name: "Euro short-term rate (€STR)", unit: "%", cat: "mp", freq: "D", src: "European Central Bank", url: "https://data.ecb.europa.eu/data/datasets/EST", notes: "Volume-weighted trimmed mean rate, by business day. Source: ECB Data Portal (unmodified).", points: pts }];
}

// --- CFTC Commitments of Traders (positioning) ----------------------------------------------------------------
/** Legacy futures-only report: contract market code → [series code, market]. Public domain (CFTC). */
export const COT_MARKETS: Record<string, [string, string]> = {
  "067651": ["COT.CL", "WTI crude oil (NYMEX)"], "023651": ["COT.NG", "Henry Hub natural gas (NYMEX)"], "088691": ["COT.GC", "Gold (COMEX)"], "084691": ["COT.SI", "Silver (COMEX)"],
  "085692": ["COT.HG", "Copper (COMEX)"], "002602": ["COT.ZC", "Corn (CBOT)"], "005602": ["COT.ZS", "Soybeans (CBOT)"], "001602": ["COT.ZW", "Wheat, SRW (CBOT)"],
  "073732": ["COT.CC", "Cocoa (ICE US)"], "083731": ["COT.KC", "Coffee C (ICE US)"], "080732": ["COT.SB", "Sugar No. 11 (ICE US)"],
  "13874A": ["COT.ES", "E-mini S&P 500 (CME)"], "043602": ["COT.TY", "10-year U.S. Treasury note (CBOT)"], "099741": ["COT.EUR", "Euro FX (CME)"], "097741": ["COT.JPY", "Japanese yen (CME)"],
};
type CotRow = { report_date_as_yyyy_mm_dd?: string; cftc_contract_market_code?: string; noncomm_positions_long_all?: string; noncomm_positions_short_all?: string };
export async function cftcCot(now: Date): Promise<MacroSeries[]> {
  const from = iso(new Date(now.getTime() - 3 * 365 * 864e5));
  const where = `cftc_contract_market_code in(${Object.keys(COT_MARKETS).map((c) => `'${c}'`).join(",")}) AND report_date_as_yyyy_mm_dd >= '${from}T00:00:00'`;
  const url = `https://publicreporting.cftc.gov/resource/6dca-aqww.json?$select=report_date_as_yyyy_mm_dd,cftc_contract_market_code,noncomm_positions_long_all,noncomm_positions_short_all&$where=${encodeURIComponent(where)}&$order=report_date_as_yyyy_mm_dd&$limit=5000`;
  const rows = JSON.parse(await get("CFTC", url)) as CotRow[];
  if (!Array.isArray(rows)) throw new ProviderError("CFTC", "unexpected response");
  const by = new Map<string, Point[]>();
  for (const r of rows) {
    const code = String(r.cftc_contract_market_code ?? "").trim(); const t = String(r.report_date_as_yyyy_mm_dd ?? "").slice(0, 10);
    const l = num(r.noncomm_positions_long_all), s = num(r.noncomm_positions_short_all);
    if (!COT_MARKETS[code] || !/^\d{4}-\d{2}-\d{2}$/.test(t) || l == null || s == null) continue;
    (by.get(code) ?? by.set(code, []).get(code)!).push({ t, v: l - s });
  }
  if (!by.size) throw new ProviderError("CFTC", `no positions returned (${rows.length} rows)`);
  return [...by].map(([code, pts]) => { const [c, name] = COT_MARKETS[code]; return { cc: "US", code: c, name: `Speculative net position: ${name}`, unit: "contracts", cat: "mk" as const, freq: "W" as const, src: "CFTC Commitments of Traders", url: "https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm", notes: `Non-commercial long minus short, futures only (legacy report, contract ${code}), as of each Tuesday; published Fridays. Public domain; source: CFTC.`, points: sortPts(pts) }; });
}
