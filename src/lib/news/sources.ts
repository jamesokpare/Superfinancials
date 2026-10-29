/**
 * Fetches recent market headlines from the news providers and normalizes them
 * to one shape. Each function makes a small, fixed number of requests so a
 * scheduled run stays inside free-plan limits.
 */
import { ArticleInfoFlags, QueryItems, ReturnInfo } from "eventregistry";
import { createCurrents } from "@/lib/providers/currents";
import { createMarketaux } from "@/lib/providers/marketaux";
import { createNewsApiAi } from "@/lib/providers/newsapi-ai";

export type NewsProvider = "marketaux" | "newsapi" | "currents" | "official";

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

// --- Official sources: press-release RSS/Atom feeds of central banks, statistics agencies and regulators ---------
/** Public feeds (no key). Headlines link to the publisher; U.S. federal releases are public domain. */
export const OFFICIAL_FEEDS: { url: string; src: string; cc: string[] }[] = [
  { url: "https://www.federalreserve.gov/feeds/press_all.xml", src: "Federal Reserve", cc: ["US"] },
  { url: "https://www.ecb.europa.eu/rss/press.html", src: "European Central Bank", cc: ["EU"] },
  { url: "https://www.bankofengland.co.uk/rss/news", src: "Bank of England", cc: ["GB"] },
  { url: "https://www.bls.gov/feed/bls_latest.rss", src: "U.S. Bureau of Labor Statistics", cc: ["US"] },
  { url: "https://apps.bea.gov/rss/rss.xml", src: "U.S. Bureau of Economic Analysis", cc: ["US"] },
  { url: "https://www.eia.gov/rss/todayinenergy.xml", src: "U.S. Energy Information Administration", cc: ["US"] },
  { url: "https://www.sec.gov/news/pressreleases.rss", src: "U.S. SEC", cc: ["US"] },
  { url: "https://www.imf.org/en/News/rss?language=eng", src: "IMF", cc: [] },
];
const unxml = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, "&").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(); // second tag pass: summaries are often escaped HTML
const tagOf = (x: string, names: string[]) => { for (const n of names) { const m = x.match(new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`, "i")); if (m) return m[1]; } return ""; };
/** RSS 2.0 <item> or Atom <entry> → title, link, date, summary. */
export function parseFeed(xml: string): { title: string; url: string; t: string; sum: string }[] {
  const blocks = [...xml.matchAll(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi)].map((m) => m[0]);
  return blocks.map((b) => {
    const href = b.match(/<link[^>]*href="([^"]+)"/i)?.[1];
    return { title: unxml(tagOf(b, ["title"])), url: unxml(href ?? tagOf(b, ["link", "guid"])), t: unxml(tagOf(b, ["pubDate", "published", "updated", "dc:date"])), sum: unxml(tagOf(b, ["description", "summary", "content"])) };
  });
}
export async function officialNews(since: Date): Promise<NewsItem[]> {
  const out: NewsItem[] = []; const errors: string[] = [];
  await Promise.all(OFFICIAL_FEEDS.map(async (f) => {
    try {
      const r = await fetch(f.url, { headers: { "user-agent": "Mozilla/5.0 (compatible; Superfinancials news sync; +https://github.com/jamesokpare/Superfinancials)", accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" }, signal: AbortSignal.timeout(30_000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      for (const x of parseFeed(await r.text())) {
        const it = item({ t: x.t, title: x.title, sum: x.sum, url: x.url, src: f.src, via: "official", tk: [], cc: f.cc, sent: null });
        if (it && Date.parse(it.t) >= since.getTime()) out.push(it);
      }
    } catch (e) { errors.push(`${f.src}: ${(e as Error).message}`); }
  }));
  if (!out.length && errors.length === OFFICIAL_FEEDS.length) throw new Error(errors.slice(0, 3).join("; "));
  return out;
}
