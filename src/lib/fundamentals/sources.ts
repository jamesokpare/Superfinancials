/**
 * Reported fundamentals from EODHD, Financial Modeling Prep or Alpha Vantage,
 * normalized to one shape (FundDoc). Monetary values are in the company's
 * reporting currency (`ccy`); the app converts them to the quote currency.
 *
 * Calls per company: EODHD 1, FMP up to 7, Alpha Vantage 5.
 */
import { createAlphaVantage } from "@/lib/providers/alphavantage";
import { createEodhd } from "@/lib/providers/eodhd";
import { createFmp } from "@/lib/providers/fmp";

export type FundProvider = "eodhd" | "fmp" | "alphavantage";

/** One fiscal year. */
export type FundYear = { y: number; end: string; rev: number | null; gp: number | null; op: number | null; ni: number | null; eps: number | null; assets: number | null; debt: number | null; equity: number | null; fcf: number | null };

/** One quarterly report: past (with actuals) or upcoming (estimates only). */
export type EarnRow = {
  d: string;                  // report date YYYY-MM-DD
  p: string | null;           // fiscal period end
  time: "Before open" | "After close" | null;
  eps: number | null;         // reported EPS
  est: number | null;         // consensus EPS before the report
  rev: number | null;         // reported revenue
  revEst: number | null;      // consensus revenue
};
/** Consensus EPS for the current quarter now and 7, 30 and 90 days ago (to measure revisions). */
export type EarnTrend = { p: string | null; now: number | null; d7: number | null; d30: number | null; d90: number | null; revEst: number | null };

export type FundDoc = {
  type: "fund";
  id: string;          // app instrument id, e.g. EQ.AAPL
  tk: string;
  src: FundProvider;
  asOf: string;        // when it was fetched (ISO)
  ccy: string;         // reporting currency
  name?: string;
  shares: number | null;   // shares outstanding
  /** Trailing twelve months, or the latest fiscal year when `basis` is "FY". */
  ttm: { basis: "TTM" | "FY"; rev: number | null; gp: number | null; op: number | null; ni: number | null; ebitda: number | null; eps: number | null; fcf: number | null; divPs: number | null };
  /** Latest balance sheet. */
  bs: { date: string | null; equity: number | null; debt: number | null; cash: number | null };
  /** Consensus EPS for the next fiscal year, when available. */
  fwdEps: number | null;
  /** Revenue growth, % year on year. */
  growth: number | null;
  nextEarn: string | null;      // YYYY-MM-DD
  earnTime: "Before open" | "After close" | null;
  /** Up to five fiscal years, oldest first. */
  fy: FundYear[];
  /** Quarterly reports, oldest first: up to 12 past plus the next upcoming one. */
  earn?: EarnRow[];
  earnTrend?: EarnTrend | null;
};

/** Sorts by report date, keeps the last 12 past reports and the first upcoming one. */
export function tidyEarn(rows: EarnRow[], today: string): EarnRow[] {
  const by = new Map<string, EarnRow>();
  for (const r of rows) if (r.d) { const o = by.get(r.d); by.set(r.d, o ? { ...o, ...Object.fromEntries(Object.entries(r).filter(([, v]) => v !== null)) } as EarnRow : r); }
  const all = [...by.values()].sort((a, b) => (a.d < b.d ? -1 : 1));
  const past = all.filter((r) => r.d < today || r.eps !== null).slice(-12); const next = all.find((r) => r.d >= today && r.eps === null);
  return next ? [...past, next] : past;
}

export const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "" || v === "None" || v === "NA" || v === "-") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};
const sum = (...v: (number | null)[]) => (v.some((x) => x === null) ? null : (v as number[]).reduce((a, b) => a + b, 0));
const day = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const timing = (v: unknown): FundDoc["earnTime"] => { const s = String(v ?? "").toLowerCase(); return /before|bmo|pre/.test(s) ? "Before open" : /after|amc|post/.test(s) ? "After close" : null; };
/** FCF from a cash-flow row: reported FCF, else operating cash flow minus capex. */
const fcfOf = (r: Record<string, unknown>, fcf: string, ocf: string, capex: string) => {
  const f = num(r[fcf]); if (f !== null) return f;
  const o = num(r[ocf]), c = num(r[capex]); return o === null || c === null ? null : o - Math.abs(c);
};
/** Rows of a { "<date>": row } map, newest first. */
const byDate = (m: unknown) => Object.entries(obj(m)).filter(([k]) => day(k)).sort(([a], [b]) => (a < b ? 1 : -1)).map(([k, v]) => ({ d: k.slice(0, 10), r: obj(v) }));
const growthPct = (a: number | null, b: number | null) => (a !== null && b !== null && b > 0 ? (a / b - 1) * 100 : null);

// --- EODHD: one /fundamentals call has statements, TTM highlights, shares and earnings --------
export async function eodhdFundamentals(id: string, tk: string): Promise<FundDoc | null> {
  const d = await createEodhd().fundamentals(`${tk}.US`) as Record<string, unknown>;
  const G = obj(d.General), H = obj(d.Highlights), SS = obj(d.SharesStats), E = obj(d.Earnings), F = obj(d.Financials);
  const inc = byDate(obj(F.Income_Statement).yearly), bal = byDate(obj(F.Balance_Sheet).yearly), cf = byDate(obj(F.Cash_Flow).yearly);
  const balQ = byDate(obj(F.Balance_Sheet).quarterly), cfQ = byDate(obj(F.Cash_Flow).quarterly);
  if (inc.length < 2) return null;
  const epsAnnual = new Map(byDate(E.Annual).map(({ d: k, r }) => [k, num(r.epsActual)]));
  const debtOf = (r: Record<string, unknown>) => num(r.shortLongTermDebtTotal) ?? sum(num(r.shortTermDebt) ?? 0, num(r.longTermDebt));
  const shares = num(SS.SharesOutstanding);
  const fy: FundYear[] = inc.slice(0, 5).map(({ d: end, r }) => {
    const b = bal.find((x) => x.d === end)?.r ?? {}; const c = cf.find((x) => x.d === end)?.r ?? {};
    const ni = num(r.netIncome);
    return { y: Number(end.slice(0, 4)), end, rev: num(r.totalRevenue), gp: num(r.grossProfit), op: num(r.operatingIncome), ni,
      // Only reported EPS: dividing by today's share count would misstate earlier years after buybacks.
      eps: epsAnnual.get(end) ?? null, assets: num(b.totalAssets), debt: debtOf(b), equity: num(b.totalStockholderEquity),
      fcf: fcfOf(c, "freeCashFlow", "totalCashFromOperatingActivities", "capitalExpenditures") };
  }).reverse();
  const lastBal = balQ[0] ?? bal[0];
  const q4 = cfQ.slice(0, 4).map(({ r }) => fcfOf(r, "freeCashFlow", "totalCashFromOperatingActivities", "capitalExpenditures"));
  const rev = num(H.RevenueTTM);
  // Next report: the earliest future entry in the earnings history.
  const today = new Date().toISOString().slice(0, 10);
  const next = byDate(E.History).map(({ r }) => r).filter((r) => (day(r.reportDate) ?? "") >= today).sort((a, b) => (String(a.reportDate) < String(b.reportDate) ? -1 : 1))[0];
  const earn = tidyEarn(byDate(E.History).map(({ d: p, r }) => ({
    d: day(r.reportDate) ?? "", p, time: timing(r.beforeAfterMarket), eps: num(r.epsActual), est: num(r.epsEstimate), rev: null, revEst: null,
  })), today);
  const tq = byDate(E.Trend).map(({ d: p, r }) => ({ p, r })).find(({ r }) => r.period === "0q");
  const earnTrend: EarnTrend | null = tq ? { p: tq.p, now: num(tq.r.epsTrendCurrent), d7: num(tq.r.epsTrend7daysAgo), d30: num(tq.r.epsTrend30daysAgo), d90: num(tq.r.epsTrend90daysAgo), revEst: num(tq.r.revenueEstimateAvg) } : null;
  if (earnTrend && earn.length && earn.at(-1)!.eps === null && earn.at(-1)!.revEst === null) earn[earn.length - 1] = { ...earn.at(-1)!, revEst: earnTrend.revEst };
  return {
    type: "fund", id, tk, src: "eodhd", earn, earnTrend, asOf: new Date().toISOString(), ccy: String(G.CurrencyCode || "USD"), name: G.Name ? String(G.Name) : undefined, shares,
    ttm: { basis: "TTM", rev, gp: num(H.GrossProfitTTM), op: rev !== null && num(H.OperatingMarginTTM) !== null ? rev * num(H.OperatingMarginTTM)! : null,
      ni: rev !== null && num(H.ProfitMargin) !== null ? rev * num(H.ProfitMargin)! : null, ebitda: num(H.EBITDA), eps: num(H.DilutedEpsTTM) ?? num(H.EarningsShare),
      fcf: q4.length === 4 ? sum(...q4) : fy.at(-1)?.fcf ?? null, divPs: num(H.DividendShare) ?? 0 },
    bs: { date: lastBal?.d ?? null, equity: num(lastBal?.r.totalStockholderEquity), debt: lastBal ? debtOf(lastBal.r) : null, cash: num(lastBal?.r.cashAndShortTermInvestments) ?? num(lastBal?.r.cash) },
    fwdEps: num(H.EPSEstimateNextYear) ?? num(H.EPSEstimateCurrentYear),
    growth: num(H.QuarterlyRevenueGrowthYOY) !== null ? num(H.QuarterlyRevenueGrowthYOY)! * 100 : growthPct(fy.at(-1)?.rev ?? null, fy.at(-2)?.rev ?? null),
    nextEarn: next ? day(next.reportDate) : null, earnTime: next ? timing(next.beforeAfterMarket) : null,
    fy,
  };
}

// --- Financial Modeling Prep (stable API) -----------------------------------------------------
export async function fmpFundamentals(id: string, tk: string): Promise<FundDoc | null> {
  const fmp = createFmp();
  const list = async (path: string, q: Record<string, string | number> = {}) => { const r = await fmp.get<unknown>(path, { symbol: tk, ...q }); return Array.isArray(r) ? (r as Record<string, unknown>[]) : []; };
  const [profile, inc, bal, cf] = await Promise.all([list("/profile"), list("/income-statement", { period: "annual", limit: 5 }), list("/balance-sheet-statement", { period: "annual", limit: 5 }), list("/cash-flow-statement", { period: "annual", limit: 5 })]);
  if (inc.length < 2) return null;
  // Optional endpoints (some need a paid plan): failures fall back to fiscal-year figures.
  const opt = (p: Promise<Record<string, unknown>[]>) => p.catch(() => [] as Record<string, unknown>[]);
  const [ttmRows, est, earn_] = await Promise.all([opt(list("/income-statement-ttm")), opt(list("/analyst-estimates", { period: "annual", limit: 3 })), opt(list("/earnings", { limit: 14 }))]);
  const P = profile[0] ?? {};
  const fy: FundYear[] = inc.slice(0, 5).map((r) => {
    const end = day(r.date) ?? ""; const b = bal.find((x) => x.date === r.date) ?? {}; const c = cf.find((x) => x.date === r.date) ?? {};
    return { y: num(r.fiscalYear) ?? Number(end.slice(0, 4)), end, rev: num(r.revenue), gp: num(r.grossProfit), op: num(r.operatingIncome), ni: num(r.netIncome),
      eps: num(r.epsDiluted) ?? num(r.epsdiluted) ?? num(r.eps), assets: num(b.totalAssets), debt: num(b.totalDebt), equity: num(b.totalStockholdersEquity),
      fcf: fcfOf(c, "freeCashFlow", "operatingCashFlow", "capitalExpenditure") };
  }).reverse();
  const T = ttmRows[0]; const L = inc[0]; const src = T ?? L; const lastFy = fy.at(-1)!;
  const price = num(P.price); const mcap = num(P.marketCap);
  const shares = price && mcap ? mcap / price : num(L.weightedAverageShsOutDil);
  const today = new Date().toISOString().slice(0, 10);
  const nextRow = earn_.filter((r) => (day(r.date) ?? "") >= today && num(r.epsActual) === null).sort((a, b) => (String(a.date) < String(b.date) ? -1 : 1))[0];
  const fwd = est.filter((r) => (day(r.date) ?? "") > lastFy.end).sort((a, b) => (String(a.date) < String(b.date) ? -1 : 1))[0];
  const earn = tidyEarn(earn_.map((r) => ({ d: day(r.date) ?? "", p: null, time: null, eps: num(r.epsActual), est: num(r.epsEstimated), rev: num(r.revenueActual), revEst: num(r.revenueEstimated) })), today);
  return {
    type: "fund", id, tk, src: "fmp", earn, earnTrend: null, asOf: new Date().toISOString(), ccy: String(L.reportedCurrency || P.currency || "USD"), name: P.companyName ? String(P.companyName) : undefined, shares,
    ttm: { basis: T ? "TTM" : "FY", rev: num(src.revenue), gp: num(src.grossProfit), op: num(src.operatingIncome), ni: num(src.netIncome), ebitda: num(src.ebitda),
      eps: num(src.epsDiluted) ?? num(src.epsdiluted) ?? num(src.eps), fcf: lastFy.fcf, divPs: num(P.lastDividend) ?? 0 },
    bs: { date: day(bal[0]?.date), equity: num(bal[0]?.totalStockholdersEquity), debt: num(bal[0]?.totalDebt), cash: num(bal[0]?.cashAndShortTermInvestments) ?? num(bal[0]?.cashAndCashEquivalents) },
    fwdEps: fwd ? num(fwd.epsAvg) ?? num(fwd.estimatedEpsAvg) : null,
    growth: growthPct(lastFy.rev, fy.at(-2)?.rev ?? null),
    nextEarn: nextRow ? day(nextRow.date) : null, earnTime: null,
    fy,
  };
}

// --- Alpha Vantage (5 calls a company; free keys allow 25 a day) -------------------------------
export async function alphaVantageFundamentals(id: string, tk: string): Promise<FundDoc | null> {
  const av = createAlphaVantage();
  const ov = await av.overview(tk); if (!ov || !ov.Symbol) return null;
  const inc = ((await av.incomeStatement(tk)).annualReports as Record<string, unknown>[] | undefined) ?? [];
  const bal = ((await av.balanceSheet(tk)).annualReports as Record<string, unknown>[] | undefined) ?? [];
  const cf = ((await av.cashFlow(tk)).annualReports as Record<string, unknown>[] | undefined) ?? [];
  const ernRes = await av.earnings(tk);
  const ern = (ernRes.annualEarnings as Record<string, unknown>[] | undefined) ?? [];
  const qtr = (ernRes.quarterlyEarnings as Record<string, unknown>[] | undefined) ?? [];
  if (inc.length < 2) return null;
  const fy: FundYear[] = inc.slice(0, 5).map((r) => {
    const end = String(r.fiscalDateEnding); const b = bal.find((x) => x.fiscalDateEnding === end) ?? {}; const c = cf.find((x) => x.fiscalDateEnding === end) ?? {};
    const e = ern.find((x) => x.fiscalDateEnding === end);
    return { y: Number(end.slice(0, 4)), end, rev: num(r.totalRevenue), gp: num(r.grossProfit), op: num(r.operatingIncome), ni: num(r.netIncome), eps: num(e?.reportedEPS),
      assets: num(b.totalAssets), debt: num(b.shortLongTermDebtTotal), equity: num(b.totalShareholderEquity), fcf: fcfOf(c, "freeCashFlow", "operatingCashflow", "capitalExpenditures") };
  }).reverse();
  const rev = num(ov.RevenueTTM); const pm = num(ov.ProfitMargin); const om = num(ov.OperatingMarginTTM);
  const earn = tidyEarn(qtr.map((r) => ({ d: day(r.reportedDate) ?? "", p: day(r.fiscalDateEnding), time: timing(r.reportTime), eps: num(r.reportedEPS), est: num(r.estimatedEPS), rev: null, revEst: null })), new Date().toISOString().slice(0, 10));
  return {
    type: "fund", id, tk, src: "alphavantage", earn, earnTrend: null, asOf: new Date().toISOString(), ccy: String(ov.Currency || "USD"), name: ov.Name ? String(ov.Name) : undefined, shares: num(ov.SharesOutstanding),
    ttm: { basis: "TTM", rev, gp: num(ov.GrossProfitTTM), op: rev !== null && om !== null ? rev * om : null, ni: rev !== null && pm !== null ? rev * pm : null, ebitda: num(ov.EBITDA),
      eps: num(ov.DilutedEPSTTM) ?? num(ov.EPS), fcf: fy.at(-1)?.fcf ?? null, divPs: num(ov.DividendPerShare) ?? 0 },
    bs: { date: bal[0] ? String(bal[0].fiscalDateEnding) : null, equity: num(bal[0]?.totalShareholderEquity), debt: num(bal[0]?.shortLongTermDebtTotal), cash: num(bal[0]?.cashAndShortTermInvestments) },
    fwdEps: null,
    growth: num(ov.QuarterlyRevenueGrowthYOY) !== null ? num(ov.QuarterlyRevenueGrowthYOY)! * 100 : null,
    nextEarn: null, earnTime: null,
    fy,
  };
}

// --- Earnings calendars: recent and upcoming reports for many companies in one call --------------
/** A calendar entry; recent ones carry actuals, upcoming ones estimates. */
export type CalRow = EarnRow;
export async function eodhdEarningsCalendar(tks: string[], from: string, to: string) {
  const res = obj(await createEodhd().calendar.earnings({ symbols: tks.map((t) => `${t}.US`).join(","), from, to }));
  const out = new Map<string, CalRow[]>();
  for (const r of (Array.isArray(res.earnings) ? res.earnings : []) as Record<string, unknown>[]) {
    const tk = String(r.code ?? "").split(".")[0]; const d = day(r.report_date);
    if (tk && d) { if (!out.has(tk)) out.set(tk, []); out.get(tk)!.push({ d, p: day(r.date), time: timing(r.before_after_market), eps: num(r.actual), est: num(r.estimate), rev: null, revEst: null }); }
  }
  return out;
}
export async function fmpEarningsCalendar(tks: string[], from: string, to: string) {
  const rows = await createFmp().earningsCalendar(from, to); const want = new Set(tks);
  const out = new Map<string, CalRow[]>();
  for (const r of (Array.isArray(rows) ? rows : []) as Record<string, unknown>[]) {
    const tk = String(r.symbol ?? ""); const d = day(r.date);
    if (want.has(tk) && d) { if (!out.has(tk)) out.set(tk, []); out.get(tk)!.push({ d, p: null, time: null, eps: num(r.epsActual), est: num(r.epsEstimated), rev: num(r.revenueActual), revEst: num(r.revenueEstimated) }); }
  }
  return out;
}
