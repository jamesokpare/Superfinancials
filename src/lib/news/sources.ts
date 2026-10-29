/**
 * Fetches recent market headlines from the news providers and normalizes them
 * to one shape. Each function makes a small, fixed number of requests so a
 * scheduled run stays inside free-plan limits.
 */
import { ArticleInfoFlags, QueryItems, ReturnInfo } from "eventregistry";
import { createCurrents } from "@/lib/providers/currents";
import { createMarketaux } from "@/lib/providers/marketaux";
import { createNewsApiAi } from "@/lib/providers/newsapi-ai";

export type NewsProvider = "marketaux" | "newsapi" | "currents";

export type NewsItem = {
  /** Stable id: a hash of the canonical URL. */
  id: string;
  /** Published time, ISO 8601 UTC. */
  t: string;
  title: string;
  /** Short summary, at most 300 characters. */
  sum: string;
  url: string;
  /** Publisher (e.g. "reuters.com", "Financial Times"). */
  src: string;
  /** Which provider found it. */
  via: NewsProvider;
  img?: string;
  /** Ticker symbols the provider tagged (e.g. "AAPL", "MTNN"). The app adds more by matching company names. */
  tk: string[];
  /** ISO country codes the provider tagged. */
  cc: string[];
  /** Sentiment from -1 (negative) to 1 (positive), when the provider scores it. */
  sent: number | null;
};

const clip = (s: unknown, n = 300) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : t;
};
const isoTime = (v: unknown) => { const t = Date.parse(String(v ?? "")); return Number.isFinite(t) ? new Date(t).toISOString() : null; };
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };

/** Canonical form of a URL for de-duplication: no query string, hash, trailing slash or "www.". */
export function canonicalUrl(u: string) {
  try { const x = new URL(u); return `${x.protocol}//${x.hostname.replace(/^www\./, "")}${x.pathname.replace(/\/+$/, "")}`.toLowerCase(); } catch { return u.trim().toLowerCase(); }
}
/** FNV-1a hash, base 36: short ids that are valid document keys. */
export function hashId(s: string) {
  let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36) + s.length.toString(36);
}
function item(x: Omit<NewsItem, "id" | "t" | "title" | "sum"> & { t: unknown; title: unknown; sum: unknown }): NewsItem | null {
  const t = isoTime(x.t); const title = clip(x.title, 240);
  if (!t || !title || !/^https?:\/\//.test(x.url)) return null;
  const img = x.img && /^https:\/\//.test(x.img) ? x.img : undefined;
  return { ...x, id: hashId(canonicalUrl(x.url)), t, title, sum: clip(x.sum), img, tk: [...new Set(x.tk.filter(Boolean).map((s) => s.toUpperCase()))], cc: [...new Set(x.cc.filter(Boolean).map((s) => s.toUpperCase()))] };
}
const avg = (a: number[]) => (a.length ? Number((a.reduce((s, v) => s + v, 0) / a.length).toFixed(3)) : null);

// --- Marketaux: entity-tagged financial news with sentiment ------------------------------
/** `pages` requests of general news plus one of African markets. Free keys return 3 articles a request. */
export async function marketauxNews(since: Date, pages = 3): Promise<NewsItem[]> {
  const mx = createMarketaux(); const after = since.toISOString().slice(0, 16);
  const base = { language: "en", filter_entities: true, published_after: after, sort: "published_at", limit: 50 } as const;
  const general = Array.from({ length: pages }, (_, i) => ({ ...base, page: i + 1 }));
  const africa = { ...base, countries: "ng,za,ke,gh,eg", page: 1 };
  const out: NewsItem[] = [];
  const run = async (q: typeof africa | (typeof general)[number]) => {
    const res = await mx.news(q);
    for (const a of res.data ?? []) {
      const ents = a.entities ?? [];
      const it = item({
        t: a.published_at, title: a.title, sum: a.description || a.snippet, url: a.url, src: a.source || host(a.url), via: "marketaux", img: a.image_url ?? undefined,
        tk: ents.filter((e) => ["equity", "etf", "index"].includes(String(e.type))).map((e) => String(e.symbol).split(".")[0]),
        cc: ents.map((e) => (String(e.country).length === 2 ? String(e.country) : "")),
        sent: avg(ents.map((e) => Number(e.sentiment_score)).filter(Number.isFinite)),
      });
      if (it) out.push(it);
    }
    return (res.data ?? []).length;
  };
  // Stop paging general news once a page comes back empty; the African query always runs.
  for (const q of general) if (!(await run(q))) break;
  await run(africa);
  return out;
}

// --- NewsAPI.ai (Event Registry): broad business coverage, de-duplicated --------------------
type ErArticle = { url?: string; title?: string; body?: string; dateTimePub?: string; dateTime?: string; image?: string; sentiment?: number | null; source?: { title?: string; uri?: string }; isDuplicate?: boolean };
export async function newsApiAiNews(since: Date, count = 50): Promise<NewsItem[]> {
  const news = createNewsApiAi();
  const returnInfo = new ReturnInfo({ articleInfo: new ArticleInfoFlags({ bodyLen: 400, image: true, sentiment: true }) });
  const common = { lang: "eng", dateStart: since.toISOString().slice(0, 10), isDuplicateFilter: "skipDuplicates" as const, sortBy: "date", returnInfo };
  const runs = [
    { ...common, categoryUri: "news/Business", count },
    { ...common, keywords: QueryItems.OR(["Nigerian Exchange", "NGX All-Share", "naira", "Central Bank of Nigeria", "Johannesburg Stock Exchange", "Nairobi Securities Exchange"]), count: Math.min(30, count) },
  ];
  const out: NewsItem[] = [];
  for (const args of runs) {
    const res = (await news.searchArticles(args)) as { articles?: { results?: ErArticle[] } };
    for (const a of res.articles?.results ?? []) {
      if (a.isDuplicate || !a.url) continue;
      const it = item({ t: a.dateTimePub || a.dateTime, title: a.title, sum: a.body, url: a.url, src: a.source?.title || a.source?.uri || host(a.url), via: "newsapi", img: a.image, tk: [], cc: [], sent: typeof a.sentiment === "number" ? Number(a.sentiment.toFixed(3)) : null });
      if (it) out.push(it);
    }
  }
  return out;
}

// --- Currents API: finance and business news, with a Nigeria-specific query ---------------------
export async function currentsNews(since: Date): Promise<NewsItem[]> {
  const cur = createCurrents(); const start = since.toISOString().replace(/\.\d+Z$/, "+00:00");
  const runs = [{ language: "en", category: "finance", start_date: start }, { language: "en", category: "business", country: "NG", start_date: start }];
  const out: NewsItem[] = [];
  for (const q of runs) {
    const res = await cur.search(q);
    for (const a of res.news ?? []) {
      const it = item({ t: String(a.published).replace(" +0000", "Z").replace(" ", "T"), title: a.title, sum: a.description, url: a.url, src: host(a.url), via: "currents", img: a.image && a.image !== "None" ? a.image : undefined, tk: [], cc: q.country ? [q.country] : [], sent: null });
      if (it) out.push(it);
    }
  }
  return out;
}
