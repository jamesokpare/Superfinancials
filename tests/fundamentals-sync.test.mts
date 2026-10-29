// Test of src/lib/fundamentals/sync.ts with a fake fetch and an in-memory docs
// table: EODHD parsing, FMP fallback, refresh budget and age, earnings calendar.
// Run: npm test
import { runFundamentalsSync } from "../src/lib/fundamentals/sync";
import { memoryStore } from "../src/lib/market/store";
import type { FundDoc } from "../src/lib/fundamentals/sources";
import { snapshotFrom } from "../src/lib/fundamentals/africa";

for (const k of ["EODHD_API_KEY", "FMP_API_KEY", "MANSA_API_KEY"]) process.env[k] = "test-" + k;
const NOW = new Date("2026-10-29T05:40:00Z");
const calls: string[] = [];

const yearly = (rows: [string, Record<string, unknown>][]) => Object.fromEntries(rows.map(([d, r]) => [d, { date: d, ...r }]));
const EODHD_AAPL = {
  General: { Code: "AAPL", Name: "Apple Inc", CurrencyCode: "USD", FiscalYearEnd: "September" },
  Highlights: { RevenueTTM: "416000000000", GrossProfitTTM: 195000000000, OperatingMarginTTM: 0.32, ProfitMargin: 0.25, EBITDA: 140000000000, DilutedEpsTTM: 7.1, DividendShare: 1.04, QuarterlyRevenueGrowthYOY: 0.08, EPSEstimateNextYear: 8.2 },
  SharesStats: { SharesOutstanding: 14800000000 },
  Earnings: {
    Annual: { "2025-09-30": { date: "2025-09-30", epsActual: 7.0 }, "2024-09-30": { date: "2024-09-30", epsActual: 6.08 } },
    History: {
      "2026-12-31": { reportDate: "2027-01-29", beforeAfterMarket: "AfterMarket", epsActual: null, epsEstimate: 2.5 },
      "2026-09-30": { reportDate: "2026-10-30", beforeAfterMarket: "AfterMarket", epsActual: null, epsEstimate: 1.78 },
      "2026-06-30": { reportDate: "2026-07-31", beforeAfterMarket: "AfterMarket", epsActual: 1.6, epsEstimate: 1.43 },
      "2026-03-31": { reportDate: "2026-05-01", beforeAfterMarket: "AfterMarket", epsActual: 1.65, epsEstimate: "1.62" },
    },
    Trend: { "2026-09-30": { date: "2026-09-30", period: "0q", epsTrendCurrent: 1.78, epsTrend7daysAgo: 1.77, epsTrend30daysAgo: 1.75, epsTrend90daysAgo: 1.7, revenueEstimateAvg: 102000000000 }, "2027-09-30": { period: "+1y", epsTrendCurrent: 8.2 } },
  },
  Financials: {
    Income_Statement: { yearly: yearly([["2025-09-30", { totalRevenue: "410000000000", grossProfit: "190000000000", operatingIncome: "130000000000", netIncome: "105000000000" }], ["2024-09-30", { totalRevenue: "391035000000", grossProfit: "180683000000", operatingIncome: "123216000000", netIncome: "93736000000" }], ["2023-09-30", { totalRevenue: "383285000000", grossProfit: "169148000000", operatingIncome: "114301000000", netIncome: "96995000000" }]]) },
    Balance_Sheet: {
      yearly: yearly([["2025-09-30", { totalAssets: "360000000000", shortLongTermDebtTotal: "100000000000", totalStockholderEquity: "70000000000" }], ["2024-09-30", { totalAssets: "364980000000", shortLongTermDebtTotal: "106629000000", totalStockholderEquity: "56950000000" }]]),
      quarterly: yearly([["2026-06-30", { totalStockholderEquity: "66000000000", shortLongTermDebtTotal: "98000000000", cashAndShortTermInvestments: "55000000000" }]]),
    },
    Cash_Flow: {
      yearly: yearly([["2025-09-30", { freeCashFlow: "100000000000" }], ["2024-09-30", { totalCashFromOperatingActivities: "118254000000", capitalExpenditures: "-9447000000" }]]),
      quarterly: yearly([["2026-06-30", { freeCashFlow: "25000000000" }], ["2026-03-31", { freeCashFlow: "24000000000" }], ["2025-12-31", { freeCashFlow: "30000000000" }], ["2025-09-30", { freeCashFlow: "23000000000" }]]),
    },
  },
};

globalThis.fetch = (async (input: string | URL | Request) => {
  const url = new URL(input instanceof Request ? input.url : String(input)); calls.push(url.hostname + url.pathname + (url.searchParams.get("symbol") ? "?" + url.searchParams.get("symbol") : ""));
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
  if (url.hostname === "eodhd.com") {
    if (url.pathname === "/api/fundamentals/AAPL.US") return json(EODHD_AAPL);
    if (url.pathname === "/api/fundamentals/CCJ.US") return json({ General: { Code: "CCJ" }, Financials: {} }); // no statements → falls back to FMP
    if (url.pathname === "/api/fundamentals/DANGCEM.XNSA") return json({ ...EODHD_AAPL, General: { Code: "DANGCEM", Name: "Dangote Cement Plc", CurrencyCode: "NGN" }, SharesStats: { SharesOutstanding: 16856000000 } });
    if (url.pathname.startsWith("/api/fundamentals/")) return json({ error: "not in plan" }, 403);
    if (url.pathname === "/api/calendar/earnings") return json({ type: "Earnings", earnings: [
      { code: "AAPL.US", report_date: "2026-10-30", date: "2026-09-30", before_after_market: "AfterMarket", estimate: 1.79, actual: null },
      { code: "CCJ.US", report_date: "2026-11-05", date: "2026-09-30", before_after_market: "BeforeMarket", estimate: 0.31, actual: null },
      { code: "CCJ.US", report_date: "2026-10-22", date: "2026-06-30", before_after_market: "BeforeMarket", estimate: 0.2, actual: 0.27 },
      { code: "MSFT.US", report_date: "2026-10-28", date: "2026-09-30", before_after_market: "AfterMarket", estimate: 3.6, actual: 3.72 },
    ] });
    return json([], 404);
  }
  if (url.hostname === "www.mansaapi.com") {
    if (url.pathname === "/api/v1/markets/exchanges/nigeria/stocks/MTNN") return json({ success: true, data: { ticker: "MTNN", name: "MTN Nigeria Communications Plc", price: 455.5, market_cap: 9.27e12, pe_ratio: 18.5, dividend_yield: 0.035, currency: "NGN" } });
    if (url.pathname === "/api/v1/markets/exchanges/nigeria/dividends/MTNN") return json({ success: true, data: [] });
    return json({ success: false, error: { code: "NOT_FOUND", message: "no such stock" } }, 404);
  }
  if (url.hostname === "financialmodelingprep.com") {
    const s = url.searchParams.get("symbol");
    if (s !== "CCJ") return json([]);
    const p = url.pathname.replace("/stable", "");
    if (p === "/profile") return json([{ symbol: "CCJ", price: 80, marketCap: 34800000000, lastDividend: 0.12, companyName: "Cameco Corporation", currency: "USD" }]);
    if (p === "/income-statement") return json([{ date: "2025-12-31", fiscalYear: "2025", reportedCurrency: "CAD", revenue: 3500000000, grossProfit: 1100000000, operatingIncome: 700000000, netIncome: 600000000, ebitda: 1200000000, epsDiluted: 1.38 }, { date: "2024-12-31", fiscalYear: "2024", reportedCurrency: "CAD", revenue: 3140000000, grossProfit: 900000000, operatingIncome: 450000000, netIncome: 172000000, ebitda: 900000000, epsDiluted: 0.4 }]);
    if (p === "/balance-sheet-statement") return json([{ date: "2025-12-31", totalAssets: 11000000000, totalDebt: 1500000000, totalStockholdersEquity: 7000000000, cashAndShortTermInvestments: 600000000 }]);
    if (p === "/cash-flow-statement") return json([{ date: "2025-12-31", freeCashFlow: 800000000 }]);
    if (p === "/income-statement-ttm") return json({ "Error Message": "Premium" }, 402);
    if (p === "/earnings") return json([{ symbol: "CCJ", date: "2026-07-24", epsActual: 0.24, epsEstimated: 0.22, revenueActual: 790000000, revenueEstimated: 760000000 }, { symbol: "CCJ", date: "2026-11-05", epsActual: null, epsEstimated: 0.3, revenueActual: null, revenueEstimated: 900000000 }]);
    return json([]);
  }
  return json({ error: "not mocked" }, 404);
}) as typeof fetch;

let fails = 0;
const t = (label: string, ok: boolean, info?: unknown) => { if (!ok) fails++; console.log((ok ? "PASS " : "FAIL ") + label, ok ? "" : JSON.stringify(info)); };

const store = memoryStore({ fund: [{ id: "EQ.MSFT", data: { type: "fund", id: "EQ.MSFT", asOf: "2026-10-27T05:40:00Z", fy: [] } }] });
const r = await runFundamentalsSync({ store, now: NOW, only: ["AAPL", "CCJ", "MSFT", "NVDA"], providers: ["eodhd", "fmp"], budget: 3 });
const docs = Object.fromEntries(store.dump().fund.map((d) => [d.id, d.data as unknown as FundDoc]));
const a = docs["EQ.AAPL"], c = docs["EQ.CCJ"];

t("fresh company (MSFT, 2 days old) not refetched", !calls.some((x) => x.includes("MSFT")), calls.filter((x) => x.includes("MSFT")));
t("budget: 3 companies attempted, oldest/missing first", r.updated.length + r.failed.length === 3 && r.pending === 0, r);
t("EODHD: five-year table oldest first, EPS from annual earnings", JSON.stringify(a.fy.map((y) => y.y)) === "[2023,2024,2025]" && a.fy[2].eps === 7 && a.fy[1].eps === 6.08 && a.fy[0].eps === null && a.fy[2].rev === 410e9, a.fy);
t("EODHD: FCF from reported or OCF − capex", a.fy[2].fcf === 100e9 && a.fy[1].fcf === 118254e6 - 9447e6, a.fy.map((y) => y.fcf));
t("EODHD: TTM highlights and margins", a.ttm.basis === "TTM" && a.ttm.rev === 416e9 && a.ttm.op === 416e9 * 0.32 && a.ttm.ni === 416e9 * 0.25 && a.ttm.eps === 7.1 && a.ttm.divPs === 1.04, a.ttm);
t("EODHD: TTM FCF is the sum of four quarters", a.ttm.fcf === 102e9, a.ttm.fcf);
t("EODHD: latest quarterly balance sheet", a.bs.date === "2026-06-30" && a.bs.equity === 66e9 && a.bs.debt === 98e9 && a.bs.cash === 55e9, a.bs);
t("EODHD: shares, growth, forward EPS", a.shares === 14.8e9 && Math.abs(a.growth! - 8) < 1e-9 && a.fwdEps === 8.2);
t("next earnings and timing", a.nextEarn === "2026-10-30" && a.earnTime === "After close", [a.nextEarn, a.earnTime]);
t("FMP fallback when EODHD has no statements", c?.src === "fmp" && c.ccy === "CAD" && c.fy.length === 2 && c.ttm.basis === "FY" && c.ttm.rev === 35e8, c);
t("FMP: shares from market cap / price, growth from FY", c.shares === 34.8e9 / 80 && Math.abs(c.growth! - (3500 / 3140 - 1) * 100) < 1e-9);
t("earnings calendar sets CCJ date and time", c.nextEarn === "2026-11-05" && c.earnTime === "Before open", [c.nextEarn, c.earnTime]);
t("company with no data anywhere reported as failed", r.failed.some((f) => f.tk === "NVDA"), r.failed);
t("meta note", /Fundamentals sync 2026-10-29: 2 companies refreshed/.test(String((store.dump().fund.find((d) => d.id === "_meta")?.data as { note?: string }).note)), r.note);

// --- earnings ---
const ae = a.earn ?? [];
t("EODHD earnings: past reports with actual and estimate, oldest first", JSON.stringify(ae.slice(0, 2).map((r) => [r.d, r.eps, r.est])) === '[["2026-05-01",1.65,1.62],["2026-07-31",1.6,1.43]]', ae);
t("EODHD earnings: only the next upcoming report kept, with calendar estimate merged", ae.length === 3 && ae[2].d === "2026-10-30" && ae[2].eps === null && ae[2].est === 1.79 && ae[2].time === "After close", ae[2]);
t("EODHD earnings: revenue estimate from the trend for the next report", ae[2].revEst === 102e9, ae[2]);
t("EODHD consensus trend for revisions", a.earnTrend?.now === 1.78 && a.earnTrend?.d30 === 1.75 && a.earnTrend?.d90 === 1.7, a.earnTrend);
const ce = c.earn ?? [];
t("FMP earnings with revenue, plus calendar actuals", JSON.stringify(ce.map((r) => [r.d, r.eps, r.est, r.rev])) === '[["2026-07-24",0.24,0.22,790000000],["2026-10-22",0.27,0.2,null],["2026-11-05",null,0.31,null]]', ce);
t("FMP upcoming report keeps its revenue estimate", ce[2]?.revEst === 9e8 && ce[2]?.time === "Before open", ce[2]);
t("calendar actuals merged into an existing doc (MSFT)", docs["EQ.MSFT"]?.earn?.[0]?.eps === 3.72 && docs["EQ.MSFT"]?.earn?.[0]?.est === 3.6, docs["EQ.MSFT"]);
t("calendar creates no doc for a company without one (NVDA)", !docs["EQ.NVDA"]);

// A company whose report date has passed is refetched first, even when its data is fresh.
calls.length = 0;
const s2 = memoryStore({ fund: [
  { id: "EQ.AAPL", data: { ...a, asOf: "2026-10-26T05:40:00Z", nextEarn: "2026-10-27" } as never },
  { id: "EQ.CCJ", data: { ...c, asOf: "2026-10-01T05:40:00Z" } as never },
] });
const r2 = await runFundamentalsSync({ store: s2, now: NOW, only: ["AAPL", "CCJ"], providers: ["eodhd"], budget: 1 });
t("reported-since-last-fetch company refreshed first", r2.updated[0]?.tk === "AAPL" || r2.failed[0]?.tk === "AAPL", r2);

// --- NGX listings (data desk instruments) ---
const ngxStore = memoryStore({ adm_inst: [
  { id: "AD.NG.MTNN", data: { kind: "inst", id: "AD.NG.MTNN", meta: { tk: "MTNN", exch: "NGX" }, d: [], c: [] } },
  { id: "AD.NG.DANGCEM", data: { kind: "inst", id: "AD.NG.DANGCEM", meta: { tk: "DANGCEM", exch: "NGX" }, d: [], c: [] } },
  { id: "AD.NG.NOPE", data: { kind: "inst", id: "AD.NG.NOPE", meta: { tk: "NOPE", exch: "NGX" }, d: [], c: [] } },
  { id: "AD.NG.MTNN~p1", data: { of: "AD.NG.MTNN", p: 1 } },
] });
const rn = await runFundamentalsSync({ store: ngxStore, now: NOW, only: ["MTNN", "DANGCEM", "NOPE"], providers: ["eodhd", "mansa"] });
const nd = Object.fromEntries(ngxStore.dump().fund.map((d) => [d.id, d.data as unknown as FundDoc]));
t("NGX: EODHD full statements via .XNSA, in NGN", nd["AD.NG.DANGCEM"]?.src === "eodhd" && nd["AD.NG.DANGCEM"].ccy === "NGN" && nd["AD.NG.DANGCEM"].fy.length === 3 && calls.includes("eodhd.com/api/fundamentals/DANGCEM.XNSA"), nd["AD.NG.DANGCEM"]);
const mt = nd["AD.NG.MTNN"];
t("NGX: Mansa snapshot when EODHD has no data", mt?.src === "mansa" && mt.kind === "snapshot" && mt.fy.length === 0 && mt.ccy === "NGN", mt);
t("NGX snapshot: shares from market cap / price, EPS from P/E, dividend from yield", Math.abs(mt.shares! - 9.27e12 / 455.5) < 1 && Math.abs(mt.ttm.eps! - 455.5 / 18.5) < 1e-9 && Math.abs(mt.ttm.divPs! - 0.035 * 455.5) < 1e-9, mt.ttm);
t("NGX: listing with no data anywhere reported as failed; part docs ignored", rn.failed.some((f) => f.tk === "NGX:NOPE") && !nd["AD.NG.MTNN~p1"] && rn.ngxTotal === 2, rn);
t("NGX: note counts listings", /2 of 3 NGX listings/.test(rn.note), rn.note);

// snapshotFrom handles other field names and nesting
const s1 = snapshotFrom("AD.NG.X", "X", "ngxpulse", { data: { symbol: "X", current_price: "100", outstanding_shares: "1,000,000", eps: 5, dividend_yield: 4.2, book_value: 40 } });
t("snapshot: nested data, string numbers, yield in %", s1?.shares === 1e6 && s1.ttm.eps === 5 && Math.abs((s1.ttm.divPs ?? 0) - 4.2) < 1e-9 && s1.bs.equity === 40e6 && s1.ttm.ni === 5e6, s1);
t("snapshot: too little data → null", snapshotFrom("AD.NG.Y", "Y", "africa", { symbol: "Y", price: 10 }) === null);

// Dry run writes nothing; no providers writes nothing.
const dry = memoryStore(); await runFundamentalsSync({ store: dry, now: NOW, only: ["AAPL"], providers: ["eodhd"], dryRun: true });
t("dry run writes nothing", JSON.stringify(dry.dump()) === "{}");
const none = memoryStore(); const r0 = await runFundamentalsSync({ store: none, now: NOW, providers: [] });
t("no providers: nothing written", JSON.stringify(none.dump()) === "{}" && r0.updated.length === 0);

console.log(fails ? `\n${fails} fundamentals-sync test(s) failed` : "\nAll fundamentals-sync tests passed");
process.exit(fails ? 1 : 0);
