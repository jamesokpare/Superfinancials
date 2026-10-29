/**
 * NewsAPI.ai (Event Registry) — news articles and events from 150k+ sources,
 * with concept/entity tagging, sentiment and event clustering.
 * Uses Event Registry's official SDK (npm: eventregistry).
 * Docs: https://newsapi.ai/documentation
 */
import { EventRegistry, searchArticles } from "eventregistry";
import { ProviderError, requireKey } from "./http";

export { EventRegistry, QueryArticles, QueryEvents, RequestArticlesInfo, ReturnInfo } from "eventregistry";
export const ENV = "NEWSAPI_AI_KEY";
const NAME = "NewsAPI.ai";

type SearchArgs = Parameters<typeof searchArticles>[1];

/** The SDK returns `{ error }` instead of throwing, so turn that into an exception. */
function check<T>(res: T): T {
  const err = (res as { error?: unknown } | null)?.error;
  if (err) throw new ProviderError(NAME, String(err));
  return res;
}

/**
 * Returns the SDK client plus helpers, e.g.
 *   const news = createNewsApiAi();
 *   await news.searchArticles({ keywords: "Dangote Cement", count: 20, sortBy: "date" });
 *   const uri = await news.er.concepts.uri("Central Bank of Nigeria");
 */
export function createNewsApiAi(apiKey = requireKey(NAME, ENV)) {
  // Two retries instead of the SDK default of unlimited, so a request fails fast.
  const er = new EventRegistry({ apiKey, repeatFailedRequestCount: 2, allowUseOfArchive: false });
  return {
    er,
    searchArticles: async (args: SearchArgs = {}) => check(await searchArticles(er, args)),
    ping: async () => check(await searchArticles(er, { keywords: "stock market", count: 1 })),
  };
}
