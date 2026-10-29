/**
 * MyStocks Africa Partner API — delayed quotes, OHLCV candles, company
 * profiles, news and market intelligence for NGX, NSE, JSE, GSE, BRVM and
 * other African exchanges.
 * Docs: https://mystocks.africa/partners/docs/market-data
 * Auth: `Authorization: Bearer <key>`. Live keys start with pk_live_, sandbox
 * keys with sk_sandbox_; a sandbox key is sent to the sandbox base path.
 * Optional MYSTOCKS_AFRICA_BASE_URL overrides the full base URL.
 */
import { buildUrl, envKey, getJson, requireKey, type FetchOptions, type Query } from "./http";

export const ENV = "MYSTOCKS_AFRICA_API_KEY";
const NAME = "MyStocks Africa";
const HOST = "https://mystocks.africa";
const sym = (s: string) => encodeURIComponent(s.trim().toUpperCase());

export const myStocksBase = (apiKey: string) =>
  envKey("MYSTOCKS_AFRICA_BASE_URL") ?? `${HOST}/api/${apiKey.startsWith("sk_sandbox") ? "sandbox/" : ""}v1/partner`;

export function createMyStocksAfrica(apiKey = requireKey(NAME, ENV), opts: FetchOptions = {}) {
  const base = myStocksBase(apiKey);
  const get = <T = unknown>(path: string, params: Query = {}) =>
    getJson<T>(NAME, buildUrl(base, path, params), { ...opts, init: { ...opts.init, headers: { ...opts.init?.headers, authorization: `Bearer ${apiKey}` } } });

  return {
    get,
    /** List stocks, e.g. stocks({ exchange: "NGX", limit: 50 }). */
    stocks: (params: { exchange?: string; limit?: number; offset?: number; q?: string } = {}) => get("/stocks", params),
    stock: (symbol: string) => get(`/stocks/${sym(symbol)}`),
    /** OHLCV candles (the provider's preferred history endpoint). */
    candles: (symbol: string, params: { interval?: string; from?: string; to?: string; limit?: number } = {}) => get(`/stocks/${sym(symbol)}/candles`, params),
    news: (symbol: string) => get(`/stocks/${sym(symbol)}/pulse`),
    companies: (params: Query = {}) => get("/companies", params),
    company: (symbol: string) => get(`/companies/${sym(symbol)}`),
    marketIntel: (params: { exchange?: string } = {}) => get("/market-intel", params),
    ping: () => get("/stocks", { exchange: "NGX", limit: 1 }),
  };
}
