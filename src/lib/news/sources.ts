/**
 * Fetches recent market headlines from the news providers and normalizes them
 * to one shape. Each function makes a small, fixed number of requests so a
 * scheduled run stays inside free-plan limits.
 */
import { ArticleInfoFlags, QueryItems, ReturnInfo } from "eventregistry";
import { createAlphaVantage } from "@/lib/providers/alphavantage";
import { createCurrents } from "@/lib/providers/currents";
import { createEodhd } from "@/lib/providers/eodhd";
import { US_EQUITIES } from "@/lib/market/instruments";
import { createMarketaux } from "@/lib/providers/marketaux";
import { createNewsApiAi } from "@/lib/providers/newsapi-ai";

export type NewsProvider = "marketaux" | "newsapi" | "currents" | "alphavantage" | "eodhd" | "official" | "deals";

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

// --- Alpha Vantage: market news with sentiment scored per article and per ticker ----------------
type AvTicker = { ticker?: string; relevance_score?: string; ticker_sentiment_score?: string };
type AvArticle = { title?: string; url?: string; time_published?: string; summary?: string; banner_image?: string | null; source?: string; source_domain?: string; overall_sentiment_score?: number | string; ticker_sentiment?: AvTicker[] };
/** "20261029T083000" → ISO time. */
export const avTime = (s: unknown) => { const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?/.exec(String(s ?? "")); return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? "00"}Z` : null; };
/** One request (free keys allow 25 a day): the latest market, economy and earnings stories. */
export async function alphaVantageNews(since: Date, limit = 50): Promise<NewsItem[]> {
  const from = since.toISOString().replace(/[-:]/g, "").slice(0, 13); // YYYYMMDDTHHMM
  const res = await createAlphaVantage().news({ topics: "financial_markets,economy_macro,earnings", time_from: from, sort: "LATEST", limit }) as { feed?: AvArticle[] };
  const out: NewsItem[] = [];
  for (const a of res.feed ?? []) {
    const url = String(a.url ?? "");
    const tk = (a.ticker_sentiment ?? []).filter((x) => Number(x.relevance_score) >= 0.3 && x.ticker && !x.ticker.includes(":")).map((x) => String(x.ticker));
    const sent = Number(a.overall_sentiment_score);
    const it = item({ t: avTime(a.time_published), title: a.title, sum: a.summary, url, src: a.source || a.source_domain || host(url), via: "alphavantage", img: a.banner_image ?? undefined, tk, cc: [], sent: Number.isFinite(sent) ? Number(Math.max(-1, Math.min(1, sent)).toFixed(3)) : null });
    if (it) out.push(it);
  }
  return out;
}

// --- EODHD: company news with sentiment, a few tracked U.S. companies a run in rotation --------------
/** The `count` tickers for this run: the list is walked in order, twice a day, so every company is covered every few days. */
export function eodhdNewsTickers(now: Date, count: number): string[] {
  const all = US_EQUITIES.split(" "); if (!count) return [];
  const slot = Math.floor(now.getTime() / (12 * 36e5)); const start = (slot * count) % all.length;
  return Array.from({ length: Math.min(count, all.length) }, (_, i) => all[(start + i) % all.length]);
}
export async function eodhdNews(since: Date, now: Date, count = 4): Promise<NewsItem[]> {
  const eod = createEodhd(); const out: NewsItem[] = []; const from = since.toISOString().slice(0, 10); const errs: string[] = [];
  for (const tk of eodhdNewsTickers(now, count)) {
    try {
      for (const a of await eod.news({ s: `${tk}.US`, from, limit: 10 })) {
        const syms = (a.symbols ?? []).filter((x) => x.endsWith(".US")).map((x) => x.slice(0, -3));
        const it = item({ t: a.date, title: a.title, sum: a.content, url: a.link, src: host(a.link), via: "eodhd", tk: [tk, ...syms.slice(0, 5)], cc: [], sent: typeof a.sentiment?.polarity === "number" ? Number(a.sentiment.polarity.toFixed(3)) : null });
        if (it && Date.parse(it.t) >= since.getTime()) out.push(it);
      }
    } catch (e) { errs.push(`${tk}: ${(e as Error).message}`); }
  }
  if (!out.length && errs.length) throw new Error(errs.join("; "));
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
async function feedNews(feeds: { url: string; src: string; cc: string[] }[], via: NewsProvider, since: Date, keep: (x: { title: string; url: string; t: string; sum: string }) => { sum: string } | null): Promise<NewsItem[]> {
  const out: NewsItem[] = []; const errors: string[] = [];
  await Promise.all(feeds.map(async (f) => {
    try {
      const r = await fetch(f.url, { headers: { "user-agent": "Mozilla/5.0 (compatible; Superfinancials news sync; +https://github.com/jamesokpare/Superfinancials)", accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" }, signal: AbortSignal.timeout(30_000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      for (const x of parseFeed(await r.text())) {
        const k = keep(x); if (!k) continue;
        const it = item({ t: x.t, title: x.title, sum: k.sum, url: x.url, src: f.src, via, tk: [], cc: f.cc, sent: null });
        if (it && Date.parse(it.t) >= since.getTime()) out.push(it);
      }
    } catch (e) { errors.push(`${f.src}: ${(e as Error).message}`); }
  }));
  if (!out.length && errors.length === feeds.length) throw new Error(errors.slice(0, 3).join("; "));
  return out;
}
export const officialNews = (since: Date) => feedNews(OFFICIAL_FEEDS, "official", since, (x) => ({ sum: x.sum }));

/**
 * Startup and venture news (RSS, no key): funding rounds, new funds, exits. Publishers' own text is not stored:
 * only headline, link, date and outlet, plus the round size the app reads from the headline. (TechCrunch's RSS
 * terms allow showing feed items with attribution and a link; the others publish standard public feeds.)
 */
export const DEAL_FEEDS: { url: string; src: string; cc: string[] }[] = [
  { url: "https://techcrunch.com/category/venture/feed/", src: "TechCrunch", cc: [] },
  { url: "https://news.crunchbase.com/feed/", src: "Crunchbase News", cc: [] },
  { url: "https://techcabal.com/feed/", src: "TechCabal", cc: [] },
  { url: "https://techpoint.africa/feed/", src: "Techpoint Africa", cc: ["NG"] },
  { url: "https://disruptafrica.com/feed/", src: "Disrupt Africa", cc: [] },
  { url: "https://www.wamda.com/feed", src: "Wamda", cc: [] },
  { url: "https://sifted.eu/feed", src: "Sifted", cc: [] },
  { url: "https://www.eu-startups.com/feed/", src: "EU-Startups", cc: [] },
];
const DEAL_RE = /\b(rais(e|es|ed|ing)|funding|seed|pre-seed|series [a-f]\b|round|backs|backed|invest(s|ment|ors?)?|acquir(e|es|ed)|acquisition|fund (i|ii|iii|iv|v|close|launch)|closes? .*fund|new fund|valuation|unicorn|ipo|exit)\b/i;
/** "$12m", "$12 million", "US$1.2bn", "€5M", "₦2 billion" → "US$12m" style text; null when no amount. */
export function dealAmount(title: string): string | null {
  const m = title.match(/(?<![A-Za-z])(US\$|\$|€|£|₦|KSh|R)\s?(\d+(?:[.,]\d+)?)\s?(bn|billion|b|m|million|mn|k|thousand)?\b/i);
  if (!m || !m[3] && Number(m[2].replace(",", "")) < 1000) return null;
  const unit = !m[3] ? "" : /^b/i.test(m[3]) ? "bn" : /^(k|t)/i.test(m[3]) ? "k" : "m";
  return `${m[1] === "$" ? "US$" : m[1]}${m[2]}${unit}`;
}
export const dealNews = (since: Date) => feedNews(DEAL_FEEDS, "deals", since, (x) => {
  if (!DEAL_RE.test(x.title)) return null;
  const amt = dealAmount(x.title);
  return { sum: amt ? `Reported amount: ${amt}.` : "" };
});
