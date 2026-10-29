// Test of src/lib/news/sync.ts with a fake fetch and an in-memory docs table:
// normalization, de-duplication across providers and days, tag merging,
// pruning, provider errors, dry runs and idempotent re-runs.
// Run: npm test
import { runNewsSync } from "../src/lib/news/sync";
import { DEAL_FEEDS, OFFICIAL_FEEDS, dealAmount, parseFeed } from "../src/lib/news/sources";
import { memoryStore } from "../src/lib/market/store";

for (const k of ["MARKETAUX_API_KEY", "NEWSAPI_AI_KEY", "CURRENTS_API_KEY"]) process.env[k] = "test-" + k;
const NOW = new Date("2026-10-29T16:45:00Z");
let currentsDown = false;
const calls: string[] = [];

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input)); calls.push(url.hostname + url.pathname);
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
  if (url.hostname === "api.marketaux.com") {
    if (url.searchParams.get("countries")) return json({ meta: {}, data: [{ uuid: "m3", title: "Naira firms as CBN sells dollars", description: "The naira gained at the official window.", snippet: "", url: "https://businessday.ng/markets/naira-firms", image_url: null, published_at: "2026-10-29T09:00:00.000000Z", source: "businessday.ng", entities: [{ symbol: "MTNN.XNSA", type: "equity", country: "ng", sentiment_score: 0.4 }] }] });
    if (url.searchParams.get("page") === "1") return json({ meta: {}, data: [
      { uuid: "m1", title: "Apple shares rise after record iPhone sales", description: "Apple reported...", snippet: "", url: "https://www.reuters.com/markets/apple-record?utm=x", image_url: "https://img.example/a.jpg", published_at: "2026-10-29T14:00:00.000000Z", source: "reuters.com", entities: [{ symbol: "AAPL", type: "equity", country: "us", sentiment_score: 0.6 }, { symbol: "AAPL", type: "equity", country: "us", sentiment_score: 0.2 }] },
      { uuid: "m2", title: "Fed holds rates steady", description: "", snippet: "The Fed held...", url: "https://apnews.com/fed-holds", image_url: null, published_at: "2026-10-28T19:00:00.000000Z", source: "apnews.com", entities: [] },
    ] });
    return json({ meta: {}, data: [] });
  }
  if (url.hostname === "eventregistry.org") {
    const body = JSON.parse(String(init?.body ?? "{}"));
    const isAfrica = JSON.stringify(body).includes("naira");
    return json({ articles: { results: isAfrica ? [] : [
      // Same story as Marketaux's Apple item (same URL without the query string): kept once, Marketaux copy wins.
      { url: "https://reuters.com/markets/apple-record", title: "Apple shares rise after record iPhone sales", body: "Long body", dateTimePub: "2026-10-29T14:05:00Z", source: { title: "Reuters" }, sentiment: 0.1 },
      { url: "https://www.ft.com/content/oil", title: "Oil slips as OPEC+ weighs output", body: "Crude fell...", dateTimePub: "2026-10-29T11:00:00Z", source: { title: "Financial Times" }, image: "https://img.example/o.jpg", sentiment: -0.3 },
      { url: "https://x.example/dupe", title: "Duplicate", body: "", dateTimePub: "2026-10-29T10:00:00Z", source: { title: "X" }, isDuplicate: true },
    ] } });
  }
  if (url.hostname === "api.currentsapi.services") {
    if (currentsDown) return json({ status: "error", message: "Invalid API key" }, 401);
    return json({ status: "ok", news: url.searchParams.get("country") ? [] : [
      // Same title as the FT story, different URL: kept once.
      { id: "c1", title: "Oil slips as OPEC+ weighs output", description: "", url: "https://news.example/oil-slips", author: "", image: "None", language: "en", category: ["finance"], published: "2026-10-29 11:30:00 +0000" },
      { id: "c2", title: "Gold edges higher", description: "Bullion rose.", url: "https://news.example/gold", author: "", image: "None", language: "en", category: ["finance"], published: "2026-10-29 12:00:00 +0000" },
      { id: "c3", title: "Bad date", description: "", url: "https://news.example/bad", author: "", image: "None", language: "en", category: [], published: "not a date" },
    ] });
  }
  return json({ error: "not mocked" }, 404);
}) as typeof fetch;

let fails = 0;
const t = (label: string, ok: boolean, info?: unknown) => { if (!ok) fails++; console.log((ok ? "PASS " : "FAIL ") + label, ok ? "" : JSON.stringify(info)); };
type Item = { id: string; t: string; title: string; url: string; via: string; tk: string[]; cc: string[]; sent: number | null; img?: string; src: string };

const seed = { mktnews: [
  { id: "day-2026-10-01", data: { type: "news-day", date: "2026-10-01", items: [{ id: "old", t: "2026-10-01T10:00:00Z", title: "Old", url: "https://o.example/1", via: "currents", tk: [], cc: [], sent: null, src: "o", sum: "" }] } },
] };

const dryStore = memoryStore(seed);
const dry = await runNewsSync({ store: dryStore, now: NOW, providers: ["marketaux", "newsapi", "currents"], marketauxPages: 2, dryRun: true });
const store = memoryStore(seed);
const r = await runNewsSync({ store, now: NOW, providers: ["marketaux", "newsapi", "currents"], marketauxPages: 2 });
const docs = Object.fromEntries(store.dump().mktnews.map((d) => [d.id, d.data as { items?: Item[]; note?: string }]));
const all = Object.values(docs).flatMap((d) => d.items ?? []);
const byTitle = (s: string) => all.filter((i) => i.title === s);

t("fetched from all three providers", r.fetched.marketaux === 3 && r.fetched.newsapi === 2 && r.fetched.currents === 2, r.fetched);
t("same URL from two providers stored once (Marketaux copy kept)", byTitle("Apple shares rise after record iPhone sales").length === 1 && byTitle("Apple shares rise after record iPhone sales")[0].via === "marketaux");
const apple = byTitle("Apple shares rise after record iPhone sales")[0];
t("Marketaux tickers, countries and mean sentiment", JSON.stringify(apple.tk) === '["AAPL"]' && JSON.stringify(apple.cc) === '["US"]' && apple.sent === 0.4 && apple.img === "https://img.example/a.jpg", apple);
t("exchange suffix stripped from tickers", JSON.stringify(byTitle("Naira firms as CBN sells dollars")[0]?.tk) === '["MTNN"]');
t("same title from two providers stored once", byTitle("Oil slips as OPEC+ weighs output").length === 1 && byTitle("Oil slips as OPEC+ weighs output")[0].sent === -0.3);
t("Event Registry duplicates and bad dates skipped", !all.some((i) => i.title === "Duplicate" || i.title === "Bad date"));
t("Currents 'None' image dropped and time parsed", byTitle("Gold edges higher")[0]?.t === "2026-10-29T12:00:00.000Z" && !byTitle("Gold edges higher")[0]?.img);
t("items stored under their publication day, newest first", (docs["day-2026-10-29"]?.items ?? []).map((i) => i.title)[0] === "Apple shares rise after record iPhone sales" && (docs["day-2026-10-28"]?.items ?? [])[0]?.title === "Fed holds rates steady", Object.keys(docs));
t("days older than 14 removed", !docs["day-2026-10-01"] && r.pruned.includes("day-2026-10-01"));
t("added count", r.added === 5, r.added);
t("meta written", String(docs._meta?.note).startsWith("News sync 2026-10-29 16:45 UTC: 5 new headlines"), docs._meta);
t("dry run wrote nothing", dry.added === 5 && JSON.stringify(dryStore.dump()) === JSON.stringify(memoryStore(seed).dump()));

// Second run: the same stories again, now with Currents failing.
currentsDown = true;
const r2 = await runNewsSync({ store, now: new Date(NOW.getTime() + 36e5), providers: ["marketaux", "newsapi", "currents"], marketauxPages: 2 });
const all2 = store.dump().mktnews.flatMap((d) => ((d.data as { items?: Item[] }).items ?? []));
t("re-run adds nothing new", r2.added === 0 && all2.length === all.length, [r2.added, all2.length, all.length]);
t("provider error reported, others still used", /Invalid API key/.test(r2.errors.currents ?? "") && r2.fetched.marketaux === 3, r2.errors);

currentsDown = false;
// A story first seen on one day and re-dated by another provider is not added twice.
const store3 = memoryStore({ mktnews: [{ id: "day-2026-10-28", data: { type: "news-day", date: "2026-10-28", items: [{ id: "x", t: "2026-10-28T23:50:00Z", title: "Gold edges higher", url: "https://news.example/gold", via: "newsapi", tk: [], cc: [], sent: null, src: "n", sum: "" }] } }] });
await runNewsSync({ store: store3, now: NOW, providers: ["currents"] });
const gold = store3.dump().mktnews.flatMap((d) => ((d.data as { items?: Item[] }).items ?? [])).filter((i) => i.title === "Gold edges higher");
t("cross-day duplicate merged into the day that holds it", gold.length === 1, gold);

const r0 = await runNewsSync({ store: memoryStore(), now: NOW, providers: [] });
t("no providers: nothing written", r0.added === 0 && r0.days.length === 0);

// Official RSS / Atom feeds
const rss = `<?xml version="1.0"?><rss><channel><title>Fed</title><item><title><![CDATA[Federal Reserve issues FOMC statement]]></title><link>https://www.federalreserve.gov/newsevents/pressreleases/monetary20261028a.htm</link><pubDate>Wed, 28 Oct 2026 18:00:00 GMT</pubDate><description>&lt;p&gt;The Committee decided to lower the target range &amp; …&lt;/p&gt;</description></item></channel></rss>`;
const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title type="html">ECB keeps rates unchanged</title><link rel="alternate" href="https://www.ecb.europa.eu/press/pr/date/2026/html/ecb.mp261029.en.html"/><updated>2026-10-29T13:15:00Z</updated><summary>Monetary policy decisions</summary></entry></feed>`;
const p1 = parseFeed(rss), p2 = parseFeed(atom);
t("RSS item: CDATA title, link, date, tags stripped from summary", p1.length === 1 && p1[0].title === "Federal Reserve issues FOMC statement" && p1[0].url.endsWith("monetary20261028a.htm") && p1[0].t === "Wed, 28 Oct 2026 18:00:00 GMT" && p1[0].sum === "The Committee decided to lower the target range & …", p1);
t("Atom entry: href link, updated date", p2.length === 1 && p2[0].url.endsWith("ecb.mp261029.en.html") && p2[0].t === "2026-10-29T13:15:00Z", p2);
const _f = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request) => {
  const u = String(input instanceof Request ? input.url : input);
  if (u === OFFICIAL_FEEDS[0].url) return new Response(rss); if (u === OFFICIAL_FEEDS[1].url) return new Response(atom);
  return new Response("down", { status: 503 });
}) as typeof fetch;
const os = memoryStore(); const ro = await runNewsSync({ store: os, now: NOW, providers: ["official"] });
const oi = (await os.list("mktnews")).filter((d) => d.id.startsWith("day-")).flatMap((d) => (d.data.items as { via: string; src: string; cc: string[] }[]));
t("official feeds: stored as 'official', publisher and country set, failing feeds don't stop the rest", ro.added === 2 && oi.every((x) => x.via === "official") && oi.some((x) => x.src === "Federal Reserve" && x.cc[0] === "US") && oi.some((x) => x.src === "European Central Bank" && x.cc[0] === "EU") && !ro.errors.official, { ro, oi });
const deals = `<?xml version="1.0"?><rss><channel>
<item><title>Lagos fintech Moniepoint raises $110 million Series C</title><link>https://techcabal.com/2026/10/29/moniepoint-c/</link><pubDate>Thu, 29 Oct 2026 08:00:00 GMT</pubDate><description><![CDATA[<p>Full article text that must not be stored.</p>]]></description></item>
<item><title>Five things we learned at a conference</title><link>https://techcabal.com/2026/10/29/conference/</link><pubDate>Thu, 29 Oct 2026 07:00:00 GMT</pubDate></item>
<item><title>Partech closes €280M Africa fund II</title><link>https://techcabal.com/2026/10/28/partech/</link><pubDate>Wed, 28 Oct 2026 12:00:00 GMT</pubDate></item>
</channel></rss>`;
globalThis.fetch = (async (input: string | URL | Request) => String(input instanceof Request ? input.url : input) === DEAL_FEEDS[2].url ? new Response(deals) : new Response("down", { status: 503 })) as typeof fetch;
const ds = memoryStore(); const rd = await runNewsSync({ store: ds, now: NOW, providers: ["deals"] });
const di = (await ds.list("mktnews")).filter((d) => d.id.startsWith("day-")).flatMap((d) => (d.data.items as { via: string; src: string; sum: string; title: string }[]));
t("deal feeds: funding stories only, headline and link kept, publisher text not stored, amount read from the headline", rd.added === 2 && di.every((x) => x.via === "deals" && x.src === "TechCabal" && !/article text/.test(x.sum)) && di.some((x) => x.sum === "Reported amount: US$110m.") && di.some((x) => x.sum === "Reported amount: €280m."), { rd, di });
t("deal amounts", dealAmount("raises US$1.2bn") === "US$1.2bn" && dealAmount("₦2 billion round") === "₦2bn" && dealAmount("PR2 launch") === null && dealAmount("$5 coffee") === null && dealAmount("KSh 500m") === "KSh500m");
globalThis.fetch = _f;

console.log(fails ? `\n${fails} news-sync test(s) failed` : "\nAll news-sync tests passed");
process.exit(fails ? 1 : 0);
