/**
 * Mansa API (Mansa Markets) — African stock markets: exchanges, stocks,
 * indices, ETFs, movers, dividends, disclosures, FX and commodities.
 * Site: https://mansaapi.com · https://mansamarkets.com/developers
 * Auth: `Authorization: Bearer <key>` (keys look like mansa_live_sk_...).
 * Endpoints mirror Mansa's official Python SDK (PyPI: mansaapi).
 * Exchange codes are lowercase slugs, e.g. "nigeria", "ghana", "kenya".
 * Optional MANSA_API_BASE_URL overrides the host.
 */
import { buildUrl, envKey, getJson, requireKey, type FetchOptions, type Query } from "./http";

export const ENV = "MANSA_API_KEY";
const NAME = "Mansa API";
const base = () => (envKey("MANSA_API_BASE_URL") ?? "https://www.mansaapi.com") + "/api/v1";
const ex = (code: string) => `/markets/exchanges/${encodeURIComponent(code.toLowerCase())}`;

/** Responses are { success: true, data, ... } or { success: false, error: { code, message } }. */
export type MansaResponse<T = unknown> = { success: boolean; data: T; meta?: Record<string, unknown> };

const inBodyError = (b: unknown) => {
  const o = (b ?? {}) as { success?: boolean; error?: { code?: string; message?: string } };
  return o.success === false ? `${o.error?.code ?? "error"}: ${o.error?.message ?? ""}` : undefined;
};

export function createMansa(apiKey = requireKey(NAME, ENV), opts: FetchOptions = {}) {
  const get = <T = unknown>(path: string, params: Query = {}) =>
    getJson<MansaResponse<T>>(NAME, buildUrl(base(), path, params), { ...opts, inBodyError, init: { ...opts.init, headers: { ...opts.init?.headers, authorization: `Bearer ${apiKey}` } } });

  return {
    get,
    exchanges: () => get("/markets/exchanges"),
    exchange: (code: string) => get(ex(code)),
    stocks: (exchange: string, params: { limit?: number; sort_by?: string; order?: "asc" | "desc"; page?: number } = {}) => get(`${ex(exchange)}/stocks`, params),
    stock: (exchange: string, ticker: string) => get(`${ex(exchange)}/stocks/${encodeURIComponent(ticker)}`),
    movers: (exchange: string, params: { limit?: number; type?: "gainers" | "losers" } = {}) => get(`${ex(exchange)}/movers`, params),
    panAfricanMovers: (limit = 10) => get("/markets/movers/pan-african", { limit }),
    indices: (exchange: string) => get(`${ex(exchange)}/indices`),
    index: (exchange: string, code: string) => get(`${ex(exchange)}/indices/${encodeURIComponent(code)}`),
    etfs: (exchange: string) => get(`${ex(exchange)}/etfs`),
    dividends: (exchange: string, ticker: string) => get(`${ex(exchange)}/dividends/${encodeURIComponent(ticker)}`),
    disclosures: (exchange: string, params: Query = {}) => get(`${ex(exchange)}/disclosures`, params),
    forex: () => get("/markets/forex"),
    commodities: () => get("/markets/commodities"),
    search: (q: string, params: Query = {}) => get("/markets/search", { q, ...params }),
    ping: () => get("/markets/exchanges"),
  };
}
