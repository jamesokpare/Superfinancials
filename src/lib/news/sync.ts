/**
 * News sync: pulls recent headlines from Marketaux, NewsAPI.ai and Currents
 * and stores them for the app's Market news page:
 *
 *   mktnews/day-<YYYY-MM-DD>  { type: "news-day", date, checked, items: NewsItem[] }  newest first
 *   mktnews/_meta             { type: "meta", checked, n, via, note }
 *
 * The same story from several providers is kept once (matched by URL, then by
 * title), with the providers' ticker and country tags merged. Days older than
 * `keepDays` are deleted, and each day keeps at most `perDay` items.
 * The collection is world-readable and written only by the server.
 */
import "server-only";
import { envKey } from "@/lib/providers/http";
import { scrub } from "@/lib/providers";
import { openStore, type Doc, type DocStore } from "@/lib/market/store";
import { canonicalUrl, currentsNews, marketauxNews, newsApiAiNews, officialNews, type NewsItem, type NewsProvider } from "./sources";

const ENVS: Record<Exclude<NewsProvider, "official">, string> = { marketaux: "MARKETAUX_API_KEY", newsapi: "NEWSAPI_AI_KEY", currents: "CURRENTS_API_KEY" };
const LABEL: Record<NewsProvider, string> = { marketaux: "Marketaux", newsapi: "NewsAPI.ai", currents: "Currents", official: "Official sources" };
const COL = "mktnews";
const DAY = 864e5;

export type NewsSyncOptions = {
  store?: DocStore;
  dryRun?: boolean;
  now?: Date;
  /** How far back to ask providers for articles. Default 36 hours. */
  lookbackHours?: number;
  /** Days of headlines kept. Default NEWS_KEEP_DAYS or 14. */
  keepDays?: number;
  /** Max items stored per day. Default 200. */
  perDay?: number;
  /** Marketaux general-news requests per run. Default MARKETAUX_PAGES or 3. */
  marketauxPages?: number;
  /** Override which providers count as configured (tests). */
  providers?: NewsProvider[];
};

export type NewsSyncReport = {
  dryRun: boolean;
  configured: NewsProvider[];
  fetched: Record<string, number>;
  errors: Record<string, string>;
  added: number;
  total: number;
  days: string[];
  pruned: string[];
  note: string;
};

const titleKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const intEnv = (k: string, d: number) => { const n = Number(process.env[k]); return Number.isFinite(n) && n > 0 ? n : d; };

/** Merges `incoming` into `existing`; the earlier copy of a story wins, tags are unioned. Returns how many were new. */
export function mergeItems(existing: NewsItem[], incoming: NewsItem[]): { items: NewsItem[]; added: number } {
  const byUrl = new Map<string, NewsItem>(); const byTitle = new Map<string, NewsItem>(); let added = 0;
  const index = (x: NewsItem) => { byUrl.set(canonicalUrl(x.url), x); byTitle.set(titleKey(x.title), x); };
  const items = existing.map((x) => ({ ...x })); items.forEach(index);
  for (const x of incoming) {
    const hit = byUrl.get(canonicalUrl(x.url)) ?? byTitle.get(titleKey(x.title));
    if (hit) {
      hit.tk = [...new Set([...hit.tk, ...x.tk])]; hit.cc = [...new Set([...hit.cc, ...x.cc])];
      if (hit.sent === null && x.sent !== null) hit.sent = x.sent;
      if (!hit.img && x.img) hit.img = x.img;
      continue;
    }
    const copy = { ...x }; items.push(copy); index(copy); added++;
  }
  items.sort((a, b) => (a.t < b.t ? 1 : a.t > b.t ? -1 : 0));
  return { items, added };
}

export async function runNewsSync(opts: NewsSyncOptions = {}): Promise<NewsSyncReport> {
  const now = opts.now ?? new Date(); const checked = now.toISOString();
  const since = new Date(now.getTime() - (opts.lookbackHours ?? 36) * 36e5);
  const keepDays = opts.keepDays ?? intEnv("NEWS_KEEP_DAYS", 14); const perDay = opts.perDay ?? 200;
  // Official feeds need no key, so they always run (last: a story also carried by a news API keeps that richer copy).
  const configured = opts.providers ?? [...(Object.keys(ENVS) as Exclude<NewsProvider, "official">[]).filter((p) => envKey(ENVS[p])), "official" as const];

  const fetched: Record<string, number> = {}; const errors: Record<string, string> = {};
  const fetchers: Record<NewsProvider, () => Promise<NewsItem[]>> = {
    marketaux: () => marketauxNews(since, opts.marketauxPages ?? intEnv("MARKETAUX_PAGES", 3)),
    newsapi: () => newsApiAiNews(since),
    currents: () => currentsNews(since),
    official: () => officialNews(since),
  };
  const batches = await Promise.all(configured.map(async (p) => {
    try { const r = await fetchers[p](); fetched[p] = r.length; return r; }
    catch (e) { errors[p] = scrub(String((e as Error)?.message ?? e)).slice(0, 300); fetched[p] = 0; return []; }
  }));
  // Providers in a fixed order, so a story seen by several keeps Marketaux's copy (it has tickers and sentiment).
  const incoming = batches.flat().filter((x) => Date.parse(x.t) <= now.getTime() + 5 * 60e3);

  const store = opts.store ?? openStore();
  const docs = new Map((await store.list(COL)).map((d) => [d.id, d.data]));
  const cutoff = new Date(now.getTime() - keepDays * DAY).toISOString().slice(0, 10);
  const dayItems = (d: string) => ((docs.get(`day-${d}`) as { items?: NewsItem[] } | undefined)?.items ?? []);

  // A story already stored goes back to the day that holds it (providers may date it differently),
  // so it is merged there instead of being added twice.
  const home = new Map<string, string>();
  for (const id of docs.keys()) { const m = /^day-(\d{4}-\d{2}-\d{2})$/.exec(id); if (m) for (const x of dayItems(m[1])) { home.set(canonicalUrl(x.url), m[1]); home.set("t:" + titleKey(x.title), m[1]); } }
  const byDay = new Map<string, NewsItem[]>();
  for (const x of incoming) {
    const cu = canonicalUrl(x.url), tk = "t:" + titleKey(x.title);
    const d = home.get(cu) ?? home.get(tk) ?? x.t.slice(0, 10);
    if (d < cutoff) continue;
    home.set(cu, d); home.set(tk, d);
    if (!byDay.has(d)) byDay.set(d, []); byDay.get(d)!.push(x);
  }
  let added = 0; const writes: Doc[] = [];
  for (const [d, list] of [...byDay].sort()) {
    const old = dayItems(d);
    const { items, added: n } = mergeItems(old, list);
    const kept = items.slice(0, perDay);
    added += n;
    // Written when there are new stories or new tags on existing ones.
    if (JSON.stringify(kept) !== JSON.stringify(old)) writes.push({ id: `day-${d}`, data: { type: "news-day", date: d, checked, items: kept } });
  }
  const pruned = [...docs.keys()].filter((id) => /^day-\d{4}-\d{2}-\d{2}$/.test(id) && id.slice(4) < cutoff);
  const total = [...docs].filter(([id]) => id.startsWith("day-") && !pruned.includes(id)).reduce((s, [id, x]) => s + (writes.find((w) => w.id === id) ? 0 : ((x as { items?: unknown[] }).items?.length ?? 0)), 0)
    + writes.reduce((s, w) => s + ((w.data.items as unknown[]).length), 0);

  const via = Object.entries(fetched).filter(([, n]) => n).map(([p, n]) => `${LABEL[p as NewsProvider]} ${n}`).join(", ");
  const note = `News sync ${checked.slice(0, 16).replace("T", " ")} UTC: ${added} new headlines${via ? ` (fetched: ${via})` : ""}; ${total} kept over ${keepDays} days.` + (Object.keys(errors).length ? ` Errors: ${Object.keys(errors).map((p) => LABEL[p as NewsProvider]).join(", ")}.` : "");
  const report: NewsSyncReport = { dryRun: !!opts.dryRun, configured, fetched, errors, added, total, days: writes.map((w) => w.id), pruned, note };
  if (opts.dryRun || !configured.length) return report;

  if (writes.length) await store.upsert(COL, writes);
  await store.upsert(COL, [{ id: "_meta", data: { type: "meta", checked, n: total, via: fetched, note } }]);
  await store.remove(COL, pruned);
  return report;
}
