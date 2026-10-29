/**
 * Marketaux — global financial news with entity tagging and sentiment.
 * Docs: https://www.marketaux.com/documentation
 * Auth: `api_token` query parameter.
 */
import { buildUrl, getJson, requireKey, type FetchOptions, type Query } from "./http";

export const ENV = "MARKETAUX_API_KEY";
const NAME = "Marketaux";
const BASE = "https://api.marketaux.com/v1";

export type MarketauxArticle = {
  uuid: string; title: string; description: string; snippet: string; url: string; image_url: string | null;
  language: string; published_at: string; source: string; relevance_score: number | null;
  entities: { symbol: string; name: string; exchange: string | null; country: string; type: string; industry: string; match_score: number; sentiment_score: number }[];
};
export type MarketauxNews = { meta: { found: number; returned: number; limit: number; page: number }; data: MarketauxArticle[] };
export type NewsParams = {
  symbols?: string; entity_types?: string; industries?: string; countries?: string; search?: string;
  filter_entities?: boolean; must_have_entities?: boolean; language?: string; domains?: string;
  published_after?: string; published_before?: string; sort?: string; limit?: number; page?: number;
};

export function createMarketaux(apiKey = requireKey(NAME, ENV), opts: FetchOptions = {}) {
  const get = <T = unknown>(path: string, params: Query = {}) =>
    getJson<T>(NAME, buildUrl(BASE, path, { ...params, api_token: apiKey }), opts);

  return {
    get,
    news: (params: NewsParams = {}) => get<MarketauxNews>("/news/all", { language: "en", ...params }),
    article: (uuid: string) => get<MarketauxArticle>(`/news/uuid/${encodeURIComponent(uuid)}`),
    similar: (uuid: string) => get<MarketauxNews>(`/news/similar/${encodeURIComponent(uuid)}`),
    entitySearch: (search: string, params: Query = {}) => get("/entity/search", { search, ...params }),
    entityStats: (params: Query = {}) => get("/entity/stats/aggregation", params),
    trending: (params: Query = {}) => get("/entity/trending/aggregation", params),
    ping: () => get<MarketauxNews>("/news/all", { language: "en", limit: 1 }),
  };
}
