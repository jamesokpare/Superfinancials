/**
 * Free official sources for the daily macro sync. None needs a key except FRED
 * (already configured for prices). Each fetcher returns plain series or events;
 * src/lib/macro/sync.ts turns them into the app's data-desk documents.
 *
 *   World Bank   annual indicators, ~105 countries        CC BY 4.0
 *   BIS          central-bank policy rates (WS_CBPOL)       free with attribution
 *   ECB          euro-area HICP and deposit facility rate   free with attribution
 *   OECD         monthly CPI inflation, OECD + partners     CC BY 4.0
 *   FRED         U.S. release dates (economic calendar)     FRED terms
 *   US Treasury  upcoming auctions (FiscalData)             public domain
 *
 * Responses are read by column / field name, never by position, so a provider
 * adding columns does not break the parser.
 */
import { buildUrl, getJson, ProviderError, requireKey } from "@/lib/providers/http";
import { envKey } from "@/lib/providers/http";
import { ETF, US_EQUITIES } from "@/lib/market/instruments";

export type Point = { t: string; v: number };
export type MacroSeries = {
  cc: string; code: string; name: string; unit: string; cat: "gr" | "in" | "lb" | "mp" | "fs" | "ex" | "mk" | "ot";
  freq: "D" | "W" | "M" | "Q" | "A"; mi?: string; src: string; url: string; notes: string; points: Point[];
};
export type CalEvent = { id: string; title: string; date: string; time?: string; cc: string; cat: string; imp: 1 | 2 | 3; unit?: string; cons?: string; prior?: string; actual?: string; srcName: string; url: string; notes?: string; ids?: string[] };

const UA = { "user-agent": "Superfinancials data sync (https://github.com/jamesokpare/Superfinancials)" };
/** The app says UK and EU; registers use GB and (World Bank) EUU / (BIS, ECB) XM / U2. */
export const toApp = (c: string) => ({ GB: "UK", XM: "EU", U2: "EU", EUU: "EU", EMU: "EU" } as Record<string, string>)[c.toUpperCase()] ?? c.toUpperCase();

/** Minimal RFC 4180 CSV parser (quoted fields, doubled quotes, CRLF). */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []; let row: string[] = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; continue; }
    if (ch === '"') q = true; else if (ch === ",") { row.push(f); f = ""; } else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(f); rows.push(row); row = []; f = ""; } else f += ch;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const head = (rows.shift() ?? []).map((h) => h.split(":")[0].trim().replace(/^﻿/, "")); // "REF_AREA:Reference area" → "REF_AREA"
  return rows.filter((r) => r.length > 1 || r[0]).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}
async function getCsv(name: string, url: URL, timeoutMs = 60_000): Promise<Record<string, string>[]> {
  let res: Response;
  try { res = await fetch(url, { headers: { ...UA, accept: "text/csv, application/vnd.sdmx.data+csv, */*" }, signal: AbortSignal.timeout(timeoutMs) }); }
  catch (e) { throw new ProviderError(name, `request failed: ${(e as Error).message}`); }
  const text = await res.text();
  if (!res.ok) throw new ProviderError(name, `HTTP ${res.status}: ${text.slice(0, 160)}`, res.status);
  return parseCsv(text);
}
/** "2026-09", "2026-M09", "2026-Q3", "2026" → the last day of that period (how the app dates macro series). */
export function periodEnd(p: string): string | null {
  const s = p.trim(); let m: RegExpMatchArray | null;
  const last = (y: number, mo: number) => new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) return s;
  if ((m = s.match(/^(\d{4})-?M?(\d{2})$/))) return last(+m[1], +m[2]);
  if ((m = s.match(/^(\d{4})-?Q([1-4])$/))) return last(+m[1], +m[2] * 3);
  if ((m = s.match(/^(\d{4})$/))) return `${m[1]}-12-31`;
  return null;
}
const sortPts = (pts: Point[]) => { const m = new Map(pts.map((p) => [p.t, p.v])); return [...m].sort(([a], [b]) => (a < b ? -1 : 1)).map(([t, v]) => ({ t, v })); };
/** Daily → last observation of each month. */
const monthly = (pts: Point[]) => { const m = new Map<string, Point>(); for (const p of sortPts(pts)) m.set(p.t.slice(0, 7), p); return [...m.values()].map((p) => ({ t: periodEnd(p.t.slice(0, 7))!, v: p.v })); };

// --- World Bank ---------------------------------------------------------------------
export const WB_INDICATORS: { id: string; code: string; name: string; unit: string; cat: MacroSeries["cat"]; dp: number }[] = [
  { id: "NY.GDP.MKTP.KD.ZG", code: "GDPA", name: "Real GDP growth (annual)", unit: "% y/y", cat: "gr", dp: 2 },
  { id: "NY.GDP.MKTP.CD", code: "GDPUSD", name: "GDP (current US$)", unit: "US$ bn", cat: "gr", dp: 1 },
  { id: "NY.GDP.PCAP.CD", code: "GDPPC", name: "GDP per capita (current US$)", unit: "US$", cat: "gr", dp: 0 },
  { id: "FP.CPI.TOTL.ZG", code: "CPIA", name: "Consumer price inflation (annual)", unit: "% y/y", cat: "in", dp: 2 },
  { id: "SL.UEM.TOTL.ZS", code: "URA", name: "Unemployment rate (annual, ILO estimate)", unit: "%", cat: "lb", dp: 2 },
  { id: "BN.CAB.XOKA.GD.ZS", code: "CAGDP", name: "Current account balance", unit: "% of GDP", cat: "ex", dp: 2 },
  { id: "NE.EXP.GNFS.ZS", code: "EXPGDP", name: "Exports of goods and services", unit: "% of GDP", cat: "ex", dp: 1 },
  { id: "BX.KLT.DINV.WD.GD.ZS", code: "FDIGDP", name: "Foreign direct investment, net inflows", unit: "% of GDP", cat: "ex", dp: 2 },
  { id: "GC.DOD.TOTL.GD.ZS", code: "DEBTGDP", name: "Central government debt", unit: "% of GDP", cat: "fs", dp: 1 },
  { id: "SP.POP.TOTL", code: "POP", name: "Population", unit: "million", cat: "ot", dp: 2 },
];
type WbRow = { indicator?: { id?: string }; country?: { id?: string }; countryiso3code?: string; date?: string; value?: number | null };
/** All indicators for the given app country codes, one request per indicator (paged). */
export async function worldBank(countries: string[], from: number, now = new Date()): Promise<MacroSeries[]> {
  const wb = countries.map((c) => ({ UK: "GB", EU: "EUU" } as Record<string, string>)[c] ?? c).join(";");
  const out: MacroSeries[] = []; const errors: string[] = [];
  for (const ind of WB_INDICATORS) {
    const rows: WbRow[] = [];
    try {
      for (let page = 1; page <= 10; page++) {
        const r = await getJson<[{ pages?: number; total?: number; message?: unknown }, WbRow[] | null]>("World Bank", buildUrl("https://api.worldbank.org/v2", `/country/${wb}/indicator/${ind.id}`, { format: "json", date: `${from}:${now.getUTCFullYear()}`, per_page: 5000, page }), { timeoutMs: 60_000, init: { headers: UA } });
        // [{ total: 0 }, null] = no data; [{ message: [...] }] = an error.
        if (!Array.isArray(r) || r[0]?.message) throw new ProviderError("World Bank", `${ind.id}: ${JSON.stringify(r?.[0]?.message ?? r).slice(0, 160)}`);
        if (!Array.isArray(r[1])) break;
        rows.push(...r[1]); if (!(r[0]?.pages && page < r[0].pages)) break;
      }
    } catch (e) { errors.push((e as Error).message); continue; }
    const by = new Map<string, Point[]>();
    for (const x of rows) {
      const cc = x.country?.id ? toApp(x.country.id === "EU" ? "EUU" : x.country.id) : null; const v = x.value; const t = x.date ? periodEnd(x.date) : null;
      if (!cc || v == null || !Number.isFinite(v) || !t) continue;
      const val = ind.unit === "US$ bn" ? v / 1e9 : ind.unit === "million" ? v / 1e6 : v;
      (by.get(cc) ?? by.set(cc, []).get(cc)!).push({ t, v: Number(val.toFixed(ind.dp)) });
    }
    for (const [cc, pts] of by) out.push({ cc, code: ind.code, name: ind.name, unit: ind.unit, cat: ind.cat, freq: "A", src: "World Bank (World Development Indicators)", url: `https://data.worldbank.org/indicator/${ind.id}`, notes: `World Bank indicator ${ind.id}. Annual; latest year can lag by 6–18 months. CC BY 4.0.`, points: sortPts(pts) });
  }
  // One indicator failing loses only that indicator; all of them failing fails the source.
  if (errors.length === WB_INDICATORS.length) throw new ProviderError("World Bank", errors[0]);
  return out;
}

// --- BIS central-bank policy rates ----------------------------------------------------------
export async function bisPolicyRates(from: string): Promise<MacroSeries[]> {
  const rows = await getCsv("BIS", buildUrl("https://stats.bis.org/api/v1", "/data/WS_CBPOL/M.", { startPeriod: from, format: "csv" }));
  const by = new Map<string, Point[]>();
  for (const r of rows) {
    const cc = r.REF_AREA ? toApp(r.REF_AREA) : ""; const t = periodEnd(r.TIME_PERIOD ?? ""); const v = Number(r.OBS_VALUE);
    if (!cc || !/^[A-Z]{2}$/.test(cc) || !t || r.OBS_VALUE === "" || !Number.isFinite(v)) continue;
    (by.get(cc) ?? by.set(cc, []).get(cc)!).push({ t, v });
  }
  if (!rows.length) throw new ProviderError("BIS", "no rows returned");
  return [...by].map(([cc, pts]) => ({ cc, code: "POLR", name: "Central bank policy rate", unit: "%", cat: "mp" as const, freq: "M" as const, mi: "POL", src: "BIS central bank policy rates", url: "https://data.bis.org/topics/CBPOL", notes: "Bank for International Settlements, WS_CBPOL; end-of-month policy rate as reported by the central bank.", points: sortPts(pts) }));
}

// --- ECB ----------------------------------------------------------------------------------------
async function ecbSeries(flow: string, key: string, from: string) {
  const rows = await getCsv("ECB", buildUrl("https://data-api.ecb.europa.eu/service", `/data/${flow}/${key}`, { startPeriod: from, format: "csvdata" }));
  return rows.flatMap((r) => { const v = Number(r.OBS_VALUE); const t = r.TIME_PERIOD; return t && r.OBS_VALUE !== "" && Number.isFinite(v) ? [{ t, v }] : []; });
}
export async function ecb(from: string): Promise<MacroSeries[]> {
  const [hicp, dfr] = await Promise.all([ecbSeries("ICP", "M.U2.N.000000.4.ANR", from.slice(0, 7)), ecbSeries("FM", "D.U2.EUR.4F.KR.DFR.LEV", from)]);
  const out: MacroSeries[] = [];
  if (hicp.length) out.push({ cc: "EU", code: "HICP", name: "HICP inflation (euro area)", unit: "% y/y", cat: "in", freq: "M", mi: "CPI", src: "European Central Bank", url: "https://data.ecb.europa.eu/data/datasets/ICP", notes: "ECB Data Portal, ICP.M.U2.N.000000.4.ANR (Eurostat HICP, annual rate of change).", points: sortPts(hicp.map((p) => ({ t: periodEnd(p.t)!, v: p.v }))) });
  if (dfr.length) out.push({ cc: "EU", code: "DFR", name: "ECB deposit facility rate", unit: "%", cat: "mp", freq: "M", src: "European Central Bank", url: "https://data.ecb.europa.eu/data/datasets/FM", notes: "ECB Data Portal, FM.D.U2.EUR.4F.KR.DFR.LEV; month-end level.", points: monthly(dfr) });
  if (!out.length) throw new ProviderError("ECB", "no observations returned");
  return out;
}

// --- OECD monthly CPI --------------------------------------------------------------------------
/** ISO3 used by OECD → app code. */
export const OECD_AREAS: Record<string, string> = { USA: "US", GBR: "UK", JPN: "JP", CAN: "CA", AUS: "AU", DEU: "DE", FRA: "FR", ITA: "IT", ESP: "ES", NLD: "NL", BEL: "BE", AUT: "AT", IRL: "IE", PRT: "PT", GRC: "GR", FIN: "FI", SWE: "SE", NOR: "NO", DNK: "DK", CHE: "CH", POL: "PL", CZE: "CZ", HUN: "HU", KOR: "KR", MEX: "MX", TUR: "TR", CHL: "CL", COL: "CO", ISR: "IL", NZL: "NZ", BRA: "BR", IND: "IN", IDN: "ID", ZAF: "ZA", CHN: "CN", SAU: "SA", ARG: "AR" };
export async function oecdCpi(from: string): Promise<MacroSeries[]> {
  const key = `${Object.keys(OECD_AREAS).join("+")}.M.N.CPI.PA._T.N.GY`;
  const rows = await getCsv("OECD", buildUrl("https://sdmx.oecd.org/public/rest", `/data/OECD.SDD.TPS,DSD_PRICES@DF_PRICES_ALL,1.0/${key}`, { startPeriod: from.slice(0, 7), format: "csvfile" }), 90_000);
  const by = new Map<string, Point[]>();
  for (const r of rows) {
    const cc = OECD_AREAS[r.REF_AREA ?? ""]; const t = periodEnd(r.TIME_PERIOD ?? ""); const v = Number(r.OBS_VALUE);
    if (!cc || !t || r.OBS_VALUE === "" || !Number.isFinite(v)) continue;
    (by.get(cc) ?? by.set(cc, []).get(cc)!).push({ t, v: Number(v.toFixed(2)) });
  }
  if (!by.size) throw new ProviderError("OECD", `no CPI rows returned (${rows.length} rows read)`);
  return [...by].map(([cc, pts]) => ({ cc, code: "CPIM", name: "Consumer price inflation (monthly)", unit: "% y/y", cat: "in" as const, freq: "M" as const, mi: "CPI", src: "OECD consumer prices", url: "https://data-explorer.oecd.org/", notes: "OECD Prices database (DF_PRICES_ALL): CPI, all items, growth over the same month a year earlier. CC BY 4.0.", points: sortPts(pts) }));
}

// --- FRED release dates → U.S. economic calendar -------------------------------------------
/** Major U.S. releases by FRED release id: [title, importance, instruments it moves]. */
export const FRED_RELEASES: Record<number, [string, 1 | 2 | 3, string[]]> = {
  10: ["U.S. CPI", 3, ["YD.US2", "IX.SPX"]], 50: ["U.S. employment report (nonfarm payrolls)", 3, ["YD.US2", "IX.SPX"]],
  53: ["U.S. GDP", 3, ["IX.SPX"]], 54: ["U.S. personal income and outlays (PCE prices)", 3, ["YD.US2"]],
  46: ["U.S. producer prices (PPI)", 2, ["YD.US2"]], 9: ["U.S. retail sales", 2, ["IX.SPX"]],
  13: ["U.S. industrial production", 2, []], 180: ["U.S. weekly jobless claims", 2, ["YD.US2"]],
  192: ["U.S. JOLTS job openings", 2, []], 51: ["U.S. international trade", 1, ["FX.DXY"]],
  91: ["U.S. University of Michigan consumer sentiment", 1, []], 27: ["U.S. housing starts", 1, []],
};
export async function fredReleaseCalendar(now: Date, daysAhead = 45): Promise<CalEvent[]> {
  const key = requireKey("FRED", "FRED_API_KEY"); const start = now.toISOString().slice(0, 10); const end = new Date(now.getTime() + daysAhead * 864e5).toISOString().slice(0, 10);
  const r = await getJson<{ release_dates?: { release_id: number; release_name?: string; date: string }[] }>("FRED", buildUrl("https://api.stlouisfed.org/fred", "/releases/dates", { api_key: key, file_type: "json", realtime_start: start, realtime_end: end, include_release_dates_with_no_data: "true", limit: 1000, sort_order: "asc" }));
  return (r.release_dates ?? []).filter((x) => FRED_RELEASES[x.release_id] && x.date >= start && x.date <= end).map((x) => {
    const [title, imp, ids] = FRED_RELEASES[x.release_id];
    return { id: `fred-${x.release_id}-${x.date}`, title, date: x.date, cc: "US", cat: "eco", imp, srcName: "FRED release calendar (St. Louis Fed)", url: `https://fred.stlouisfed.org/releases/calendar`, notes: "Scheduled release date from the official U.S. statistical calendar. Consensus and actual values are not part of this source.", ids };
  });
}

// --- U.S. Treasury upcoming auctions ------------------------------------------------------------
type Auction = { record_date?: string; security_type?: string; security_term?: string; reopening?: string; cusip?: string; offering_amt?: string; announcemt_date?: string; auction_date?: string; issue_date?: string };
export async function treasuryAuctions(): Promise<CalEvent[]> {
  const r = await getJson<{ data?: Auction[] }>("US Treasury", buildUrl("https://api.fiscaldata.treasury.gov/services/api/fiscal_service", "/v1/accounting/od/upcoming_auctions", { "page[size]": 100, sort: "auction_date" }), { init: { headers: UA } });
  return (r.data ?? []).filter((a) => a.auction_date && /^\d{4}-\d{2}-\d{2}$/.test(a.auction_date) && a.security_term).map((a) => {
    const amt = Number(a.offering_amt); const term = String(a.security_term); const type = String(a.security_type ?? "Treasury");
    const ten = /10-Year|20-Year|30-Year/.test(term);
    return { id: `ust-${a.auction_date}-${(a.cusip || term).replace(/[^A-Za-z0-9]/g, "")}`, title: `U.S. Treasury ${term} ${type} auction${a.reopening === "Yes" ? " (reopening)" : ""}`, date: a.auction_date!, cc: "US", cat: "auc", imp: ten ? 2 : 1, unit: "US$ bn",
      srcName: "U.S. Treasury FiscalData (upcoming auctions)", url: "https://fiscaldata.treasury.gov/datasets/upcoming-auctions/", notes: `${Number.isFinite(amt) && amt > 0 ? `Offering US$${(amt / 1e9).toFixed(1)} bn. ` : ""}CUSIP ${a.cusip || "—"}; announced ${a.announcemt_date || "—"}, issue date ${a.issue_date || "—"}.`, ids: ten ? ["YD.US10"] : ["YD.US2"] };
  });
}

// --- economic, dividend and IPO calendars from the connected providers (FMP first, EODHD as fallback) ---------
const slug = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
const num = (v: unknown) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? "" : String(Number(v)));
const dayAdd = (now: Date, d: number) => new Date(now.getTime() + d * 864e5).toISOString().slice(0, 10);
const fmp = <T>(path: string, q: Record<string, string | number>) => getJson<T>("Financial Modeling Prep", buildUrl("https://financialmodelingprep.com/stable", path, { ...q, apikey: requireKey("Financial Modeling Prep", "FMP_API_KEY") }), { inBodyError: (b) => (b && typeof b === "object" && !Array.isArray(b) ? String((b as Record<string, unknown>)["Error Message"] ?? "") || undefined : undefined) });
const eod = <T>(path: string, q: Record<string, string | number>) => getJson<T>("EODHD", buildUrl("https://eodhd.com/api", path, { ...q, api_token: requireKey("EODHD", "EODHD_API_KEY"), fmt: "json" }));
/** Tries each configured provider in order; returns the first that answers, with the errors of those that didn't. */
async function firstOf<T>(tries: [string, string, () => Promise<T>][]): Promise<T> {
  const errs: string[] = [];
  for (const [name, env, fn] of tries) { if (!envKey(env)) continue; try { return await fn(); } catch (e) { errs.push(`${name}: ${(e as Error).message}`); } }
  throw new ProviderError("calendar", errs.length ? errs.join(" | ") : `none of ${tries.map((t) => t[1]).join(", ")} is set`);
}
const splitDt = (d: string) => { const m = String(d).match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?/); return m ? { date: m[1], time: m[2] && m[2] !== "00:00" ? m[2] : "" } : null; };

type FmpEco = { date?: string; country?: string; event?: string; previous?: unknown; estimate?: unknown; actual?: unknown; impact?: string; unit?: string };
type EodEco = { type?: string; comparison?: string; period?: string; country?: string; date?: string; actual?: unknown; previous?: unknown; estimate?: unknown };
/** Economic releases with consensus and actuals, last 10 days to 30 days ahead, medium and high importance. */
export async function econCalendar(now: Date, countries: Set<string>): Promise<CalEvent[]> {
  const from = dayAdd(now, -10), to = dayAdd(now, 30);
  const mk = (src: string, cc: string, title: string, dt: { date: string; time: string }, imp: 1 | 2 | 3, x: { prior?: unknown; cons?: unknown; actual?: unknown; unit?: string }): CalEvent =>
    ({ id: `eco-${dt.date}-${cc.toLowerCase()}-${slug(title)}`, title, date: dt.date, time: dt.time, cc, cat: "eco", imp, unit: x.unit ?? "", prior: num(x.prior), cons: num(x.cons), actual: num(x.actual), srcName: src, url: src.startsWith("Financial") ? "https://site.financialmodelingprep.com/developer/docs/stable/economics-calendar" : "https://eodhd.com/financial-apis/economic-events-data-api", notes: "Consensus and actual as published by the data provider." });
  return firstOf<CalEvent[]>([
    ["FMP", "FMP_API_KEY", async () => (await fmp<FmpEco[]>("/economic-calendar", { from, to })).flatMap((x) => {
      const cc = toApp(String(x.country ?? "")); const dt = splitDt(String(x.date ?? "")); const imp = /high/i.test(String(x.impact)) ? 3 : /medium/i.test(String(x.impact)) ? 2 : 1;
      return cc && countries.has(cc) && dt && x.event && imp >= 2 ? [mk("Financial Modeling Prep economic calendar", cc, String(x.event), dt, imp as 2 | 3, { prior: x.previous, cons: x.estimate, actual: x.actual, unit: x.unit })] : [];
    })],
    ["EODHD", "EODHD_API_KEY", async () => (await eod<EodEco[]>("/economic-events", { from, to, limit: 1000 })).flatMap((x) => {
      const cc = toApp(String(x.country ?? "")); const dt = splitDt(String(x.date ?? ""));
      // EODHD has no importance field: keep the major economies' releases that carry a consensus figure.
      return cc && countries.has(cc) && dt && x.type && x.estimate != null ? [mk("EODHD economic events", cc, `${x.type}${x.period ? ` (${x.period})` : ""}`, dt, 2, { prior: x.previous, cons: x.estimate, actual: x.actual })] : [];
    })],
  ]);
}

type FmpDiv = { symbol?: string; date?: string; recordDate?: string; paymentDate?: string; declarationDate?: string; dividend?: unknown; adjDividend?: unknown; yield?: unknown; frequency?: string };
/** Ex-dividend dates for the tracked U.S. stocks and ETFs, next 60 days. */
export async function dividendCalendar(now: Date): Promise<CalEvent[]> {
  const ids = new Map<string, string>([...US_EQUITIES.split(" ").map((t) => [t, `EQ.${t}`] as const), ...ETF.split(" ").map((t) => [t, `ET.${t}`] as const)]);
  const rows = await fmp<FmpDiv[]>("/dividends-calendar", { from: dayAdd(now, -3), to: dayAdd(now, 60) });
  return rows.flatMap((x) => {
    const id = ids.get(String(x.symbol ?? "")); const dt = splitDt(String(x.date ?? "")); const amt = num(x.dividend ?? x.adjDividend);
    if (!id || !dt) return [];
    return [{ id: `div-${dt.date}-${slug(String(x.symbol))}`, title: `${x.symbol} ex-dividend${amt ? ` ($${amt})` : ""}`, date: dt.date, cc: "US", cat: "div", imp: 1 as const, unit: "US$", srcName: "Financial Modeling Prep dividend calendar", url: "https://site.financialmodelingprep.com/developer/docs/stable/dividends-calendar", notes: `Record date ${x.recordDate || "—"}, payment ${x.paymentDate || "—"}${x.frequency ? `, ${String(x.frequency).toLowerCase()}` : ""}${num(x.yield) ? `; yield ${Number(x.yield).toFixed(2)}%` : ""}.`, ids: [id] }];
  });
}

type FmpIpo = { symbol?: string; date?: string; company?: string; exchange?: string; actions?: string; shares?: unknown; priceRange?: string; marketCap?: unknown };
type EodIpo = { code?: string; name?: string; exchange?: string; start_date?: string; price_from?: unknown; price_to?: unknown; offer_price?: unknown; shares?: unknown; deal_type?: string };
/** Upcoming IPOs (next 30 days). */
export async function ipoCalendar(now: Date): Promise<CalEvent[]> {
  const from = dayAdd(now, -2), to = dayAdd(now, 30);
  const mk = (src: string, url: string, sym: string, name: string, exch: string, date: string, mcap: number, notes: string): CalEvent =>
    ({ id: `ipo-${date}-${slug(sym || name)}`, title: `${name}${sym ? ` (${sym})` : ""} IPO${exch ? ` on ${exch}` : ""}`, date, cc: /NASDAQ|NYSE|AMEX|CBOE/i.test(exch) || !exch ? "US" : "", cat: "ipo", imp: mcap >= 1e9 ? 2 : 1, srcName: src, url, notes });
  return firstOf<CalEvent[]>([
    ["FMP", "FMP_API_KEY", async () => (await fmp<FmpIpo[]>("/ipos-calendar", { from, to })).flatMap((x) => { const dt = splitDt(String(x.date ?? "")); return dt && (x.company || x.symbol) ? [mk("Financial Modeling Prep IPO calendar", "https://site.financialmodelingprep.com/developer/docs/stable/ipos-calendar", String(x.symbol ?? ""), String(x.company ?? x.symbol), String(x.exchange ?? ""), dt.date, Number(x.marketCap) || 0, [x.actions, x.priceRange ? `price range ${x.priceRange}` : "", num(x.shares) ? `${Number(x.shares).toLocaleString("en-US")} shares` : ""].filter(Boolean).join("; ") + ".")] : []; })],
    ["EODHD", "EODHD_API_KEY", async () => ((await eod<{ ipos?: EodIpo[] }>("/calendar/ipos", { from, to })).ipos ?? []).flatMap((x) => { const dt = splitDt(String(x.start_date ?? "")); return dt && x.name ? [mk("EODHD IPO calendar", "https://eodhd.com/financial-apis/calendar-upcoming-earnings-ipos-and-splits", String(x.code ?? "").replace(/\.US$/, ""), String(x.name), String(x.exchange ?? ""), dt.date, 0, [x.deal_type, num(x.offer_price) ? `offer price ${x.offer_price}` : num(x.price_from) ? `price range ${x.price_from}–${x.price_to}` : "", num(x.shares) ? `${Number(x.shares).toLocaleString("en-US")} shares` : ""].filter(Boolean).join("; ") + ".")] : []; })],
  ]);
}
