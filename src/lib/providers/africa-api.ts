/**
 * Africa API — country-level data for all 54 African countries: economic
 * indicators, stock exchanges and tickers, FX rates, trade, government,
 * elections and policies.
 * Site: https://africa-api.com (keys from https://africa-api.com/dashboard)
 * Auth: `Authorization: Bearer <key>`.
 * Endpoints mirror the provider's own MCP server (npm: africa-api-mcp).
 * Optional AFRICA_API_BASE_URL overrides the host.
 */
import { buildUrl, envKey, getJson, requireKey, type FetchOptions, type Query } from "./http";

export const ENV = "AFRICA_API_KEY";
const NAME = "Africa API";
const base = () => (envKey("AFRICA_API_BASE_URL") ?? "https://api.africa-api.com") + "/v1";
const seg = encodeURIComponent;

type Range = { start_date?: string; end_date?: string; limit?: number };

export function createAfricaApi(apiKey = requireKey(NAME, ENV), opts: FetchOptions = {}) {
  const get = <T = unknown>(path: string, params: Query = {}) =>
    getJson<T>(NAME, buildUrl(base(), path, params), { ...opts, init: { ...opts.init, headers: { ...opts.init?.headers, authorization: `Bearer ${apiKey}` } } });

  return {
    get,
    countries: (params: Query = {}) => get("/countries", params),
    country: (code: string) => get(`/countries/${seg(code)}`),
    countryProfile: (code: string) => get(`/countries/${seg(code)}/profile`),
    indicators: (params: { category?: string; source?: string; has_data?: boolean } = {}) => get("/indicators", params),
    indicatorRankings: (metricKey: string, params: { year?: number; source?: string; limit?: number; order?: "asc" | "desc" } = {}) =>
      get(`/indicators/${seg(metricKey)}/rankings`, params),
    /** Indicator values, e.g. data({ country_code: "NG", metric_key: "gdp_current_usd" }). */
    data: (params: Query) => get("/data", params),
    exchanges: (params: Query = {}) => get("/markets/exchanges", params),
    exchange: (code: string) => get(`/markets/exchanges/${seg(code)}`),
    indexHistory: (exchangeCode: string, range: Range = {}) => get(`/markets/exchanges/${seg(exchangeCode)}/index/history`, range),
    tickers: (params: { exchange_code?: string; country_code?: string; search?: string; limit?: number } = {}) => get("/markets/tickers", params),
    ticker: (exchangeCode: string, symbol: string) => get(`/markets/tickers/${seg(exchangeCode)}/${seg(symbol)}`),
    tickerHistory: (exchangeCode: string, symbol: string, range: Range = {}) => get(`/markets/tickers/${seg(exchangeCode)}/${seg(symbol)}/history`, range),
    fxRates: (params: Query = {}) => get("/markets/fx-rates", params),
    fxHistory: (base: string, quote: string, range: Range = {}) => get(`/markets/fx-rates/${seg(base)}/${seg(quote)}/history`, range),
    tradeOverview: (code: string, params: { start_year?: number; end_year?: number; top_limit?: number } = {}) => get(`/trade/overview/${seg(code)}`, params),
    upcomingElections: (limit = 20) => get("/elections/upcoming", { limit }),
    ping: () => get("/countries/NG"),
  };
}
