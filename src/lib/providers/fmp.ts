/**
 * Financial Modeling Prep — quotes, profiles, statements, ratios, history, news.
 * Docs: https://site.financialmodelingprep.com/developer/docs (the "stable" API;
 * the legacy /api/v3 endpoints are closed to keys created after Aug 2025).
 * Auth: `apikey` query parameter.
 */
import { buildUrl, getJson, requireKey, type FetchOptions, type Query } from "./http";

export const ENV = "FMP_API_KEY";
const NAME = "Financial Modeling Prep";
const BASE = "https://financialmodelingprep.com/stable";

export type FmpQuote = {
  symbol: string; name: string; price: number; changePercentage: number; change: number; volume: number;
  dayLow: number; dayHigh: number; yearHigh: number; yearLow: number; marketCap: number; exchange: string;
  open: number; previousClose: number; timestamp: number;
};
type Period = "annual" | "quarter";

const inBodyError = (b: unknown) => {
  const m = b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>)["Error Message"] : undefined;
  return m ? String(m) : undefined;
};

export function createFmp(apiKey = requireKey(NAME, ENV), opts: FetchOptions = {}) {
  /** Call any stable endpoint, e.g. get("/ratios", { symbol: "AAPL" }). */
  const get = <T = unknown>(path: string, params: Query = {}) =>
    getJson<T>(NAME, buildUrl(BASE, path, { ...params, apikey: apiKey }), { ...opts, inBodyError });

  return {
    get,
    quote: (symbol: string) => get<FmpQuote[]>("/quote", { symbol }),
    profile: (symbol: string) => get<Record<string, unknown>[]>("/profile", { symbol }),
    search: (query: string, limit = 10) => get<Record<string, unknown>[]>("/search-symbol", { query, limit }),
    historicalEod: (symbol: string, from?: string, to?: string) => get("/historical-price-eod/full", { symbol, from, to }),
    incomeStatement: (symbol: string, period: Period = "annual", limit = 5) => get("/income-statement", { symbol, period, limit }),
    balanceSheet: (symbol: string, period: Period = "annual", limit = 5) => get("/balance-sheet-statement", { symbol, period, limit }),
    cashFlow: (symbol: string, period: Period = "annual", limit = 5) => get("/cash-flow-statement", { symbol, period, limit }),
    keyMetrics: (symbol: string, period: Period = "annual", limit = 5) => get("/key-metrics", { symbol, period, limit }),
    ratios: (symbol: string, period: Period = "annual", limit = 5) => get("/ratios", { symbol, period, limit }),
    earningsCalendar: (from?: string, to?: string) => get("/earnings-calendar", { from, to }),
    stockNews: (symbols: string, limit = 20) => get("/news/stock", { symbols, limit }),
    fxQuote: (pair: string) => get<FmpQuote[]>("/quote", { symbol: pair }),
    ping: () => get<FmpQuote[]>("/quote", { symbol: "AAPL" }),
  };
}
