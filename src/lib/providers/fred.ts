/**
 * FRED (Federal Reserve Bank of St. Louis) — 800k+ US and international
 * economic time series.
 * Docs: https://fred.stlouisfed.org/docs/api/fred/
 * Auth: `api_key` query parameter; `file_type=json` is required for JSON.
 */
import { buildUrl, getJson, requireKey, type FetchOptions, type Query } from "./http";

export const ENV = "FRED_API_KEY";
const NAME = "FRED";
const BASE = "https://api.stlouisfed.org/fred";

export type FredObservation = { realtime_start: string; realtime_end: string; date: string; value: string };
export type FredObservations = { count: number; offset: number; limit: number; units: string; observations: FredObservation[] };
export type FredSeries = { id: string; title: string; frequency: string; units: string; last_updated: string; observation_start: string; observation_end: string; notes?: string };

export function createFred(apiKey = requireKey(NAME, ENV), opts: FetchOptions = {}) {
  /** Call any FRED endpoint, e.g. get("/release/dates", { release_id: 53 }). */
  const get = <T = unknown>(path: string, params: Query = {}) =>
    getJson<T>(NAME, buildUrl(BASE, path, { ...params, api_key: apiKey, file_type: "json" }), opts);

  return {
    get,
    series: (seriesId: string) => get<{ seriess: FredSeries[] }>("/series", { series_id: seriesId }),
    /** units: lin (levels), chg, ch1, pch, pc1, pca, cch, cca, log. */
    observations: (seriesId: string, params: { observation_start?: string; observation_end?: string; units?: string; frequency?: string; limit?: number; sort_order?: "asc" | "desc" } = {}) =>
      get<FredObservations>("/series/observations", { series_id: seriesId, ...params }),
    /** Latest non-missing value of a series, as a number. */
    async latest(seriesId: string) {
      const r = await get<FredObservations>("/series/observations", { series_id: seriesId, sort_order: "desc", limit: 10 });
      const o = r.observations.find((x) => x.value !== ".");
      return o ? { date: o.date, value: Number(o.value) } : null;
    },
    search: (text: string, limit = 20) => get<{ seriess: FredSeries[] }>("/series/search", { search_text: text, limit }),
    releases: () => get("/releases"),
    ping: () => get<{ seriess: FredSeries[] }>("/series", { series_id: "GDP" }),
  };
}
