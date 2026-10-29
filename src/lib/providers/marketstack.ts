/**
 * Marketstack (v2) — end-of-day and intraday prices for 170k+ tickers across
 * 70+ exchanges, plus dividends, splits and exchange metadata.
 * Docs: https://docs.apilayer.com/marketstack/docs/marketstack-api-v2-v-2-0-0
 * Auth: `access_key` query parameter.
 */
import { buildUrl, getJson, requireKey, type FetchOptions, type Query } from "./http";

export const ENV = "MARKETSTACK_API_KEY";
const NAME = "Marketstack";
const BASE = "https://api.marketstack.com/v2";

export type MsBar = { date: string; symbol: string; exchange: string; open: number; high: number; low: number; close: number; volume: number; adj_close?: number };
export type MsPage<T> = { pagination: { limit: number; offset: number; count: number; total: number }; data: T[] };
type Range = { date_from?: string; date_to?: string; limit?: number; offset?: number; exchange?: string };

const inBodyError = (b: unknown) => {
  const e = (b as { error?: { code?: string; message?: string } } | null)?.error;
  return e ? `${e.code ?? "error"}: ${e.message ?? ""}` : undefined;
};

export function createMarketstack(apiKey = requireKey(NAME, ENV), opts: FetchOptions = {}) {
  const get = <T = unknown>(path: string, params: Query = {}) =>
    getJson<T>(NAME, buildUrl(BASE, path, { ...params, access_key: apiKey }), { ...opts, inBodyError });

  return {
    get,
    /** symbols: comma-separated, e.g. "AAPL,MSFT". */
    eod: (symbols: string, range: Range = {}) => get<MsPage<MsBar>>("/eod", { symbols, ...range }),
    eodLatest: (symbols: string) => get<MsPage<MsBar>>("/eod/latest", { symbols }),
    eodOn: (symbols: string, date: string) => get<MsPage<MsBar>>(`/eod/${encodeURIComponent(date)}`, { symbols }),
    intraday: (symbols: string, interval = "1hour", range: Range = {}) => get<MsPage<MsBar>>("/intraday", { symbols, interval, ...range }),
    dividends: (symbols: string, range: Range = {}) => get("/dividends", { symbols, ...range }),
    splits: (symbols: string, range: Range = {}) => get("/splits", { symbols, ...range }),
    tickerInfo: (ticker: string) => get("/tickerinfo", { ticker }),
    tickers: (params: { search?: string; exchange?: string; limit?: number; offset?: number } = {}) => get("/tickerslist", params),
    exchanges: (params: { search?: string; limit?: number; offset?: number } = {}) => get("/exchanges", params),
    ping: () => get<MsPage<MsBar>>("/eod/latest", { symbols: "AAPL" }),
  };
}
