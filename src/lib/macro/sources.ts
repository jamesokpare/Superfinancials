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
import { readXlsx } from "./xlsx";

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
const BROWSER_UA = { "user-agent": "Mozilla/5.0 (compatible; Superfinancials data sync; +https://github.com/jamesokpare/Superfinancials)" };
/** CSV over HTTP. Overloaded SDMX services (OECD) answer 429/500/503 at busy times: retried with backoff. */
async function getCsv(name: string, url: URL, timeoutMs = 60_000, retries = 2, ua: Record<string, string> = UA): Promise<Record<string, string>[]> {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try { res = await fetch(url, { headers: { ...ua, accept: "text/csv, application/vnd.sdmx.data+csv, */*" }, signal: AbortSignal.timeout(timeoutMs) }); }
    catch (e) { throw new ProviderError(name, `request failed: ${(e as Error).message}`); }
    const text = await res.text();
    if (res.ok) return parseCsv(text);
    if (attempt < retries && [429, 500, 502, 503, 504].includes(res.status)) { await new Promise((r) => setTimeout(r, (attempt + 1) * (Number(process.env.MACRO_RETRY_MS) || 15_000))); continue; }
    throw new ProviderError(name, `HTTP ${res.status}: ${text.slice(0, 160)}`, res.status);
  }
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
export async function ecbSeries(flow: string, key: string, from: string) {
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
/** EU members: their COICOP-1999 CPI series stop at 2025-12; the COICOP-2018 dataflow continues them. */
export const OECD_EU = new Set(["AUT", "BEL", "DEU", "ESP", "FIN", "FRA", "GRC", "IRL", "ITA", "NLD", "PRT", "SWE", "DNK", "POL", "CZE", "HUN"]);
const OECD_FLOWS = { c1999: "OECD.SDD.TPS,DSD_PRICES@DF_PRICES_ALL,1.0", c2018: "OECD.SDD.TPS,DSD_PRICES_COICOP2018@DF_PRICES_C2018_ALL,1.0" };
const chunks = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
export async function oecdCpi(from: string): Promise<MacroSeries[]> {
  // Small requests: wide all-country queries time out (HTTP 500) when the service is busy, and the API allows
  // 60 downloads an hour. Areas go in batches of 8; EU members are asked from the COICOP-2018 flow too, and its
  // values win month by month. The service rejects library default user agents.
  const areas = Object.keys(OECD_AREAS); const gap = Number(process.env.MACRO_GAP_MS ?? 2000);
  const jobs: [keyof typeof OECD_FLOWS, string[]][] = [...chunks(areas, 8).map((a) => ["c1999", a] as [keyof typeof OECD_FLOWS, string[]]), ...chunks(areas.filter((a) => OECD_EU.has(a)), 8).map((a) => ["c2018", a] as [keyof typeof OECD_FLOWS, string[]])];
  const by = { c1999: new Map<string, Map<string, number>>(), c2018: new Map<string, Map<string, number>>() }; const errs: string[] = [];
  for (const [i, [flow, list]] of jobs.entries()) {
    if (i && gap) await new Promise((r) => setTimeout(r, gap));
    try {
      const rows = await getCsv("OECD", buildUrl("https://sdmx.oecd.org/public/rest", `/data/${OECD_FLOWS[flow]}/${list.join("+")}.M.N.CPI.PA._T.N.GY`, { startPeriod: from.slice(0, 7), format: "csvfile" }), 90_000, 1, BROWSER_UA);
      for (const r of rows) {
        const cc = OECD_AREAS[r.REF_AREA ?? ""]; const t = periodEnd(r.TIME_PERIOD ?? ""); const v = Number(r.OBS_VALUE);
        if (!cc || !t || r.OBS_VALUE === "" || !Number.isFinite(v)) continue;
        (by[flow].get(cc) ?? by[flow].set(cc, new Map()).get(cc)!).set(t, Number(v.toFixed(2)));
      }
    } catch (e) { errs.push(`${flow} ${list[0]}…: ${(e as Error).message}`); }
  }
  const merged = new Map<string, Map<string, number>>();
  for (const flow of ["c1999", "c2018"] as const) for (const [cc, m] of by[flow]) { const t = merged.get(cc) ?? merged.set(cc, new Map()).get(cc)!; for (const [d, v] of m) t.set(d, v); }
  if (!merged.size) throw new ProviderError("OECD", errs.length ? errs.slice(0, 2).join(" | ") : "no CPI rows returned");
  return [...merged].map(([cc, m]) => ({ cc, code: "CPIM", name: "Consumer price inflation (monthly)", unit: "% y/y", cat: "in" as const, freq: "M" as const, mi: "CPI", src: "OECD consumer prices", url: "https://data-explorer.oecd.org/", notes: `OECD Prices database (${by.c2018.has(cc) ? "DF_PRICES_C2018_ALL, COICOP 2018, with DF_PRICES_ALL for earlier months" : "DF_PRICES_ALL"}): CPI, all items, growth over the same month a year earlier. CC BY 4.0.`, points: sortPts([...m].map(([t, v]) => ({ t, v }))) }));
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
type EodDiv = { code?: string; date?: string; recordDate?: string; paymentDate?: string; declarationDate?: string; value?: unknown; unadjustedValue?: unknown; currency?: string; period?: string };
const trackedIds = () => new Map<string, string>([...US_EQUITIES.split(" ").map((t) => [t, `EQ.${t}`] as const), ...ETF.split(" ").map((t) => [t, `ET.${t}`] as const)]);
/** Ex-dividend dates for the tracked U.S. stocks and ETFs, next 60 days (FMP, else EODHD). */
export async function dividendCalendar(now: Date): Promise<CalEvent[]> {
  const ids = trackedIds(); const from = dayAdd(now, -3), to = dayAdd(now, 60);
  const mk = (sym: string, date: string, amt: string, x: { rec?: string; pay?: string; extra?: string }, src: string, url: string): CalEvent[] => {
    const id = ids.get(sym); if (!id) return [];
    return [{ id: `div-${date}-${slug(sym)}`, title: `${sym} ex-dividend${amt ? ` ($${amt})` : ""}`, date, cc: "US", cat: "div", imp: 1 as const, unit: "US$", srcName: src, url, ids: [id],
      notes: `Record date ${x.rec || "—"}, payment ${x.pay || "—"}${x.extra ?? ""}.` }];
  };
  return firstOf<CalEvent[]>([
    ["FMP", "FMP_API_KEY", async () => (await fmp<FmpDiv[]>("/dividends-calendar", { from, to })).flatMap((x) => {
      const dt = splitDt(String(x.date ?? "")); if (!dt) return [];
      return mk(String(x.symbol ?? ""), dt.date, num(x.dividend ?? x.adjDividend), { rec: x.recordDate, pay: x.paymentDate, extra: `${x.frequency ? `, ${String(x.frequency).toLowerCase()}` : ""}${num(x.yield) ? `; yield ${Number(x.yield).toFixed(2)}%` : ""}` }, "Financial Modeling Prep dividend calendar", "https://site.financialmodelingprep.com/developer/docs/stable/dividends-calendar");
    })],
    ["EODHD", "EODHD_API_KEY", async () => {
      const out: CalEvent[] = [];
      // JSON:API paging, 1,000 rows a page; a 63-day window across all U.S. listings is a few pages.
      for (let off = 0; off < 10_000; off += 1000) {
        const r = await eod<{ data?: EodDiv[]; meta?: { total?: number } }>("/calendar/dividends", { "filter[date_from]": from, "filter[date_to]": to, "page[limit]": 1000, "page[offset]": off });
        for (const x of r.data ?? []) {
          const code = String(x.code ?? ""); if (!code.endsWith(".US")) continue; const dt = splitDt(String(x.date ?? "")); if (!dt) continue;
          out.push(...mk(code.slice(0, -3), dt.date, num(x.value ?? x.unadjustedValue), { rec: x.recordDate, pay: x.paymentDate, extra: x.period ? `, ${String(x.period).toLowerCase()}` : "" }, "EODHD dividend calendar", "https://eodhd.com/financial-apis/calendar-upcoming-earnings-ipos-and-splits-api"));
        }
        if (!r.data || r.data.length < 1000 || off + 1000 >= (r.meta?.total ?? 0)) break;
      }
      return out;
    }],
  ]);
}

type EodSplit = { code?: string; split?: string; date?: string; old_shares?: unknown; new_shares?: unknown; optionable?: string };
/** Stock splits for the tracked U.S. stocks and ETFs, last week to 90 days ahead (EODHD). */
export async function splitCalendar(now: Date): Promise<CalEvent[]> {
  const ids = trackedIds();
  const r = await eod<{ splits?: EodSplit[] }>("/calendar/splits", { from: dayAdd(now, -7), to: dayAdd(now, 90) });
  return (r.splits ?? []).flatMap((x) => {
    const code = String(x.code ?? ""); const sym = code.replace(/\.US$/, ""); const id = ids.get(sym); const dt = splitDt(String(x.date ?? ""));
    if (!id || !code.endsWith(".US") || !dt) return [];
    // EODHD writes a split as "new/old" (e.g. "4.000000/1.000000" for 4-for-1).
    const [a, b] = String(x.split ?? "").split("/").map(Number); const ratio = Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0 ? (a >= b ? `${+a.toFixed(4)}-for-${+b.toFixed(4)}` : `1-for-${+(b / a).toFixed(4)} reverse`) : String(x.split ?? "");
    return [{ id: `spl-${dt.date}-${slug(sym)}`, title: `${sym} ${ratio} stock split`, date: dt.date, cc: "US", cat: "spl", imp: 2 as const, srcName: "EODHD splits calendar", url: "https://eodhd.com/financial-apis/calendar-upcoming-earnings-ipos-and-splits-api", ids: [id], notes: `Split ratio ${x.split ?? "—"} (new/old shares).` }];
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

// --- commodity prices for instruments without a market-data source -------------------------------
/** A price series for an existing app instrument (written as a data-desk instrument doc, adm_inst/<id>). */
export type InstSeries = { id: string; points: Point[]; src: string; note: string;
  /** For an instrument the app doesn't have yet: created as a data-desk instrument with this description. */
  meta?: { type: string; tk: string; name: string; exch: string; country: string; ccy: string; sector: string; industry: string } };

/**
 * World Bank Commodity Price Data (the "Pink Sheet"), monthly averages. CC BY 4.0.
 * The Indicators API no longer serves these series (source 21 answers "Invalid value"), so this reads the
 * official monthly workbook CMO-Historical-Data-Monthly.xlsx, sheet "Monthly Prices". Its address changes
 * with each annual release; it is found on the commodity-markets page, with the last known one as fallback.
 */
export const PINK: { code: string; id: string; note: string; conv?: "mmbtu-eurmwh" }[] = [
  { code: "NGAS_EUR", id: "CM.TTF", note: "Natural gas, Europe (TTF), monthly average; converted from US$/mmBtu to EUR/MWh at the ECB monthly EUR/USD rate", conv: "mmbtu-eurmwh" },
  { code: "NGAS_JP", id: "CM.JKM", note: "Liquefied natural gas, Japan import price, monthly average (a proxy for the JKM spot marker)" },
  { code: "COAL_AUS", id: "CM.MTF", note: "Coal, Australian (Newcastle) thermal, monthly average" },
  { code: "ALUMINUM", id: "CM.ALI", note: "Aluminium, LME, monthly average" },
  { code: "NICKEL", id: "CM.NI", note: "Nickel, LME, monthly average" },
  { code: "ZINC", id: "CM.ZNC", note: "Zinc, LME, monthly average" },
  { code: "IRON_ORE", id: "CM.TIO", note: "Iron ore, fines 62% Fe, CFR China, monthly average" },
  { code: "PALM_OIL", id: "CM.FCPO", note: "Palm oil, Malaysia, monthly average" },
  { code: "UREA_EE_BULK", id: "CM.UREA", note: "Urea, monthly average" },
  { code: "DAP", id: "CM.DAP", note: "DAP (diammonium phosphate), monthly average" },
];
export const PINK_PAGE = "https://www.worldbank.org/en/research/commodity-markets";
export const PINK_FALLBACK = "https://thedocs.worldbank.org/en/doc/74e8be41ceb20fa0da750cda2f6b9e4e-0050012026/related/CMO-Historical-Data-Monthly.xlsx";
async function getBuf(name: string, url: string, headers: Record<string, string> = BROWSER_UA): Promise<Buffer> {
  let res: Response;
  try { res = await fetch(url, { headers, signal: AbortSignal.timeout(90_000) }); } catch (e) { throw new ProviderError(name, `request failed: ${(e as Error).message}`); }
  if (!res.ok) throw new ProviderError(name, `HTTP ${res.status} for ${url.slice(0, 120)}`, res.status);
  return Buffer.from(await res.arrayBuffer());
}
/** Column names in the workbook → series codes, for a workbook without the row of codes. */
export const PINK_NAMES: [RegExp, string][] = [
  [/^crude oil,? brent/i, "CRUDE_BRENT"], [/^natural gas,? europe/i, "NGAS_EUR"], [/^(liquefied natural gas|lng),? japan/i, "NGAS_JP"], [/^coal,? australian/i, "COAL_AUS"],
  [/^alumin(i)?um/i, "ALUMINUM"], [/^nickel/i, "NICKEL"], [/^zinc/i, "ZINC"], [/^iron ore/i, "IRON_ORE"], [/^palm oil/i, "PALM_OIL"], [/^urea/i, "UREA_EE_BULK"], [/^dap\b/i, "DAP"],
];
/** "1960M01", "1960-01", "Jan-1960" or an Excel date serial → month end. */
function pinkMonth(c: string | number): string | null {
  if (typeof c === "number") { if (c < 3000 || c > 80000) return null; const d = new Date(Date.UTC(1899, 11, 30) + c * 864e5); return periodEnd(d.toISOString().slice(0, 7)); }
  const s = c.trim(); let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{4})\s*M\s*(\d{1,2})$/i))) return periodEnd(`${m[1]}-${m[2].padStart(2, "0")}`);
  if ((m = s.match(/^(\d{4})-(\d{2})(?:-\d{2})?$/))) return periodEnd(`${m[1]}-${m[2]}`);
  return null;
}
/** Rows of the "Monthly Prices" sheet → series by code (codes upper-cased; the workbook writes "Zinc", "Tin"). */
export function parsePinkSheet(rows: (string | number)[][]): Map<string, Point[]> {
  // The row of series codes (CRUDE_BRENT …) when there is one; otherwise the row of commodity names.
  let head = rows.findIndex((r) => r.some((c) => String(c).trim().toUpperCase() === "CRUDE_BRENT"));
  let codes: string[] = head >= 0 ? rows[head].map((c) => String(c).trim().toUpperCase()) : [];
  if (head < 0) {
    head = rows.findIndex((r) => r.some((c) => /^crude oil,? brent/i.test(String(c).trim())));
    if (head >= 0) codes = rows[head].map((c) => PINK_NAMES.find(([re]) => re.test(String(c).trim()))?.[1] ?? "");
  }
  if (head < 0) {
    const peek = rows.filter((r) => r.some((c) => String(c).trim())).slice(0, 8).map((r) => r.slice(0, 4).map((c) => String(c).slice(0, 30)).join(" | ")).join(" // ");
    throw new ProviderError("World Bank", `Pink Sheet layout changed: no row of series codes or commodity names. First rows: ${peek}`.slice(0, 600));
  }
  const out = new Map<string, Point[]>();
  for (const r of rows.slice(head + 1)) {
    const t = pinkMonth(r[0] ?? ""); if (!t) continue;
    codes.forEach((c, i) => { if (!c || i === 0) return; const v = typeof r[i] === "number" ? r[i] as number : Number(String(r[i] ?? "").replace(/,/g, "")); if (String(r[i] ?? "").trim() === "" || !Number.isFinite(v)) return; (out.get(c) ?? out.set(c, []).get(c)!).push({ t, v }); });
  }
  if (!out.size) throw new ProviderError("World Bank", `Pink Sheet: header found on row ${head + 1}, but no monthly rows after it (first cells: ${rows.slice(head + 1, head + 4).map((r) => String(r[0] ?? "")).join(", ")})`);
  return out;
}
export async function pinkSheet(now: Date): Promise<InstSeries[]> {
  let url = PINK_FALLBACK;
  try { const html = (await getBuf("World Bank", PINK_PAGE)).toString("utf8"); const m = html.match(/https:\/\/thedocs\.worldbank\.org\/en\/doc\/[A-Za-z0-9-]+\/related\/CMO-Historical-Data-Monthly\.xlsx/); if (m) url = m[0]; } catch { /* use the last known address */ }
  const series = parsePinkSheet(readXlsx(await getBuf("World Bank", url), "Monthly Prices"));
  const from = periodEnd(`${now.getUTCFullYear() - 5}-01`)!; const out: InstSeries[] = [];
  let eurusd: Map<string, number> | null = null;
  for (const p of PINK) {
    let pts = (series.get(p.code) ?? []).filter((x) => x.t >= from);
    if (p.conv === "mmbtu-eurmwh" && pts.length) {
      eurusd ??= new Map((await ecbSeries("EXR", "M.USD.EUR.SP00.A", from.slice(0, 7))).map((x) => [periodEnd(x.t)!, x.v]));
      pts = pts.flatMap((x) => { const fx = eurusd!.get(x.t); return fx ? [{ t: x.t, v: x.v * 3.412 / fx }] : []; });
    }
    if (pts.length) out.push({ id: p.id, points: sortPts(pts.map((x) => ({ t: x.t, v: Number(x.v.toFixed(2)) }))), src: "World Bank commodity prices (Pink Sheet)", note: `${p.note}. World Bank Pink Sheet series ${p.code}, CC BY 4.0.` });
  }
  if (!out.length) throw new ProviderError("World Bank", `Pink Sheet read, but none of ${PINK.map((p) => p.code).join(", ")} found`);
  return out;
}

/** German/Luxembourg day-ahead power price, daily, from SMARD (Bundesnetzagentur), CC BY 4.0. Filter 4169 = day-ahead price DE-LU. */
export async function smardPower(): Promise<InstSeries[]> {
  const base = "https://www.smard.de/app/chart_data/4169/DE-LU";
  const idx = await getJson<{ timestamps?: number[] }>("SMARD", new URL(`${base}/index_day.json`), { init: { headers: UA } });
  const ts = (idx.timestamps ?? []).slice(-2);
  if (!ts.length) throw new ProviderError("SMARD", "no data chunks listed");
  const pts: Point[] = [];
  for (const t of ts) {
    const r = await getJson<{ series?: [number, number | null][] }>("SMARD", new URL(`${base}/4169_DE-LU_day_${t}.json`), { init: { headers: UA } });
    // Timestamps are local midnight (Berlin); +12 h lands on the right calendar day in UTC.
    for (const [ms, v] of r.series ?? []) if (v != null && Number.isFinite(v)) pts.push({ t: new Date(ms + 12 * 36e5).toISOString().slice(0, 10), v: Number(v.toFixed(2)) });
  }
  if (!pts.length) throw new ProviderError("SMARD", "no prices returned");
  return [{ id: "CM.PWDE", points: sortPts(pts), src: "SMARD (Bundesnetzagentur)", note: "German/Luxembourg day-ahead electricity price, daily average (EPEX Spot via SMARD), EUR/MWh. Not the front-year future. CC BY 4.0, Bundesnetzagentur | SMARD.de." }];
}

// --- U.S. energy inventories ----------------------------------------------------------------
/** U.S. EIA weekly inventories (API v2, free key in EIA_API_KEY). Public domain. */
/** EIA series (API v2 /seriesid). `k` converts EIA's unit to `unit` (e.g. thousand barrels → million barrels). Public domain. */
export const EIA_SERIES: { id: string; code: string; name: string; unit: string; freq: "D" | "W" | "M"; k?: number; cat?: MacroSeries["cat"] }[] = [
  // Weekly Petroleum Status Report
  { id: "PET.WCESTUS1.W", code: "CRUDEINV", name: "U.S. commercial crude oil inventories (ex SPR)", unit: "million barrels", freq: "W", k: 1e-3 },
  { id: "PET.WGTSTUS1.W", code: "GASOLINEINV", name: "U.S. total motor gasoline inventories", unit: "million barrels", freq: "W", k: 1e-3 },
  { id: "PET.WDISTUS1.W", code: "DISTILLATEINV", name: "U.S. distillate fuel oil inventories", unit: "million barrels", freq: "W", k: 1e-3 },
  { id: "PET.W_EPC0_SAX_YCUOK_MBBL.W", code: "CUSHINGINV", name: "Crude oil stocks at Cushing, Oklahoma (WTI delivery point)", unit: "million barrels", freq: "W", k: 1e-3 },
  { id: "PET.WCSSTUS1.W", code: "SPRINV", name: "U.S. Strategic Petroleum Reserve stocks", unit: "million barrels", freq: "W", k: 1e-3 },
  { id: "PET.WCRFPUS2.W", code: "CRUDEPROD", name: "U.S. crude oil field production", unit: "million b/d", freq: "W", k: 1e-3, cat: "gr" },
  { id: "PET.WCRIMUS2.W", code: "CRUDEIMP", name: "U.S. crude oil imports", unit: "million b/d", freq: "W", k: 1e-3, cat: "ex" },
  { id: "PET.WCREXUS2.W", code: "CRUDEEXP", name: "U.S. crude oil exports", unit: "million b/d", freq: "W", k: 1e-3, cat: "ex" },
  { id: "PET.WRPUPUS2.W", code: "PRODSUPPLIED", name: "U.S. total petroleum products supplied (demand)", unit: "million b/d", freq: "W", k: 1e-3, cat: "gr" },
  { id: "PET.WPULEUS3.W", code: "REFUTIL", name: "U.S. refinery utilization", unit: "%", freq: "W", cat: "gr" },
  // Natural gas
  { id: "NG.NW2_EPG0_SWO_R48_BCF.W", code: "NATGASSTOR", name: "U.S. working gas in underground storage (Lower 48)", unit: "Bcf", freq: "W" },
  { id: "NG.RNGWHHD.D", code: "HENRYHUB", name: "Henry Hub natural gas spot price", unit: "US$/MMBtu", freq: "D" },
  { id: "NG.N9070US2.M", code: "NATGASPROD", name: "U.S. dry natural gas production", unit: "Bcf", freq: "M", k: 1e-3, cat: "gr" },
  // Electricity
  { id: "ELEC.GEN.ALL-US-99.M", code: "POWERGEN", name: "U.S. net electricity generation, all sources", unit: "TWh", freq: "M", k: 1e-3, cat: "gr" },
];
const EIA_FREQ = { D: "daily", W: "weekly", M: "monthly" } as const;
/** One request per series; one failing series loses only that one. */
export async function eiaInventories(): Promise<MacroSeries[]> {
  const key = requireKey("EIA", "EIA_API_KEY"); const out: MacroSeries[] = []; const errors: string[] = [];
  for (const s of EIA_SERIES) {
    let r: { response?: { data?: { period?: string; value?: number | string | null }[] } };
    try { r = await getJson("EIA", buildUrl("https://api.eia.gov/v2", `/seriesid/${s.id}`, { api_key: key, length: s.freq === "M" ? 120 : 260 })); }
    catch (e) { errors.push(`${s.id}: ${(e as Error).message}`); continue; }
    const pts = (r.response?.data ?? []).flatMap((x) => {
      const v = Number(x.value); const p = String(x.period ?? ""); const t = /^\d{4}-\d{2}-\d{2}$/.test(p) ? p : /^\d{4}-\d{2}$/.test(p) ? periodEnd(p) : null;
      return t && x.value != null && x.value !== "" && Number.isFinite(v) ? [{ t, v: Number((v * (s.k ?? 1)).toFixed(3)) }] : [];
    });
    if (pts.length) out.push({ cc: "US", code: s.code, name: s.name, unit: s.unit, cat: s.cat ?? "mk", freq: s.freq, src: "U.S. Energy Information Administration", url: `https://www.eia.gov/opendata/browser/`, notes: `EIA series ${s.id}, ${EIA_FREQ[s.freq]}. Public domain.`, points: sortPts(pts) });
  }
  if (errors.length === EIA_SERIES.length) throw new ProviderError("EIA", errors[0]);
  return out;
}

// --- BIS long series on consumer prices (monthly CPI y/y, ~64 economies) -------------------------
/** BIS WS_LONG_CPI, unit 771 = year-on-year change. Free reuse with attribution (BIS terms). */
export async function bisCpi(from: string): Promise<MacroSeries[]> {
  const rows = await getCsv("BIS", buildUrl("https://stats.bis.org/api/v1", "/data/WS_LONG_CPI/M..771", { startPeriod: from, format: "csv" }));
  const by = new Map<string, Point[]>();
  for (const r of rows) {
    const cc = r.REF_AREA ? toApp(r.REF_AREA) : ""; const t = periodEnd(r.TIME_PERIOD ?? ""); const v = Number(r.OBS_VALUE);
    if (!/^[A-Z]{2}$/.test(cc) || !t || r.OBS_VALUE === "" || !Number.isFinite(v)) continue;
    (by.get(cc) ?? by.set(cc, []).get(cc)!).push({ t, v: Number(v.toFixed(2)) });
  }
  if (!rows.length) throw new ProviderError("BIS", "no CPI rows returned");
  return [...by].map(([cc, pts]) => ({ cc, code: "CPIB", name: "Consumer price inflation (monthly, BIS)", unit: "% y/y", cat: "in" as const, freq: "M" as const, mi: "CPI", src: "BIS consumer prices", url: "https://data.bis.org/topics/CPI", notes: "Bank for International Settlements, long series on consumer prices (WS_LONG_CPI), year-on-year change.", points: sortPts(pts) }));
}

// --- official release calendars published as iCalendar (ICS) -----------------------------------
/** Minimal iCalendar reader: VEVENT SUMMARY / DTSTART (date or UTC date-time), with line unfolding. */
export function parseIcs(text: string): { title: string; date: string; time: string; uid: string; cat: string }[] {
  const lines = text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/); const out: { title: string; date: string; time: string; uid: string; cat: string }[] = []; let ev: Record<string, string> | null = null;
  for (const l of lines) {
    if (l === "BEGIN:VEVENT") { ev = {}; continue; }
    if (l === "END:VEVENT") { if (ev?.SUMMARY && ev.DTSTART) { const m = ev.DTSTART.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})\d{2}(Z?))?$/); if (m) out.push({ title: ev.SUMMARY.replace(/\\([,;\\])/g, "$1").replace(/\\n/gi, " ").trim(), date: `${m[1]}-${m[2]}-${m[3]}`, time: m[4] && m[6] === "Z" ? `${m[4]}:${m[5]}` : "", uid: ev.UID ?? "", cat: ev["X-CATEGORY"] ?? ev.CATEGORIES ?? "" }); } ev = null; continue; }
    if (!ev) continue; const i = l.indexOf(":"); if (i < 0) continue; const k = l.slice(0, i).split(";")[0].toUpperCase(); ev[k] = l.slice(i + 1);
  }
  return out;
}
const icsGet = async (name: string, url: string, ua: Record<string, string> = BROWSER_UA) => { const r = await fetch(url, { headers: { ...ua, accept: "text/calendar, text/plain;q=0.9, */*;q=0.8", "accept-language": "en-US,en;q=0.9" }, signal: AbortSignal.timeout(60_000) }); const t = await r.text(); if (!r.ok) throw new ProviderError(name, `HTTP ${r.status}`, r.status); return parseIcs(t); };
/** Contact header for U.S. agencies that block robots without one (SEC, BLS): SEC_USER_AGENT, "Company contact@domain". */
export const contactUA = () => { const v = process.env.SEC_USER_AGENT?.trim(); return v && /\S+@\S+\.\S+/.test(v) ? v : null; };
export const EUROSTAT_ICS = "https://ec.europa.eu/eurostat/o/calendars/eventsIcal?theme=0&category=0";
/** Eurostat releases worth a calendar entry: the euro indicators and other headline statistics. */
const ESTAT_KEEP = /euro indicator|HICP|inflation|GDP|unemployment|industrial production|retail trade|producer price|international trade|trade in goods|construction|government (debt|deficit)|labour cost|job vacanc|current account|balance of payments|house price|business and consumer|employment/i;
/** Eurostat headline releases and U.S. BLS releases, next 45 days. */
export async function icsCalendars(now: Date): Promise<CalEvent[]> {
  const from = now.toISOString().slice(0, 10), to = new Date(now.getTime() + 45 * 864e5).toISOString().slice(0, 10);
  const inWin = (d: string) => d >= from && d <= to; const out: CalEvent[] = []; const errs: string[] = [];
  const BIG = /CPI|inflation|HICP|GDP|employment situation|unemployment|retail|industrial production|producer price|PPI/i;
  try {
    for (const e of await icsGet("Eurostat", EUROSTAT_ICS)) {
      if (!inWin(e.date) || (e.cat && !/release/i.test(e.cat)) || !ESTAT_KEEP.test(`${e.title} ${e.cat}`)) continue;
      out.push({ id: `estat-${e.date}-${slug(e.title)}`, title: `Euro area: ${e.title}`, date: e.date, time: e.time, cc: "EU", cat: "eco", imp: BIG.test(e.title) ? 2 : 1, srcName: "Eurostat release calendar", url: "https://ec.europa.eu/eurostat/news/release-calendar", notes: "Scheduled Eurostat release." });
    }
  } catch (e) { errs.push((e as Error).message); }
  // BLS blocks robots that carry no contact address (Akamai answers 403), so it is only asked with one.
  const ua = contactUA();
  if (ua) {
    try { for (const e of await icsGet("BLS", "https://www.bls.gov/schedule/news_release/bls.ics", { "user-agent": ua })) if (inWin(e.date)) out.push({ id: `bls-${e.date}-${slug(e.title)}`, title: `U.S. ${e.title}`, date: e.date, time: e.time, cc: "US", cat: "eco", imp: BIG.test(e.title) ? 3 : 1, srcName: "BLS release calendar", url: "https://www.bls.gov/schedule/news_release/", notes: "Scheduled U.S. Bureau of Labor Statistics release." }); } catch (e) { errs.push((e as Error).message); }
  } else errs.push("BLS skipped: SEC_USER_AGENT (with a contact email) not set");
  if (!out.length && errs.length) throw new ProviderError("calendars", errs.join(" | "));
  return out;
}

// --- IMF World Economic Outlook (DataMapper API, no key) -----------------------------------------
/** App country code → ISO 3166 alpha-3, for the countries the macro sync covers. */
export const ISO3: Record<string, string> = {
  AF: "AFG", AO: "AGO", AR: "ARG", AT: "AUT", AU: "AUS", BD: "BGD", BE: "BEL", BF: "BFA", BJ: "BEN", BR: "BRA", BW: "BWA", CA: "CAN", CD: "COD", CG: "COG", CH: "CHE",
  CI: "CIV", CL: "CHL", CM: "CMR", CN: "CHN", CO: "COL", CV: "CPV", CZ: "CZE", DE: "DEU", DK: "DNK", DZ: "DZA", EG: "EGY", ES: "ESP", ET: "ETH", FI: "FIN", FR: "FRA",
  GA: "GAB", GH: "GHA", GM: "GMB", GN: "GIN", GR: "GRC", HK: "HKG", HU: "HUN", ID: "IDN", IE: "IRL", IL: "ISR", IN: "IND", IQ: "IRQ", IR: "IRN", IT: "ITA", JM: "JAM",
  JO: "JOR", JP: "JPN", KE: "KEN", KR: "KOR", KW: "KWT", KZ: "KAZ", LB: "LBN", LK: "LKA", LR: "LBR", LY: "LBY", MA: "MAR", MG: "MDG", ML: "MLI", MU: "MUS", MW: "MWI",
  MX: "MEX", MY: "MYS", MZ: "MOZ", NA: "NAM", NE: "NER", NG: "NGA", NL: "NLD", NO: "NOR", NZ: "NZL", OM: "OMN", PE: "PER", PH: "PHL", PK: "PAK", PL: "POL", PT: "PRT",
  QA: "QAT", RO: "ROU", RU: "RUS", RW: "RWA", SA: "SAU", SD: "SDN", SE: "SWE", SG: "SGP", SL: "SLE", SN: "SEN", SS: "SSD", TG: "TGO", TH: "THA", TN: "TUN", TR: "TUR",
  TW: "TWN", TZ: "TZA", UA: "UKR", AE: "ARE", UG: "UGA", UK: "GBR", US: "USA", UY: "URY", VE: "VEN", VN: "VNM", ZA: "ZAF", ZM: "ZMB", ZW: "ZWE",
};
/** WEO indicators read for their projections (this year and the next five), plus the fiscal balance history the World Bank set lacks. */
export const IMF_INDICATORS: { id: string; code: string; name: string; unit: string; cat: MacroSeries["cat"]; history?: { code: string; name: string } }[] = [
  { id: "NGDP_RPCH", code: "GDPF", name: "Real GDP growth, IMF projection", unit: "% y/y", cat: "gr" },
  { id: "PCPIPCH", code: "CPIF", name: "Consumer price inflation (average), IMF projection", unit: "% y/y", cat: "in" },
  { id: "LUR", code: "URF", name: "Unemployment rate, IMF projection", unit: "%", cat: "lb" },
  { id: "GGXWDG_NGDP", code: "DEBTF", name: "General government gross debt, IMF projection", unit: "% of GDP", cat: "fs" },
  { id: "BCA_NGDPD", code: "CAF", name: "Current account balance, IMF projection", unit: "% of GDP", cat: "ex" },
  { id: "GGXCNL_NGDP", code: "BALF", name: "Fiscal balance (government net lending/borrowing), IMF projection", unit: "% of GDP", cat: "fs", history: { code: "GGBAL", name: "Fiscal balance (government net lending/borrowing)" } },
];
type ImfValues = { values?: Record<string, Record<string, Record<string, number | string | null>>> };
/** One request per indicator (all countries). Projections: this year to five years ahead; fiscal balance history: 15 years. */
export async function imfWeo(countries: string[], now: Date): Promise<MacroSeries[]> {
  const y0 = now.getUTCFullYear(); const years = Array.from({ length: 21 }, (_, i) => y0 - 15 + i);
  const by3 = new Map(countries.filter((c) => ISO3[c]).map((c) => [ISO3[c], c]));
  const out: MacroSeries[] = []; const errors: string[] = [];
  for (const ind of IMF_INDICATORS) {
    let r: ImfValues;
    try { r = await getJson<ImfValues>("IMF", buildUrl("https://www.imf.org/external/datamapper/api/v1", `/${ind.id}`, { periods: years.join(",") }), { init: { headers: UA } }); }
    catch (e) { errors.push(`${ind.id}: ${(e as Error).message}`); continue; }
    for (const [iso3, vals] of Object.entries(r.values?.[ind.id] ?? {})) {
      const cc = by3.get(iso3); if (!cc) continue;
      const pts = Object.entries(vals).flatMap(([y, v]) => { const n = typeof v === "number" ? v : Number(v); return /^\d{4}$/.test(y) && v !== null && v !== "" && Number.isFinite(n) ? [{ y: +y, v: Number(n.toFixed(2)) }] : []; });
      const url = `https://www.imf.org/external/datamapper/${ind.id}@WEO/${iso3}`;
      const fc = pts.filter((p) => p.y >= y0 && p.y <= y0 + 5).map((p) => ({ t: `${p.y}-12-31`, v: p.v }));
      if (fc.length) out.push({ cc, code: ind.code, name: ind.name, unit: ind.unit, cat: ind.cat, freq: "A", src: "IMF World Economic Outlook", url,
        notes: `IMF projections for ${y0}–${y0 + 5} from the latest World Economic Outlook (published each April and October); this year's value is an estimate. Replaced with each new edition.`, points: sortPts(fc) });
      const hist = ind.history && pts.filter((p) => p.y < y0).map((p) => ({ t: `${p.y}-12-31`, v: p.v }));
      if (ind.history && hist?.length) out.push({ cc, code: ind.history.code, name: ind.history.name, unit: ind.unit, cat: ind.cat, freq: "A", src: "IMF World Economic Outlook", url,
        notes: "General government net lending (+) or borrowing (−) as a share of GDP, IMF World Economic Outlook.", points: sortPts(hist) });
    }
  }
  if (errors.length === IMF_INDICATORS.length) throw new ProviderError("IMF", errors[0]);
  return out;
}

// --- NBER U.S. recession dates (FRED series USREC) ------------------------------------------------
/** Monthly NBER recession indicator (1 = recession month) since 1948, as series US.USREC. Needs FRED_API_KEY. */
export async function nberRecessions(): Promise<MacroSeries[]> {
  const key = requireKey("FRED", "FRED_API_KEY");
  const r = await getJson<{ observations?: { date: string; value: string }[] }>("FRED", buildUrl("https://api.stlouisfed.org/fred", "/series/observations", { api_key: key, file_type: "json", series_id: "USREC", observation_start: "1948-01-01" }));
  const points = (r.observations ?? []).flatMap((o) => { const v = Number(o.value); const t = periodEnd(o.date.slice(0, 7)); return (v === 0 || v === 1) && t ? [{ t, v }] : []; });
  if (!points.length) throw new ProviderError("FRED", "USREC returned no observations");
  return [{ cc: "US", code: "USREC", name: "NBER recession indicator (1 = recession)", unit: "0/1", cat: "gr", freq: "M", src: "NBER business-cycle dates via FRED (USREC)", url: "https://fred.stlouisfed.org/series/USREC",
    notes: "Months between an NBER business-cycle peak and the following trough are 1. The NBER dates turning points months after the fact, so the latest months stay 0 until it announces one.", points }];
}

/** Recession periods [{ from, to }] (month-end dates) from a 0/1 monthly series. */
export function recessionSpans(points: Point[]): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = []; let s: string | null = null; let last = "";
  for (const p of points) { if (p.v === 1 && !s) s = p.t; if (p.v !== 1 && s) { out.push({ from: s, to: last }); s = null; } last = p.t; }
  if (s) out.push({ from: s, to: last });
  return out;
}

// --- FRED series shown with their original publisher's credit -----------------------------------
/**
 * Series read through the FRED API (FRED_API_KEY), each credited to its original publisher.
 * Only series whose publishers allow reuse with attribution are listed (U.S. government data,
 * Federal Reserve Banks' surveys); proprietary series on FRED (ICE BofA, S&P, Moody's) are left out.
 * `diff` builds a spread from two series (a − b, in basis points when `bp`).
 */
export type FredSpec2 = { id: string; code: string; name: string; unit: string; cat: MacroSeries["cat"]; freq: "D" | "W" | "M"; src: string; from?: number; minus?: string; bp?: boolean; notes: string };
export const FRED_SERIES: FredSpec2[] = [
  { id: "T5YIE", code: "BE5Y", name: "5-year breakeven inflation (Treasury market)", unit: "%", cat: "in", freq: "D", src: "U.S. Treasury and Federal Reserve via FRED (T5YIE)", notes: "5-year Treasury yield minus 5-year TIPS yield: the inflation rate the bond market prices in. A free stand-in for a 5-year inflation swap." },
  { id: "T10YIE", code: "BE10Y", name: "10-year breakeven inflation (Treasury market)", unit: "%", cat: "in", freq: "D", src: "U.S. Treasury and Federal Reserve via FRED (T10YIE)", notes: "10-year Treasury yield minus 10-year TIPS yield. A free stand-in for a 10-year inflation swap." },
  { id: "DCPF3M", minus: "DTB3", bp: true, code: "CPBILL", name: "Bank funding stress: 3-month AA financial commercial paper minus 3-month Treasury bill", unit: "bp", cat: "mp", freq: "D", src: "Federal Reserve Board (commercial paper rates and H.15 Treasury bills), via FRED; calculated", notes: "Unsecured short-term borrowing cost of highly rated financial firms over the 3-month bill rate, in basis points. Like the old TED spread it carries bank credit risk; both rates are on a discount basis." },
  { id: "SOFR", minus: "DTB3", bp: true, code: "FUNDSPRD", name: "Funding spread: SOFR minus 3-month Treasury bill (TED spread replacement)", unit: "bp", cat: "mp", freq: "D", src: "Federal Reserve Bank of New York (SOFR) and Federal Reserve Board H.15 (3-month bill), via FRED; calculated", notes: "Secured overnight funding rate minus the 3-month Treasury bill rate (discount basis), in basis points. Replaces the TED spread, which was discontinued with LIBOR. Widening signals funding stress." },
  // Regional Federal Reserve manufacturing surveys: free, attributable stand-ins for the (licensed) ISM PMI. Diffusion indexes: above 0 = expansion.
  { id: "GACDFSA066MSFRBPHI", code: "PHILLYMFG", name: "Philadelphia Fed manufacturing: current general activity", unit: "index (diffusion, SA)", cat: "gr", freq: "M", src: "Federal Reserve Bank of Philadelphia, Manufacturing Business Outlook Survey (via FRED)", notes: "Share of firms reporting increases minus share reporting decreases, seasonally adjusted. Above zero means expansion. Not the ISM PMI, which is licensed." },
  { id: "GACDISA066MSFRBNY", code: "EMPIREMFG", name: "New York Fed Empire State manufacturing: general business conditions", unit: "index (diffusion, SA)", cat: "gr", freq: "M", src: "Federal Reserve Bank of New York, Empire State Manufacturing Survey (via FRED)", notes: "Diffusion index, seasonally adjusted; above zero means expansion. Not the ISM PMI." },
  { id: "BACTSAMFRBDAL", code: "DALLASMFG", name: "Dallas Fed Texas manufacturing: general business activity", unit: "index (diffusion, SA)", cat: "gr", freq: "M", src: "Federal Reserve Bank of Dallas, Texas Manufacturing Outlook Survey (via FRED)", notes: "Diffusion index, seasonally adjusted; above zero means expansion. Not the ISM PMI." },
  { id: "T5YIFR", code: "BE5Y5Y", name: "5-year, 5-year forward inflation expectation", unit: "%", cat: "in", freq: "D", src: "Federal Reserve Bank of St. Louis via FRED (T5YIFR)", notes: "Expected average inflation over the five years starting five years from now, from Treasury and TIPS yields." },
];
/** Daily or monthly observations for the listed FRED series (and spreads between two of them). */
export async function fredSeriesList(specs: FredSpec2[] = FRED_SERIES, now = new Date()): Promise<MacroSeries[]> {
  const key = requireKey("FRED", "FRED_API_KEY"); const out: MacroSeries[] = []; const errors: string[] = [];
  const get = async (id: string, from: string) => {
    const r = await getJson<{ observations?: { date: string; value: string }[] }>("FRED", buildUrl("https://api.stlouisfed.org/fred", "/series/observations", { api_key: key, file_type: "json", series_id: id, observation_start: from }));
    return new Map((r.observations ?? []).flatMap((o) => { const v = Number(o.value); return o.value !== "." && Number.isFinite(v) ? [[o.date, v] as [string, number]] : []; }));
  };
  // FRED carries some proprietary series (ICE BofA, S&P, Moody's) whose owners forbid reuse without permission.
  // Their notes say so; such a series is skipped rather than shown.
  const restricted = async (id: string) => {
    const r = await getJson<{ seriess?: { notes?: string }[] }>("FRED", buildUrl("https://api.stlouisfed.org/fred", "/series", { api_key: key, file_type: "json", series_id: id }));
    return /prior written permission|reproduction (is )?prohibited|not be reproduced|all rights reserved/i.test(r.seriess?.[0]?.notes ?? "");
  };
  for (const s of specs) {
    const from = `${now.getUTCFullYear() - (s.from ?? (s.freq === "D" ? 5 : 20))}-01-01`;
    try {
      const blocked = (await Promise.all([s.id, ...(s.minus ? [s.minus] : [])].map((id) => restricted(id).catch(() => false)))).some(Boolean);
      if (blocked) { errors.push(`${s.id}: the series owner restricts reuse (FRED notes); skipped`); continue; }
      const a = await get(s.id, from); const b = s.minus ? await get(s.minus, from) : null;
      const pts = [...a].flatMap(([d, v]) => { if (b && !b.has(d)) return []; const x = b ? (v - b.get(d)!) * (s.bp ? 100 : 1) : v; const t = s.freq === "M" ? periodEnd(d.slice(0, 7)) : d; return t ? [{ t, v: Number(x.toFixed(s.bp ? 1 : 3)) }] : []; });
      if (pts.length) out.push({ cc: "US", code: s.code, name: s.name, unit: s.unit, cat: s.cat, freq: s.freq, src: s.src, url: `https://fred.stlouisfed.org/series/${s.id}`, notes: s.notes, points: sortPts(pts) });
    } catch (e) { errors.push(`${s.id}: ${(e as Error).message}`); }
  }
  if (errors.length === specs.length) throw new ProviderError("FRED", errors[0]);
  return out;
}

// --- Market proxies for licensed benchmarks (EODHD end-of-day prices) ------------------------------
/**
 * Exchange-traded funds that track a benchmark the app can't show without a licence. Each becomes a
 * data-desk instrument named as a proxy, with a note saying what it is and who owns the real benchmark.
 */
export const PROXIES: { id: string; sym: string; tk: string; name: string; exch: string; of: string; owner: string }[] = [
  { id: "AD.PX.SRUUF", sym: "SRUUF.US", tk: "SRUUF", name: "Sprott Physical Uranium Trust (uranium proxy)", exch: "OTC (TSX: U.UN)", of: "the U3O8 spot price", owner: "UxC and TradeTech (licensed)" },
  { id: "AD.PX.URNM", sym: "URNM.US", tk: "URNM", name: "Sprott Uranium Miners ETF (uranium proxy)", exch: "NYSE Arca", of: "uranium prices, through uranium miners", owner: "UxC and TradeTech (licensed)" },
  { id: "AD.PX.LIT", sym: "LIT.US", tk: "LIT", name: "Global X Lithium & Battery Tech ETF (lithium proxy)", exch: "NYSE Arca", of: "lithium prices, through lithium and battery equities", owner: "Fastmarkets, Benchmark, SMM (licensed)" },
  { id: "AD.PX.KRBN", sym: "KRBN.US", tk: "KRBN", name: "KraneShares Global Carbon ETF (carbon proxy)", exch: "NYSE Arca", of: "carbon allowance prices (EUA, CCA, UKA, RGGI futures)", owner: "ICE and EEX (licensed)" },
  { id: "AD.PX.BDRY", sym: "BDRY.US", tk: "BDRY", name: "Breakwave Dry Bulk Shipping ETF (dry-bulk freight proxy)", exch: "NYSE Arca", of: "the Baltic Dry Index, through dry-bulk freight futures", owner: "the Baltic Exchange (licensed)" },
  { id: "AD.PX.BWET", sym: "BWET.US", tk: "BWET", name: "Breakwave Tanker Shipping ETF (TD3C proxy)", exch: "NYSE Arca", of: "the TD3C VLCC tanker rate, through tanker freight futures", owner: "the Baltic Exchange (licensed)" },
  { id: "AD.PX.DJP", sym: "DJP.US", tk: "DJP", name: "iPath Bloomberg Commodity Index ETN (BCOM proxy)", exch: "NYSE Arca", of: "the Bloomberg Commodity Index (total return)", owner: "Bloomberg (licensed)" },
  { id: "AD.PX.GSG", sym: "GSG.US", tk: "GSG", name: "iShares S&P GSCI Commodity-Indexed Trust (S&P GSCI proxy)", exch: "NYSE Arca", of: "the S&P GSCI", owner: "S&P Dow Jones Indices (licensed)" },
];
type EodRow = { date?: string; close?: unknown; adjusted_close?: unknown };
/** About 18 months of daily closes for each proxy. One failing symbol loses only that one. */
export async function proxyPrices(now: Date): Promise<InstSeries[]> {
  const from = dayAdd(now, -550); const out: InstSeries[] = []; const errors: string[] = [];
  for (const p of PROXIES) {
    try {
      const rows = await eod<EodRow[]>(`/eod/${p.sym}`, { from, period: "d", order: "a" });
      const points = (Array.isArray(rows) ? rows : []).flatMap((r) => { const v = Number(r.adjusted_close ?? r.close); return r.date && Number.isFinite(v) && v > 0 ? [{ t: String(r.date).slice(0, 10), v }] : []; });
      if (points.length) out.push({ id: p.id, points, src: `EODHD end-of-day prices (${p.sym})`, note: `Proxy, not the benchmark: the price of ${p.tk}, an exchange-traded product that tracks ${p.of}. The benchmark itself belongs to ${p.owner}.`,
        meta: { type: "etf", tk: p.tk, name: p.name, exch: p.exch, country: "US", ccy: "USD", sector: "Commodity proxies", industry: "Exchange-traded product" } });
    } catch (e) { errors.push(`${p.sym}: ${(e as Error).message}`); }
  }
  if (errors.length === PROXIES.length) throw new ProviderError("EODHD", errors[0]);
  return out;
}
