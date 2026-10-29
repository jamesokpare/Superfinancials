/**
 * NGX Pulse — Nigerian Exchange (NGX) equities, market summary, market status
 * and disclosures, plus NASD OTC securities.
 * Docs: https://ngxpulse.ng/api
 * Auth: `X-API-Key: <key>` header (keys look like ngxpulse_sk_...).
 * Prices are in NGN and refresh during NGX trading hours.
 * Optional NGX_PULSE_BASE_URL overrides the base URL.
 */
import { buildUrl, envKey, getJson, requireKey, type FetchOptions, type Query } from "./http";

export const ENV = "NGX_PULSE_API_KEY";
const NAME = "NGX Pulse";
const base = () => envKey("NGX_PULSE_BASE_URL") ?? "https://ngxpulse.ng/api";

export type NgxStock = { symbol: string; name?: string; current_price: number; change_percent: number; volume: number; [k: string]: unknown };

export function createNgxPulse(apiKey = requireKey(NAME, ENV), opts: FetchOptions = {}) {
  const get = <T = unknown>(path: string, params: Query = {}) =>
    getJson<T>(NAME, buildUrl(base(), path, params), { ...opts, init: { ...opts.init, headers: { ...opts.init?.headers, "x-api-key": apiKey } } });

  return {
    get,
    /** Latest price and volume for every NGX-listed equity. */
    stocks: () => get<unknown>("/ngxdata/stocks"),
    price: (symbol: string) => get<unknown>(`/ngxdata/prices/${encodeURIComponent(symbol.trim().toUpperCase())}`),
    /** ASI, market cap, turnover, breadth. */
    market: () => get("/ngxdata/market"),
    marketStatus: () => get("/ngxdata/market-status"),
    disclosures: () => get("/ngxdata/disclosures"),
    nasdStocks: () => get("/nasddata/stocks"),
    ping: () => get("/ngxdata/market-status"),
  };
}
