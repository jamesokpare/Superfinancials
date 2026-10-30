/**
 * Calculated market series, built from inputs the macro sync already fetches
 * (or has stored), so no extra licence is involved beyond the inputs':
 *
 *   T-bill-implied policy path   forward rates between bill maturities vs the effective fed funds rate
 *                                f(t1,t2) = [(1 + y2·t2) / (1 + y1·t1) − 1] / (t2 − t1)
 *   CIP forwards                 covered-interest-parity FX forwards from spot and short rates
 *                                F = S · (1 + r_quote·d/B_quote) / (1 + r_base·d/B_base)
 *   VIX term structure           VIX/VIX3M, VIX9D/VIX, VVIX/VIX and VIX minus 21-day realised volatility
 *                                (only ratios and spreads are stored, not Cboe's index levels)
 */
import { ProviderError } from "@/lib/providers/http";
import { BROWSER_UA, ecbSeries, parseCsv, type MacroSeries, type Point } from "./sources";

const r2 = (v: number, dp = 4) => Number(v.toFixed(dp));
const asMap = (pts: Point[]) => new Map(pts.map((p) => [p.t, p.v]));

/** Simple-compounding forward rate (%, years) between two zero rates (%). */
export function impliedForward(y1: number, t1: number, y2: number, t2: number): number {
  return (((1 + (y2 / 100) * t2) / (1 + (y1 / 100) * t1) - 1) / (t2 - t1)) * 100;
}
/** Covered-interest-parity forward: spot S (quote per base), rates in %, d days, day-count bases. */
export function cipForward(S: number, rQuote: number, rBase: number, d: number, bQuote = 360, bBase = 360): number {
  return (S * (1 + (rQuote / 100) * (d / bQuote))) / (1 + (rBase / 100) * (d / bBase));
}
/** The latest value at or before each date (rates and spot are not all published on the same days). */
function asOf(pts: Point[]): (t: string) => number | undefined {
  const s = [...pts].sort((a, b) => (a.t < b.t ? -1 : 1));
  return (t) => { let lo = 0, hi = s.length - 1, ans: number | undefined; while (lo <= hi) { const mid = (lo + hi) >> 1; if (s[mid].t <= t) { ans = s[mid].v; lo = mid + 1; } else hi = mid - 1; } return ans; };
}
/** Annualised realised volatility (%) over `n` daily closes, by date. */
export function realisedVol(closes: Point[], n = 21): Point[] {
  const s = [...closes].sort((a, b) => (a.t < b.t ? -1 : 1)); const out: Point[] = [];
  const rets = s.map((p, i) => (i ? Math.log(p.v / s[i - 1].v) : NaN));
  for (let i = n; i < s.length; i++) { const w = rets.slice(i - n + 1, i + 1); const m = w.reduce((a, b) => a + b, 0) / n; const v = w.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1); out.push({ t: s[i].t, v: r2(Math.sqrt(v * 252) * 100, 2) }); }
  return out;
}

// --- policy path ----------------------------------------------------------------------------------------------------
export type Bills = { m1?: Point[]; m3?: Point[]; m6?: Point[]; y1?: Point[] };
const TREAS = "U.S. Treasury daily par yield curve (public domain)";
export function policyPath(bills: Bills, effr: Point[]): MacroSeries[] {
  const m3 = asMap(bills.m3 ?? []), m6 = asMap(bills.m6 ?? []), y1 = asMap(bills.y1 ?? []); const ef = asOf(effr);
  const f36: Point[] = [], f612: Point[] = [], p6: Point[] = [], p12: Point[] = [];
  for (const [t, a] of m3) { const b = m6.get(t); if (b == null) continue; const f = impliedForward(a, 0.25, b, 0.5); f36.push({ t, v: r2(f, 3) }); const e = ef(t); if (e != null) p6.push({ t, v: r2((f - e) * 100, 1) }); }
  for (const [t, a] of m6) { const b = y1.get(t); if (b == null) continue; const f = impliedForward(a, 0.5, b, 1); f612.push({ t, v: r2(f, 3) }); const e = ef(t); if (e != null) p12.push({ t, v: r2((f - e) * 100, 1) }); }
  const caveat = "Treasury constant-maturity yields are bond-equivalent and include term premia and bill-supply effects, so this is an approximate market view, not a futures-implied probability.";
  const mk = (code: string, name: string, unit: string, pts: Point[], how: string): MacroSeries => ({ cc: "US", code, name, unit, cat: "mp", freq: "D", src: `Calculated from the ${TREAS}${unit === "bp" ? " and the New York Fed EFFR" : ""}`, url: "https://home.treasury.gov/resource-center/data-chart-center/interest-rates", notes: `${how} ${caveat}`, points: pts.sort((a, b) => (a.t < b.t ? -1 : 1)) });
  return [
    mk("FWD3M3M", "T-bill implied 3-month rate, 3 months ahead", "%", f36, "Forward rate between the 3- and 6-month bill yields: f = [(1+y6·0.5)/(1+y3·0.25) − 1]/0.25."),
    mk("FWD6M6M", "T-bill implied 6-month rate, 6 months ahead", "%", f612, "Forward rate between the 6-month and 1-year bill yields: f = [(1+y12·1)/(1+y6·0.5) − 1]/0.5."),
    mk("PPATH6M", "Bill-implied policy path: rate change priced over ~6 months", "bp", p6, "3-month forward rate 3 months ahead minus today's effective federal funds rate, in basis points. Negative = cuts priced."),
    mk("PPATH12M", "Bill-implied policy path: rate change priced over ~12 months", "bp", p12, "6-month forward rate 6 months ahead minus today's effective federal funds rate, in basis points. Negative = cuts priced."),
  ].filter((s) => s.points.length);
}

// --- CIP forwards ------------------------------------------------------------------------------------------------------
export type CipInputs = { usd3m?: Point[]; usd1y?: Point[]; eur3m?: Point[]; eur1y?: Point[]; eurusd?: Point[]; cad3m?: Point[]; cad1y?: Point[]; usdcad?: Point[] };
export function cipForwards(x: CipInputs): MacroSeries[] {
  const out: MacroSeries[] = [];
  const pair = (cc: string, pairName: string, spot: Point[] | undefined, quote: [Point[] | undefined, Point[] | undefined], base: [Point[] | undefined, Point[] | undefined], bQ: number, bB: number, srcs: string) => {
    if (!spot?.length) return;
    for (const [i, [d, ten]] of ([[91, "3M"], [365, "1Y"]] as const).entries()) {
      const rq = quote[i], rb = base[i]; if (!rq?.length || !rb?.length) continue; const fq = asOf(rq), fb = asOf(rb);
      const lvl: Point[] = [], pips: Point[] = [];
      for (const s of spot) { const a = fq(s.t), b = fb(s.t); if (a == null || b == null) continue; const F = cipForward(s.v, a, b, d, bQ, bB); lvl.push({ t: s.t, v: r2(F, 5) }); pips.push({ t: s.t, v: r2((F - s.v) * 1e4, 1) }); }
      const notes = `Covered-interest-parity ${ten} forward: F = S·(1 + r_quote·d/B)/(1 + r_base·d/B), d = ${d} days. Uses government bill/curve yields, not interbank rates, so traded forwards also carry a cross-currency basis. Inputs: ${srcs}.`;
      if (lvl.length) out.push({ cc, code: `FWD${ten}.${pairName}`, name: `${pairName.slice(0, 3)}/${pairName.slice(3)} ${ten} forward (CIP-implied)`, unit: pairName.slice(3), cat: "ex", freq: "D", src: `Calculated (covered interest parity) from ${srcs}`, url: "https://www.bis.org/publ/qtrpdf/r_qt1609e.htm", notes, points: lvl.sort((a, b) => (a.t < b.t ? -1 : 1)) });
      if (pips.length) out.push({ cc, code: `FWDPTS${ten}.${pairName}`, name: `${pairName.slice(0, 3)}/${pairName.slice(3)} ${ten} forward points (CIP-implied)`, unit: "pips", cat: "ex", freq: "D", src: `Calculated (covered interest parity) from ${srcs}`, url: "https://www.bis.org/publ/qtrpdf/r_qt1609e.htm", notes: `Forward minus spot, in pips (×10,000). ${notes}`, points: pips.sort((a, b) => (a.t < b.t ? -1 : 1)) });
    }
  };
  pair("EU", "EURUSD", x.eurusd, [x.usd3m, x.usd1y], [x.eur3m, x.eur1y], 360, 360, "ECB euro reference rate, ECB AAA euro-area government yield curve and U.S. Treasury bill yields");
  pair("CA", "USDCAD", x.usdcad, [x.cad3m, x.cad1y], [x.usd3m, x.usd1y], 365, 360, "Bank of Canada USD/CAD rate and Treasury bill yields, U.S. Treasury bill yields");
  return out;
}

/** Inputs for the forwards that the rates sources don't already fetch: ECB spot and AAA curve, Bank of Canada bills and USD/CAD. */
export async function fxForwardInputs(now: Date): Promise<CipInputs> {
  const from = new Date(now.getTime() - 730 * 864e5).toISOString().slice(0, 10); const day = (p: Point[]) => p.filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.t));
  const [eurusd, eur3m, eur1y] = await Promise.all([
    ecbSeries("EXR", "D.USD.EUR.SP00.A", from).then(day).catch(() => []),
    ecbSeries("YC", "B.U2.EUR.4F.G_N_A.SV_C_YM.SR_3M", from).then(day).catch(() => []),
    ecbSeries("YC", "B.U2.EUR.4F.G_N_A.SV_C_YM.SR_1Y", from).then(day).catch(() => []),
  ]);
  let cad3m: Point[] = [], cad1y: Point[] = [], usdcad: Point[] = [];
  try {
    const r = await fetch(`https://www.bankofcanada.ca/valet/observations/V39065,V39067,FXUSDCAD/json?start_date=${from}`, { headers: { ...BROWSER_UA, accept: "application/json" }, signal: AbortSignal.timeout(60_000) });
    if (r.ok) {
      const j = (await r.json()) as { observations?: ({ d?: string } & Record<string, { v?: string } | string | undefined>)[] };
      const col = (k: string) => (j.observations ?? []).flatMap((o) => { const v = Number((o[k] as { v?: string } | undefined)?.v); return o.d && Number.isFinite(v) && (o[k] as { v?: string } | undefined)?.v !== "" ? [{ t: o.d, v }] : []; });
      cad3m = col("V39065"); cad1y = col("V39067"); usdcad = col("FXUSDCAD");
    }
  } catch { /* Canadian pair skipped */ }
  if (!eurusd.length && !usdcad.length) throw new ProviderError("ECB / Bank of Canada", "no spot FX for the forwards");
  return { eurusd, eur3m, eur1y, cad3m, cad1y, usdcad };
}

// --- VIX term structure -------------------------------------------------------------------------------------------------
export const CBOE_HIST = "https://cdn.cboe.com/api/global/us_indices/daily_prices";
export type VixLevels = { vix?: Point[]; vix3m?: Point[]; vix9d?: Point[]; vvix?: Point[] };
/** Cboe daily history CSV (DATE,OPEN,HIGH,LOW,CLOSE or DATE,<INDEX>) → closes. */
export function parseCboeHistory(text: string): Point[] {
  return parseCsv(text).flatMap((r) => {
    const m = String(r.DATE ?? "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/); const t = m ? `${m[3]}-${m[1]}-${m[2]}` : /^\d{4}-\d{2}-\d{2}$/.test(r.DATE ?? "") ? r.DATE : null;
    const raw = r.CLOSE ?? Object.entries(r).find(([k]) => k !== "DATE")?.[1]; const v = Number(raw);
    return t && raw !== "" && Number.isFinite(v) && v > 0 ? [{ t, v }] : [];
  });
}
export async function vixLevels(now: Date): Promise<VixLevels> {
  const from = new Date(now.getTime() - 5 * 365 * 864e5).toISOString().slice(0, 10);
  const get = async (f: string) => { try { const r = await fetch(`${CBOE_HIST}/${f}_History.csv`, { headers: { ...BROWSER_UA, accept: "text/csv" }, signal: AbortSignal.timeout(60_000) }); return r.ok ? parseCboeHistory(await r.text()).filter((p) => p.t >= from) : []; } catch { return []; } };
  const [vix, vix3m, vix9d, vvix] = await Promise.all(["VIX", "VIX3M", "VIX9D", "VVIX"].map(get));
  if (!vix.length) throw new ProviderError("Cboe", "no VIX history returned");
  return { vix, vix3m, vix9d, vvix };
}
export function vixRatios(x: VixLevels, spy?: Point[]): MacroSeries[] {
  const vix = asMap(x.vix ?? []); const credit = "Calculated from Cboe daily index history (cboe.com); only the ratio is stored, not the index levels. VIX® is a registered trademark of Cboe.";
  const ratio = (a: Point[] | undefined, num: "a" | "vix") => (a ?? []).flatMap((p) => { const v = vix.get(p.t); return v ? [{ t: p.t, v: r2(num === "a" ? p.v / v : v / p.v, 3) }] : []; });
  const mk = (code: string, name: string, unit: string, pts: Point[], how: string): MacroSeries => ({ cc: "US", code, name, unit, cat: "mk", freq: "D", src: "Calculated from Cboe index history", url: "https://www.cboe.com/tradable_products/vix/term_structure/", notes: `${how} ${credit}`, points: pts.sort((a, b) => (a.t < b.t ? -1 : 1)) });
  const out = [
    mk("VIXTS", "VIX term structure: VIX / VIX3M", "ratio", ratio(x.vix3m, "vix"), "30-day over 3-month implied volatility. Below 1 = normal upward-sloping curve (contango); above 1 = inverted, usually during stress."),
    mk("VIX9DR", "Short-end VIX: VIX9D / VIX", "ratio", ratio(x.vix9d, "a"), "9-day over 30-day implied volatility; above 1 = near-term event risk priced."),
    mk("VVIXR", "Volatility of volatility: VVIX / VIX", "ratio", ratio(x.vvix, "a"), "Implied volatility of VIX options relative to the VIX level."),
  ];
  if (spy?.length) { const rv = realisedVol(spy); out.push(mk("VRP", "Volatility risk premium: VIX minus 21-day realised S&P 500 volatility", "vol pts", rv.flatMap((p) => { const v = vix.get(p.t); return v != null ? [{ t: p.t, v: r2(v - p.v, 2) }] : []; }), "Implied (VIX) minus realised volatility, annualised from 21 daily S&P 500 closes (the app's market history). Positive = options price more volatility than markets have shown.")); }
  return out.filter((s) => s.points.length);
}
