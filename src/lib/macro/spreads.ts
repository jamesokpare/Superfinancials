/**
 * Free stand-ins for two licensed market series:
 *
 *   EM sovereign spread   iShares J.P. Morgan USD Emerging Markets Bond ETF (EMB): the average yield to
 *                         maturity and effective duration published on the fund's page, minus the U.S.
 *                         Treasury par yield interpolated at that duration. A labelled proxy, not the
 *                         J.P. Morgan EMBI spread (licensed). Only the calculated spread is stored.
 *   EU carbon             EEX EU Allowance (EUA) primary auction clearing prices, from the auction reports
 *                         EEX publishes as the common auction platform under the EU Auctioning Regulation.
 *
 * Both pages publish only recent values, so their series are kept and added to day by day.
 */
import { ProviderError } from "@/lib/providers/http";
import { BROWSER_UA, periodEnd, type MacroSeries, type Point } from "./sources";
import { readXlsx } from "./xlsx";

const strip = (html: string) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const MON3: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
async function page(name: string, url: string): Promise<string> {
  let r: Response;
  try { r = await fetch(url, { headers: { ...BROWSER_UA, accept: "text/html" }, signal: AbortSignal.timeout(45_000) }); } catch (e) { throw new ProviderError(name, `request failed: ${(e as Error).message}`); }
  const t = await r.text(); if (!r.ok) throw new ProviderError(name, `HTTP ${r.status}`, r.status); return t;
}

// --- EMB-based EM sovereign spread ----------------------------------------------------------------------------------
export const EMB_URL = "https://www.ishares.com/us/products/239572/ishares-jp-morgan-usd-emerging-markets-bond-etf";
export type EmbStats = { t: string; ytm: number; dur: number };
/** Average yield to maturity, effective duration and their "as of" date from the fund page. */
export function parseEmbPage(html: string): EmbStats | null {
  const text = strip(html);
  const after = (label: RegExp, n = 500) => { const m = text.match(label); return m ? text.slice(m.index! + m[0].length, m.index! + m[0].length + n) : ""; };
  const yw = after(/Average Yield to Maturity/i), dw = after(/Effective Duration/i);
  const ytm = Number(yw.match(/(-?\d{1,2}\.\d{1,3})\s*%/)?.[1]); const dur = Number(dw.match(/(\d{1,2}\.\d{1,3})\s*(?:yrs|years)/i)?.[1]);
  const asOf = (yw.match(/as of\s+([A-Z][a-z]{2})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/) ?? text.match(/as of\s+([A-Z][a-z]{2})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/));
  const t = asOf && MON3[asOf[1].toLowerCase()] ? `${asOf[3]}-${MON3[asOf[1].toLowerCase()]}-${asOf[2].padStart(2, "0")}` : null;
  return t && Number.isFinite(ytm) && Number.isFinite(dur) && dur > 0 ? { t, ytm, dur } : null;
}
export async function embStats(): Promise<EmbStats> {
  const s = parseEmbPage(await page("iShares", EMB_URL));
  if (!s) throw new ProviderError("iShares", "average yield to maturity or effective duration not found on the EMB page");
  return s;
}
/** Linear interpolation of a yield curve [years, %] at maturity m (flat beyond the ends). */
export function interpCurve(curve: [number, number][], m: number): number | null {
  const c = curve.filter(([, y]) => Number.isFinite(y)).sort((a, b) => a[0] - b[0]); if (!c.length) return null;
  if (m <= c[0][0]) return c[0][1]; if (m >= c.at(-1)![0]) return c.at(-1)![1];
  for (let i = 1; i < c.length; i++) if (m <= c[i][0]) { const [x0, y0] = c[i - 1], [x1, y1] = c[i]; return y0 + ((y1 - y0) * (m - x0)) / (x1 - x0); }
  return null;
}
/** Latest value on or before t. */
const onOrBefore = (pts: Point[], t: string) => { let v: number | undefined; for (const p of [...pts].sort((a, b) => (a.t < b.t ? -1 : 1))) { if (p.t <= t) v = p.v; else break; } return v; };
export const UST_MATURITY: Record<string, number> = { "YD.US3M": 0.25, "YD.US1Y": 1, "YD.US2": 2, "YD.US5": 5, "YD.US10": 10, "YD.US30": 30 };
export function embSpread(s: EmbStats, ust: Record<string, Point[]>): MacroSeries[] {
  const curve = Object.entries(UST_MATURITY).flatMap(([id, m]) => { const v = onOrBefore(ust[id] ?? [], s.t); return v == null ? [] : [[m, v] as [number, number]]; });
  if (curve.length < 2) return [];
  const y = interpCurve(curve, s.dur); if (y == null) return [];
  return [{ cc: "US", code: "EMSPRD", name: "EM sovereign spread proxy: EMB yield minus Treasury at its duration", unit: "bp", cat: "mk", freq: "D", src: "Calculated from iShares EMB published fund data and the U.S. Treasury par curve", url: EMB_URL,
    notes: `Average yield to maturity of the iShares J.P. Morgan USD Emerging Markets Bond ETF minus the U.S. Treasury par yield interpolated at the fund's effective duration (${s.dur} years on ${s.t}). A proxy for the EM sovereign spread, not the J.P. Morgan EMBI spread (a licensed index). Fund figures: BlackRock iShares; Treasury yields: U.S. Treasury (public domain).`,
    points: [{ t: s.t, v: Number(((s.ytm - y) * 100).toFixed(1)) }] }];
}

// --- EEX EUA primary auctions ------------------------------------------------------------------------------------
export const EEX_AUCTION_PAGE = "https://www.eex.com/en/market-data/environmentals/eex-eua-primary-auction-spot-download";
/** Auction report workbooks linked from the download page, newest year first (this year and last). */
export function eexReportLinks(html: string, year: number, base = EEX_AUCTION_PAGE): string[] {
  const out = new Map<string, number>();
  for (const m of html.matchAll(/href=["']([^"']+\.xlsx)(?:\?[^"']*)?["']/gi)) {
    let url: string; try { url = new URL(m[1], base).toString(); } catch { continue; }
    if (!/auction/i.test(url) || /calendar|history|archive/i.test(url)) continue;
    const y = Math.max(0, ...[...url.matchAll(/(20\d{2})/g)].map((x) => +x[1]));
    if (!y || y >= year - 1) out.set(url, y);
  }
  return [...out].sort((a, b) => b[1] - a[1]).map(([u]) => u).slice(0, 2);
}
const xlDay = (v: string | number) => {
  if (typeof v === "number") return v > 20000 && v < 80000 ? new Date(Math.round((v - 25569) * 864e5)).toISOString().slice(0, 10) : null;
  const s = v.trim(); let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/))) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return periodEnd(s);
};
/** Clearing prices of EUA auctions (not EUAA aviation allowances, not cancelled auctions), averaged per day. */
export function readEexAuctions(rows: (string | number)[][]): Point[] {
  const h = rows.findIndex((r) => r.some((c) => /auction price/i.test(String(c))) && r.some((c) => /^date$|^auction date$/i.test(String(c).trim())));
  if (h < 0) return [];
  const head = rows[h].map((c) => String(c).trim()); const col = (re: RegExp) => head.findIndex((c) => re.test(c));
  const cDate = col(/^(auction )?date$/i), cPrice = col(/auction price/i), cStatus = col(/status/i);
  const cNames = head.flatMap((c, i) => (/auction name|contract|product/i.test(c) ? [i] : []));
  const by = new Map<string, number[]>();
  for (const r of rows.slice(h + 1)) {
    const t = r[cDate] != null ? xlDay(r[cDate]) : null; const v = Number(r[cPrice]); const name = cNames.length ? cNames.map((i) => String(r[i] ?? "")).join(" ") : "EUA";
    if (!t || !Number.isFinite(v) || v <= 0 || /EUAA|aviation/i.test(name) || (cNames.length > 0 && !/EUA/i.test(name)) || (cStatus >= 0 && /cancel/i.test(String(r[cStatus])))) continue;
    (by.get(t) ?? by.set(t, []).get(t)!).push(v);
  }
  return [...by].sort(([a], [b]) => (a < b ? -1 : 1)).map(([t, vs]) => ({ t, v: Number((vs.reduce((a, b) => a + b, 0) / vs.length).toFixed(2)) }));
}
export async function eexEuaAuctions(now: Date): Promise<MacroSeries[]> {
  const links = eexReportLinks(await page("EEX", EEX_AUCTION_PAGE), now.getUTCFullYear());
  if (!links.length) throw new ProviderError("EEX", "no auction report workbook linked on the download page");
  const pts: Point[] = []; const errs: string[] = [];
  for (const url of links) {
    try { const r = await fetch(url, { headers: BROWSER_UA, signal: AbortSignal.timeout(60_000) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); pts.push(...readEexAuctions(readXlsx(Buffer.from(await r.arrayBuffer())))); }
    catch (e) { errs.push((e as Error).message); }
  }
  if (!pts.length) throw new ProviderError("EEX", errs[0] ?? "no EUA auction prices in the reports");
  const m = new Map(pts.map((p) => [p.t, p.v]));
  return [{ cc: "EU", code: "EUAAUC", name: "EU carbon: EUA primary auction clearing price", unit: "EUR/tCO2", cat: "mk", freq: "D", src: "EEX (common auction platform), EUA primary auction results", url: EEX_AUCTION_PAGE,
    notes: "Clearing price of the EU Allowance primary auctions held on the European Energy Exchange for the EU ETS (several a week; days with more than one auction show the average). An official auction result, not the secondary-market futures price. Source: EEX auction reports.",
    points: [...m].sort(([a], [b]) => (a < b ? -1 : 1)).map(([t, v]) => ({ t, v })) }];
}
