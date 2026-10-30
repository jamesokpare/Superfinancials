/**
 * Alpha Vantage — quotes, daily/intraday history, FX, crypto, commodities,
 * economic indicators, fundamentals and news sentiment.
 * Docs: https://www.alphavantage.co/documentation/
 * Auth: `apikey` query parameter. Every call goes to /query?function=...
 * Errors and rate-limit notices come back as HTTP 200 with an
 * "Error Message", "Note" or "Information" field, so those are checked too.
 */
import { buildUrl, getJson, requireKey, type FetchOptions, type Query } from "./http";

export const ENV = "ALPHAVANTAGE_API_KEY";
const NAME = "Alpha Vantage";
const BASE = "https://www.alphavantage.co";

export type GlobalQuote = {
  "Global Quote": {
    "01. symbol": string; "02. open": string; "03. high": string; "04. low": string; "05. price": string;
    "06. volume": string; "07. latest trading day": string; "08. previous close": string; "09. change": string; "10. change percent": string;
  };
};

const inBodyError = (b: unknown) => {
  const o = (b ?? {}) as Record<string, unknown>;
  const m = o["Error Message"] ?? o["Note"] ?? o["Information"];
  return m ? String(m) : undefined;
};

export function createAlphaVantage(apiKey = requireKey(NAME, ENV), opts: FetchOptions = {}) {
  /** Call any Alpha Vantage function, e.g. query("OVERVIEW", { symbol: "IBM" }). */
  const query = <T = Record<string, unknown>>(fn: string, params: Query = {}) =>
    getJson<T>(NAME, buildUrl(BASE, "/query", { function: fn, ...params, apikey: apiKey }), { ...opts, inBodyError });

  return {
    query,
    quote: (symbol: string) => query<GlobalQuote>("GLOBAL_QUOTE", { symbol }),
    search: (keywords: string) => query("SYMBOL_SEARCH", { keywords }),
    daily: (symbol: string, outputsize: "compact" | "full" = "compact") => query("TIME_SERIES_DAILY", { symbol, outputsize }),
    intraday: (symbol: string, interval: "1min" | "5min" | "15min" | "30min" | "60min" = "5min") =>
      query("TIME_SERIES_INTRADAY", { symbol, interval }),
    fxRate: (from: string, to: string) => query("CURRENCY_EXCHANGE_RATE", { from_currency: from, to_currency: to }),
    fxDaily: (from: string, to: string) => query("FX_DAILY", { from_symbol: from, to_symbol: to }),
    overview: (symbol: string) => query("OVERVIEW", { symbol }),
    incomeStatement: (symbol: string) => query("INCOME_STATEMENT", { symbol }),
    balanceSheet: (symbol: string) => query("BALANCE_SHEET", { symbol }),
    cashFlow: (symbol: string) => query("CASH_FLOW", { symbol }),
    earnings: (symbol: string) => query("EARNINGS", { symbol }),
    /** Economic indicators: REAL_GDP, CPI, INFLATION, FEDERAL_FUNDS_RATE, TREASURY_YIELD, UNEMPLOYMENT, ... */
    economic: (fn: string, params: Query = {}) => query(fn, params),
    /** Commodities: WTI, BRENT, NATURAL_GAS, COPPER, ... */
    commodity: (fn: string, interval: "daily" | "weekly" | "monthly" = "monthly") => query(fn, { interval }),
    news: (params: { tickers?: string; topics?: string; time_from?: string; sort?: "LATEST" | "EARLIEST" | "RELEVANCE"; limit?: number } = {}) => query("NEWS_SENTIMENT", params),
    topMovers: () => query("TOP_GAINERS_LOSERS"),
    ping: () => query<GlobalQuote>("GLOBAL_QUOTE", { symbol: "IBM" }),
  };
}
