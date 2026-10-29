/**
 * ExchangeRate-API — daily FX rates for 160+ currencies (includes NGN, GHS,
 * KES, ZAR, EGP).
 * Docs: https://www.exchangerate-api.com/docs/overview
 * Auth: the key is part of the URL path (/v6/<key>/...).
 * Errors come back as { result: "error", "error-type": "..." }.
 */
import { getJson, requireKey, type FetchOptions } from "./http";

export const ENV = "EXCHANGERATE_API_KEY";
const NAME = "ExchangeRate-API";
const BASE = "https://v6.exchangerate-api.com/v6";

export type ErLatest = { result: "success"; base_code: string; time_last_update_utc: string; time_next_update_utc: string; conversion_rates: Record<string, number> };
export type ErPair = { result: "success"; base_code: string; target_code: string; conversion_rate: number; conversion_result?: number; time_last_update_utc: string };

const inBodyError = (b: unknown) => {
  const o = (b ?? {}) as Record<string, unknown>;
  return o.result === "error" ? `error: ${o["error-type"] ?? "unknown"}` : undefined;
};

export function createExchangeRate(apiKey = requireKey(NAME, ENV), opts: FetchOptions = {}) {
  const get = <T>(...parts: (string | number)[]) =>
    getJson<T>(NAME, new URL(`${BASE}/${encodeURIComponent(apiKey)}/${parts.map((p) => encodeURIComponent(String(p))).join("/")}`), { ...opts, inBodyError });
  const ccy = (c: string) => c.trim().toUpperCase();

  return {
    latest: (base = "USD") => get<ErLatest>("latest", ccy(base)),
    pair: (from: string, to: string, amount?: number) =>
      amount === undefined ? get<ErPair>("pair", ccy(from), ccy(to)) : get<ErPair>("pair", ccy(from), ccy(to), amount),
    /** Historical rates (paid plans). */
    history: (base: string, date: string) => { const [y, m, d] = date.split("-"); return get<Record<string, unknown>>("history", ccy(base), Number(y), Number(m), Number(d)); },
    codes: () => get<{ result: "success"; supported_codes: [string, string][] }>("codes"),
    quota: () => get<{ result: "success"; plan_quota: number; requests_remaining: number; refresh_day_of_month: number }>("quota"),
    ping: () => get<ErPair>("pair", "USD", "NGN"),
  };
}
