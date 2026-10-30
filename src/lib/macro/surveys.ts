/**
 * Surveys and expectations from official publishers (no key):
 *
 *   OECD         composite leading indicator, business and consumer confidence   CC BY 4.0
 *   Eurostat     European Commission Economic Sentiment Indicator and consumer   CC BY 4.0 (data: European Commission, DG ECFIN)
 *                confidence, by EU country and the euro area
 *   ECB          Survey of Professional Forecasters (euro area)                  ECB reuse policy: free with the source quoted
 *   Bank of      implied inflation curve (spot, from index-linked gilts)         Bank of England terms: reuse with credit
 *   England
 *   NBS China    official manufacturing, non-manufacturing and composite PMI     reuse with the source cited
 *                (read from the English press releases)
 *
 * Series marked `keep` are merged with what is already stored: the BoE
 * "latest" file and the NBS press releases only cover recent periods.
 */
import { ProviderError } from "@/lib/providers/http";
import { buildUrl } from "@/lib/providers/http";
import { BROWSER_UA, ecbSeries, getBuf, getCsv, OECD_AREAS, periodEnd, type MacroSeries, type Point } from "./sources";
import { readXlsx, unzip } from "./xlsx";

export type KeptSeries = MacroSeries & { keep?: boolean };
const sortPts = (pts: Point[]) => { const m = new Map(pts.map((p) => [p.t, p.v])); return [...m].sort(([a], [b]) => (a < b ? -1 : 1)).map(([t, v]) => ({ t, v })); };

// --- OECD composite leading indicators and confidence -----------------------------------------------------
export const OECD_CLI_MEASURES: Record<string, { code: string; name: string; notes: string }> = {
  LI: { code: "CLI", name: "OECD composite leading indicator", notes: "Amplitude-adjusted composite leading indicator (long-term average = 100). Above 100 and rising: growth above trend ahead; turning points lead the business cycle by about 6–9 months." },
  BCICP: { code: "BCI", name: "OECD business confidence indicator", notes: "Business confidence (manufacturing survey composite), amplitude adjusted, long-term average = 100." },
  CCICP: { code: "CCI", name: "OECD consumer confidence indicator", notes: "Consumer confidence (household survey composite), amplitude adjusted, long-term average = 100." },
};
/** Several variants can come back for one country and measure; the amplitude-adjusted level index is preferred. */
const cliRank = (r: Record<string, string>) => (r.ADJUSTMENT === "AA" ? 0 : 4) + (/^(IX|_Z)$/.test(r.TRANSFORMATION ?? "_Z") ? 0 : 2) + (r.METHODOLOGY === "H" || !r.METHODOLOGY ? 0 : 1);
export function parseOecdCli(rows: Record<string, string>[]): KeptSeries[] {
  const best = new Map<string, { rank: number; key: string }>(); const pts = new Map<string, Point[]>();
  for (const r of rows) {
    const cc = OECD_AREAS[r.REF_AREA ?? ""]; const m = OECD_CLI_MEASURES[r.MEASURE ?? ""]; const t = periodEnd(r.TIME_PERIOD ?? ""); const v = Number(r.OBS_VALUE);
    if (!cc || !m || !t || r.OBS_VALUE === "" || !Number.isFinite(v)) continue;
    const key = [r.UNIT_MEASURE, r.ACTIVITY, r.ADJUSTMENT, r.TRANSFORMATION, r.TIME_HORIZ, r.METHODOLOGY].join("|"); const id = `${cc}|${r.MEASURE}`;
    const rank = cliRank(r); const cur = best.get(id);
    if (!cur || rank < cur.rank) best.set(id, { rank, key });
    (pts.get(`${id}|${key}`) ?? pts.set(`${id}|${key}`, []).get(`${id}|${key}`)!).push({ t, v: Number(v.toFixed(2)) });
  }
  return [...best].map(([id, b]) => {
    const [cc, meas] = id.split("|"); const m = OECD_CLI_MEASURES[meas];
    return { cc, code: m.code, name: m.name, unit: "index (LTA = 100)", cat: "gr" as const, freq: "M" as const, src: "OECD Composite Leading Indicators", url: "https://www.oecd.org/en/data/indicators/composite-leading-indicator-cli.html", notes: `${m.notes} Source: OECD (2026), Composite leading indicators (MEI), CC BY 4.0.`, points: sortPts(pts.get(`${id}|${b.key}`) ?? []) };
  }).filter((s) => s.points.length);
}
export async function oecdCli(from: string): Promise<KeptSeries[]> {
  const rows = await getCsv("OECD", buildUrl("https://sdmx.oecd.org/public/rest", `/data/OECD.SDD.STES,DSD_STES@DF_CLI,/.M.${Object.keys(OECD_CLI_MEASURES).join("+")}......`, { startPeriod: from.slice(0, 7), format: "csvfile" }), 120_000, 2, BROWSER_UA);
  const out = parseOecdCli(rows);
  if (!out.length) throw new ProviderError("OECD", `no leading-indicator rows (${rows.length} rows read)`);
  return out;
}

// --- JSON-stat (Eurostat) -------------------------------------------------------------------------------------
type JsonStat = { id?: string[]; size?: number[]; value?: Record<string, number | null> | (number | null)[]; dimension?: Record<string, { category?: { index?: Record<string, number> | string[] } }> };
/** Flattens a JSON-stat 2.0 dataset into rows of dimension codes and a value. */
export function jsonStatRows(js: JsonStat): (Record<string, string> & { value: number })[] {
  const ids = js.id ?? [], size = js.size ?? []; if (!ids.length) return [];
  const codes = ids.map((d) => { const idx = js.dimension?.[d]?.category?.index ?? {}; const arr: string[] = []; if (Array.isArray(idx)) idx.forEach((c, i) => (arr[i] = c)); else for (const [c, i] of Object.entries(idx)) arr[i] = c; return arr; });
  const stride = ids.map((_, i) => size.slice(i + 1).reduce((a, b) => a * b, 1));
  const vals: [number, number | null][] = Array.isArray(js.value) ? js.value.map((v, i) => [i, v]) : Object.entries(js.value ?? {}).map(([k, v]) => [Number(k), v]);
  const out: (Record<string, string> & { value: number })[] = [];
  for (const [flat, v] of vals) {
    if (v == null || !Number.isFinite(v)) continue;
    const row: Record<string, string> = {}; ids.forEach((d, i) => { row[d] = codes[i][Math.floor(flat / stride[i]) % size[i]]; });
    out.push(Object.assign(row, { value: v }) as unknown as Record<string, string> & { value: number });
  }
  return out;
}

// --- European Commission sentiment (via Eurostat) ------------------------------------------------------------
const ESTAT_GEO: Record<string, string> = { EL: "GR", EA20: "EU", EA: "EU", UK: "UK" };
export const EC_INDICATORS: Record<string, { code: string; name: string; unit: string; notes: string }> = {
  "BS-ESI-I": { code: "ESI", name: "Economic Sentiment Indicator (European Commission)", unit: "index (LTA = 100)", notes: "Composite of industry, services, consumer, retail and construction confidence; long-term average = 100." },
  "BS-CSMCI-BAL": { code: "CONSCONF", name: "Consumer confidence (European Commission)", unit: "balance, %", notes: "Consumer confidence indicator: balance of positive over negative answers, seasonally adjusted." },
};
export function parseEcSentiment(js: JsonStat, countries?: Set<string>): KeptSeries[] {
  const by = new Map<string, Point[]>();
  for (const r of jsonStatRows(js)) {
    const ind = EC_INDICATORS[r.indic]; const geo = r.geo ?? ""; const cc = ESTAT_GEO[geo] ?? (/^[A-Z]{2}$/.test(geo) ? geo : ""); const t = periodEnd(r.time ?? "");
    if (!ind || !cc || !t || (countries && !countries.has(cc))) continue;
    if (geo === "EA" && by.has(`EU|${r.indic}|EA20`)) continue;
    const k = `${cc}|${r.indic}|${geo === "EA" || geo === "EA20" ? geo : ""}`; (by.get(k) ?? by.set(k, []).get(k)!).push({ t, v: r.value });
  }
  const out: KeptSeries[] = [];
  for (const [k, pts] of by) {
    const [cc, indic, ea] = k.split("|"); if (ea === "EA" && by.has(`EU|${indic}|EA20`)) continue; const ind = EC_INDICATORS[indic];
    out.push({ cc, code: ind.code, name: ind.name, unit: ind.unit, cat: "gr", freq: "M", src: "European Commission (DG ECFIN) Business and Consumer Surveys, via Eurostat", url: "https://economy-finance.ec.europa.eu/economic-forecast-and-surveys/business-and-consumer-surveys_en", notes: `${ind.notes} Source: European Commission, DG ECFIN, published by Eurostat (ei_bssi_m_r2), CC BY 4.0.`, points: sortPts(pts) });
  }
  return out;
}
export async function ecSentiment(from: string, countries?: Set<string>): Promise<KeptSeries[]> {
  const url = `https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/ei_bssi_m_r2?format=JSON&lang=EN&s_adj=SA&${Object.keys(EC_INDICATORS).map((i) => `indic=${i}`).join("&")}&sinceTimePeriod=${from.slice(0, 7)}`;
  let res: Response;
  try { res = await fetch(url, { headers: { ...BROWSER_UA, accept: "application/json" }, signal: AbortSignal.timeout(90_000) }); } catch (e) { throw new ProviderError("Eurostat", `request failed: ${(e as Error).message}`); }
  const text = await res.text(); if (!res.ok) throw new ProviderError("Eurostat", `HTTP ${res.status}: ${text.slice(0, 160)}`, res.status);
  const out = parseEcSentiment(JSON.parse(text) as JsonStat, countries);
  if (!out.length) throw new ProviderError("Eurostat", "no sentiment observations returned");
  return out;
}

// --- ECB Survey of Professional Forecasters ----------------------------------------------------------------------
export const SPF_KEYS: { key: string; code: string; name: string; unit: string; cat: MacroSeries["cat"]; notes: string }[] = [
  { key: "Q.U2.HICP.POINT.LT.Q.AVG", code: "SPF.HICPLT", name: "SPF: longer-term inflation expectation (HICP)", unit: "%", cat: "in", notes: "Average point forecast of euro-area HICP inflation about five years ahead (four years ahead in Q1 and Q2 rounds)." },
  { key: "M.U2.HICP.POINT.P12M.Q.AVG", code: "SPF.HICP1Y", name: "SPF: inflation expected one year ahead (HICP)", unit: "%", cat: "in", notes: "Average point forecast of euro-area HICP inflation 12 months after the latest observed month (rolling horizon)." },
  { key: "M.U2.HICP.POINT.P24M.Q.AVG", code: "SPF.HICP2Y", name: "SPF: inflation expected two years ahead (HICP)", unit: "%", cat: "in", notes: "Average point forecast of euro-area HICP inflation 24 months ahead (rolling horizon)." },
  { key: "Q.U2.RGDP.POINT.LT.Q.AVG", code: "SPF.GDPLT", name: "SPF: longer-term real GDP growth expectation", unit: "%", cat: "gr", notes: "Average point forecast of euro-area real GDP growth about five years ahead." },
  { key: "Q.U2.UNEM.POINT.LT.Q.AVG", code: "SPF.UNEMLT", name: "SPF: longer-term unemployment expectation", unit: "% of labour force", cat: "lb", notes: "Average point forecast of the euro-area unemployment rate about five years ahead." },
];
/** SPF observations are dated by survey round ("2026-Q3") or month; each becomes the period's last day. */
export async function ecbSpf(fromYear: number): Promise<KeptSeries[]> {
  const out: KeptSeries[] = []; const errs: string[] = [];
  for (const s of SPF_KEYS) {
    try {
      const pts = sortPts((await ecbSeries("SPF", s.key, `${fromYear}`)).flatMap((p) => { const t = periodEnd(p.t); return t ? [{ t, v: Number(p.v.toFixed(2)) }] : []; }));
      if (pts.length) out.push({ cc: "EU", code: s.code, name: s.name, unit: s.unit, cat: s.cat, freq: "Q", src: "ECB Survey of Professional Forecasters", url: `https://data.ecb.europa.eu/data/datasets/SPF/SPF.${s.key}`, notes: `${s.notes} Source: European Central Bank, Survey of Professional Forecasters (SPF.${s.key}).`, points: pts });
    } catch (e) { errs.push(`${s.code}: ${(e as Error).message}`); }
  }
  if (!out.length) throw new ProviderError("ECB", errs.slice(0, 2).join(" | ") || "no SPF observations returned");
  return out;
}

// --- Bank of England implied inflation curve ------------------------------------------------------------------
export const BOE_CURVES = "https://www.bankofengland.co.uk/statistics/yield-curves";
export const BOE_LATEST_ZIP = "https://www.bankofengland.co.uk/-/media/boe/files/statistics/yield-curves/latest-yield-curve-data.zip";
export const BOE_INFL_ARCHIVE = "https://www.bankofengland.co.uk/-/media/boe/files/statistics/yield-curves/glcinflationddata.zip";
const xlDate = (n: number) => (n > 20000 && n < 80000 ? new Date(Math.round((n - 25569) * 864e5)).toISOString().slice(0, 10) : null);
/** Rows of a "spot curve" sheet: a header row of maturities in years, then one row per date (Excel serial). Returns maturity → points. */
export function parseBoeSpot(rows: (string | number)[][], want: number[]): Map<number, Point[]> {
  const h = rows.findIndex((r) => { const ns = r.slice(1).filter((c) => typeof c === "number") as number[]; return ns.length >= 8 && want.every((w) => ns.includes(w)); });
  const out = new Map<number, Point[]>(want.map((w) => [w, []])); if (h < 0) return out;
  const col = new Map(want.map((w) => [w, rows[h].indexOf(w)]));
  for (const r of rows.slice(h + 1)) {
    const t = typeof r[0] === "number" ? xlDate(r[0]) : /^\d{4}-\d{2}-\d{2}/.test(String(r[0])) ? String(r[0]).slice(0, 10) : null; if (!t) continue;
    for (const [w, c] of col) { const v = r[c]; if (typeof v === "number" && Number.isFinite(v)) out.get(w)!.push({ t, v: Number(v.toFixed(3)) }); }
  }
  return out;
}
const BOE_MATS = [5, 10, 20];
function boeSeries(by: Map<number, Point[]>): KeptSeries[] {
  const credit = "Source: Bank of England, UK yield curves (implied inflation, Anderson–Sleath spline), reused with credit under the Bank of England terms.";
  const out: KeptSeries[] = BOE_MATS.flatMap((m) => { const pts = sortPts(by.get(m) ?? []); return pts.length ? [{ cc: "UK", code: `INFL${m}Y`, name: `Implied RPI inflation, ${m}-year spot (gilt market)`, unit: "%", cat: "in" as const, freq: "D" as const, src: "Bank of England yield curves", url: BOE_CURVES, notes: `Inflation rate implied by nominal and index-linked gilts, ${m}-year spot. RPI-based (the gilt market's measure), not CPI. ${credit}`, points: pts, keep: true }] : []; });
  // 5y5y forward: ((1+s10)^10 / (1+s5)^5)^(1/5) - 1
  const s5 = new Map((by.get(5) ?? []).map((p) => [p.t, p.v])); const fwd = (by.get(10) ?? []).flatMap((p) => { const a = s5.get(p.t); return a == null ? [] : [{ t: p.t, v: Number(((Math.pow(Math.pow(1 + p.v / 100, 10) / Math.pow(1 + a / 100, 5), 1 / 5) - 1) * 100).toFixed(3)) }]; });
  if (fwd.length) out.push({ cc: "UK", code: "INFL5Y5Y", name: "Implied RPI inflation, 5-year rate 5 years ahead (gilt market)", unit: "%", cat: "in", freq: "D", src: "Bank of England yield curves (calculated)", url: BOE_CURVES, notes: `Calculated from the Bank of England 5- and 10-year implied inflation spot rates: ((1+s10)^10/(1+s5)^5)^(1/5) − 1. ${credit}`, points: sortPts(fwd), keep: true });
  return out;
}
function boeFromZip(buf: Buffer, pick: (name: string) => boolean): Map<number, Point[]> {
  const by = new Map<number, Point[]>(BOE_MATS.map((m) => [m, []]));
  for (const [name, file] of unzip(buf)) {
    if (!/\.xlsx$/i.test(name) || !pick(name)) continue;
    let rows: (string | number)[][]; try { rows = readXlsx(file, "4. spot curve"); } catch { continue; }
    for (const [m, pts] of parseBoeSpot(rows, BOE_MATS)) by.get(m)!.push(...pts);
  }
  return by;
}
/** Latest month from the "latest" file; the first run (no stored history) also reads the archive of recent years. */
export async function boeImpliedInflation(now: Date, state: Record<string, unknown>): Promise<{ series: KeptSeries[]; state: Record<string, unknown> }> {
  const by = boeFromZip(await getBuf("Bank of England", BOE_LATEST_ZIP), (n) => /inflation/i.test(n) && /daily/i.test(n));
  let seeded = !!state.boeInflSeeded;
  if (!seeded) {
    try {
      const minYear = now.getUTCFullYear() - 6;
      const arch = boeFromZip(await getBuf("Bank of England", BOE_INFL_ARCHIVE), (n) => { const ys = [...n.matchAll(/(\d{4})/g)].map((m) => +m[1]); return /present/i.test(n) || ys.some((y) => y >= minYear); });
      for (const [m, pts] of arch) by.get(m)!.push(...pts.filter((p) => +p.t.slice(0, 4) >= minYear));
      seeded = true;
    } catch { /* the archive is large; tried again next run */ }
  }
  const series = boeSeries(by);
  if (!series.length) throw new ProviderError("Bank of England", "no implied inflation spot curve found in the yield-curve files");
  return { series, state: { boeInflSeeded: seeded } };
}

// --- China NBS official PMI (English press releases) -------------------------------------------------------------
export const NBS_LIST = "https://www.stats.gov.cn/english/PressRelease/";
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const strip = (html: string) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&#39;|&rsquo;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
/** PMI release links on the press-release list, newest first: { url, title, released }. */
export function nbsPmiLinks(html: string, base = NBS_LIST): { url: string; title: string; released: string | null }[] {
  const out = new Map<string, { url: string; title: string; released: string | null }>();
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const title = strip(m[2]).trim(); if (!/purchasing managers/i.test(title)) continue;
    let url: string; try { url = new URL(m[1], base).toString(); } catch { continue; }
    const d = url.match(/t(\d{4})(\d{2})(\d{2})_/); out.set(url, { url, title, released: d ? `${d[1]}-${d[2]}-${d[3]}` : null });
  }
  return [...out.values()].sort((a, b) => String(b.released).localeCompare(String(a.released)));
}
/** Reads the month and the three headline indexes from one release. */
export function parseNbsPmi(html: string, title: string, released: string | null): { month: string; mfg?: number; nonmfg?: number; comp?: number } | null {
  const text = strip(html); const num = (re: RegExp) => { const m = text.match(re); return m ? Number(m[1]) : undefined; };
  const mfg = num(/(?<!non-)manufacturing purchasing managers'? index \(PMI\)[^.%]{0,60}?(\d{2}\.\d)\s*(?:percent|%)/i) ?? num(/(?<!non-)manufacturing PMI[^.%]{0,40}?(\d{2}\.\d)\s*(?:percent|%)/i);
  const nonmfg = num(/non-manufacturing business activity index[^.%]{0,60}?(\d{2}\.\d)\s*(?:percent|%)/i);
  const comp = num(/composite PMI output index[^.%]{0,60}?(\d{2}\.\d)\s*(?:percent|%)/i);
  if (mfg == null && nonmfg == null && comp == null) return null;
  const tm = `${title} ${text.slice(0, 400)}`.toLowerCase().match(new RegExp(`(${MONTHS.join("|")})\\s*,?\\s*(\\d{4})`));
  let month: string | null = tm ? periodEnd(`${tm[2]}-${String(MONTHS.indexOf(tm[1]) + 1).padStart(2, "0")}`) : null;
  if (!month && released) month = periodEnd(released.slice(0, 7)); // released on the last day of the month it covers
  return month ? { month, mfg, nonmfg, comp } : null;
}
export async function nbsPmi(maxReleases = 3): Promise<KeptSeries[]> {
  const page = async (url: string) => { const r = await fetch(url, { headers: { ...BROWSER_UA, accept: "text/html" }, signal: AbortSignal.timeout(45_000) }).catch((e) => { throw new ProviderError("NBS China", `request failed: ${(e as Error).message}`); }); const t = await r.text(); if (!r.ok) throw new ProviderError("NBS China", `HTTP ${r.status}`, r.status); return t; };
  const links = nbsPmiLinks(await page(NBS_LIST)).slice(0, maxReleases);
  if (!links.length) throw new ProviderError("NBS China", "no PMI releases on the press-release list");
  const by: Record<"mfg" | "nonmfg" | "comp", Point[]> = { mfg: [], nonmfg: [], comp: [] }; let last = "";
  for (const l of links) {
    try { const r = parseNbsPmi(await page(l.url), l.title, l.released); if (!r) continue; last ||= l.url; for (const k of ["mfg", "nonmfg", "comp"] as const) if (r[k] != null) by[k].push({ t: r.month, v: r[k]! }); } catch { /* one release failing leaves the others */ }
  }
  const meta = { mfg: ["PMIMFG", "Official manufacturing PMI (NBS)"], nonmfg: ["PMINONMFG", "Official non-manufacturing business activity index (NBS)"], comp: ["PMICOMP", "Official composite PMI output index (NBS)"] } as const;
  const out: KeptSeries[] = (Object.keys(by) as (keyof typeof by)[]).filter((k) => by[k].length).map((k) => ({ cc: "CN", code: meta[k][0], name: meta[k][1], unit: "index (50 = no change)", cat: "gr" as const, freq: "M" as const, src: "National Bureau of Statistics of China", url: last || NBS_LIST, notes: `Survey by the National Bureau of Statistics and the China Federation of Logistics and Purchasing; above 50 = expansion. Read from the NBS English press releases; history builds up month by month. Source: National Bureau of Statistics of China.`, points: sortPts(by[k]), keep: true }));
  if (!out.length) throw new ProviderError("NBS China", "PMI figures not found in the releases");
  return out;
}
