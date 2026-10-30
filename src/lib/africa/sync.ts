/**
 * African markets sync: the parts of Mansa API, NGX Pulse, MyStocks Africa and
 * Africa API that the price and fundamentals syncs don't use. Runs once a day.
 *
 *   afr/ngx                  NGX snapshot for the Movers page: market summary (All-Share,
 *                            market cap, volume, value, deals, breadth, session status),
 *                            gainers, decliners, most active, pan-African movers, NGX ETFs,
 *                            NASD OTC securities and MyStocks market intelligence
 *   adm_news/auto-ngxd-<h>   NGX corporate disclosures (NGX Pulse, Mansa)
 *   adm_news/auto-msn-<h>    company news for NGX listings (MyStocks Africa)
 *   adm_cal/auto-ngxdiv-…    NGX dividends: qualification and payment dates (Mansa)
 *   adm_cal/auto-elec-…      upcoming elections in African countries (Africa API)
 *   afr/_meta                last-run summary { checked, n, note, sources, state }
 *
 * News and events use the data desk's own format, so the app shows them on Market
 * news, the calendar, Country data and the security pages of the listings they
 * name. Documents the owner entered (no gen:'africa-sync') are never touched.
 * Dividends and company news are fetched per listing, a few listings per run in
 * rotation, to stay inside the providers' request limits.
 */
import "server-only";
import { scrub } from "@/lib/providers";
import { envKey } from "@/lib/providers/http";
import { createAfricaApi } from "@/lib/providers/africa-api";
import { createMansa } from "@/lib/providers/mansa";
import { createMyStocksAfrica } from "@/lib/providers/mystocks-africa";
import { createNgxPulse } from "@/lib/providers/ngx-pulse";
import { findNumber } from "@/lib/market/sources";
import { openStore, type Doc, type DocStore } from "@/lib/market/store";
import { africanCode, africanName, allRows, firstRows, hash, httpUrl, isoDate, nameOf, number, readMovers, slug, text, type Mover, type Obj } from "./read";

export const GEN = "africa-sync";
const COL = "afr";
const DAY = 864e5;
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);
const intEnv = (k: string, d: number) => { const n = Number(process.env[k]); return process.env[k] && Number.isFinite(n) && n >= 0 ? n : d; };
const errText = (e: unknown) => scrub(String((e as Error)?.message ?? e)).slice(0, 300);
const soft = <T>(p: Promise<T>) => p.catch(() => null);

export type AfricaSourceId = "ngx-market" | "ngx-movers" | "pan-african" | "etfs" | "nasd" | "intel" | "disclosures" | "company-news" | "dividends" | "elections";
const NEEDS: Record<AfricaSourceId, string[]> = {
  "ngx-market": ["NGX_PULSE_API_KEY", "MANSA_API_KEY"], "ngx-movers": ["MANSA_API_KEY", "NGX_PULSE_API_KEY", "MYSTOCKS_AFRICA_API_KEY"],
  "pan-african": ["MANSA_API_KEY"], etfs: ["MANSA_API_KEY"], nasd: ["NGX_PULSE_API_KEY"], intel: ["MYSTOCKS_AFRICA_API_KEY"],
  disclosures: ["NGX_PULSE_API_KEY", "MANSA_API_KEY"], "company-news": ["MYSTOCKS_AFRICA_API_KEY"], dividends: ["MANSA_API_KEY"], elections: ["AFRICA_API_KEY"],
};
const has = (k: string) => !!envKey(k);

export type NgxMarket = { asi: number | null; chp: number | null; mcap: number | null; volume: number | null; value: number | null; deals: number | null; adv: number | null; dec: number | null; unch: number | null; status: string; src: string };
export type NgxSnapshot = {
  type: "ngx"; asOf: string; at: Partial<Record<string, string>>; src: Partial<Record<string, string>>;
  market?: NgxMarket; gainers?: Mover[]; losers?: Mover[]; active?: Mover[]; pan?: Mover[]; etfs?: Mover[]; nasd?: Mover[];
  intel?: { text: string[]; sectors: { name: string; chp: number }[] };
};
type NewsDoc = { title: string; date: string; sum: string; cc: string[]; cat: string; imp: 1 | 2 | 3; ids: string[]; srcName: string; url: string; gen: string; upd: string };
type CalDoc = { title: string; date: string; time: string; cc: string; cat: string; imp: 1 | 2 | 3; unit: string; cons: string; prior: string; actual: string; ids: string[]; srcName: string; url: string; notes: string; gen: string; upd: string };

export type AfricaReport = {
  date: string; dryRun: boolean; store: string;
  sources: Partial<Record<AfricaSourceId, { n: number; src?: string; error?: string; skipped?: string }>>;
  snapshot: { sections: string[] };
  news: { written: number; removed: number };
  events: { written: number; removed: number };
  note: string;
};

// --- NGX market summary --------------------------------------------------------------
const ASI = /^(asi|ngx_?asi|all_?share(_?index)?|allshare(index)?|ngxasi|ngseindx|index_?value)$/i;
const RE = {
  chp: /^(asi_?change_?percent|asi_?pct_?change|change_?percent|percent_?change|pct_?change|change_?pct|percentage_?change)$/i,
  mcap: /^(market_?cap(italization|italisation)?|mcap|equity_?market_?cap(italization)?|total_?market_?cap)$/i,
  volume: /^(volume|total_?volume|traded_?volume|volume_?traded)$/i,
  value: /^(value|turnover|total_?value|traded_?value|value_?traded|total_?turnover)$/i,
  deals: /^(deals|total_?deals|number_?of_?deals|no_?of_?deals|trades|number_?of_?trades)$/i,
  adv: /^(advancers|advances|advancing|gainers_?count|num_?gainers|up)$/i,
  dec: /^(decliners|declines|declining|losers_?count|num_?losers|down)$/i,
  unch: /^(unchanged|flat|unchanged_?count)$/i,
};
function findStatus(body: unknown, depth = 0): string {
  if (!body || typeof body !== "object" || depth > 3) return "";
  const o = body as Obj;
  for (const [k, v] of Object.entries(o)) {
    if (/^(is_?open|open|market_?open)$/i.test(k) && typeof v === "boolean") return v ? "Open" : "Closed";
    if (/^(status|market_?status|session|state|trading_?status)$/i.test(k) && typeof v === "string" && v.length < 40) return v.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
  }
  for (const v of Object.values(o)) { const s = findStatus(v, depth + 1); if (s) return s; }
  return "";
}
export function readMarket(body: unknown, statusBody: unknown, src: string): NgxMarket | null {
  const f = (re: RegExp) => findNumber(body, re);
  const m: NgxMarket = { asi: f(ASI), chp: null, mcap: f(RE.mcap), volume: f(RE.volume), value: f(RE.value), deals: f(RE.deals), adv: f(RE.adv), dec: f(RE.dec), unch: f(RE.unch), status: findStatus(statusBody) || findStatus(body), src };
  // findNumber only returns positives; a change can be negative, so read it directly.
  m.chp = signedNumber(body, RE.chp);
  return m.asi || m.mcap || m.volume ? m : null;
}
function signedNumber(body: unknown, re: RegExp, depth = 0): number | null {
  if (!body || typeof body !== "object" || depth > 3) return null;
  for (const [k, v] of Object.entries(body as Obj)) if (re.test(k) && (typeof v === "number" || typeof v === "string")) { const n = number({ v }, ["v"]); if (n !== null) return n; }
  for (const v of Object.values(body as Obj)) { const n = signedNumber(v, re, depth + 1); if (n !== null) return n; }
  return null;
}

// --- market intelligence -------------------------------------------------------------
export function readIntel(body: unknown): NgxSnapshot["intel"] | null {
  const out: string[] = [];
  const walk = (o: unknown, depth: number) => {
    if (!o || typeof o !== "object" || depth > 4 || out.length >= 6) return;
    for (const [k, v] of Object.entries(o as Obj)) {
      if (typeof v === "string" && /summary|commentary|insight|outlook|headline|narrative|overview|analysis|note|sentiment|takeaway/i.test(k) && v.trim().length >= 30 && !/^https?:/.test(v)) out.push(v.replace(/\s+/g, " ").trim().slice(0, 600));
      else if (Array.isArray(v) && /insight|highlight|takeaway|summary|commentary|note/i.test(k)) for (const x of v) { if (typeof x === "string" && x.trim().length >= 20) out.push(x.trim().slice(0, 600)); else walk(x, depth + 1); }
      else if (v && typeof v === "object") walk(v, depth + 1);
    }
  };
  walk(body, 0);
  const sectors: { name: string; chp: number }[] = [];
  for (const { key, rows } of allRows(body)) {
    if (!/sector|industr/i.test(key) && !rows.some((r) => "sector" in r)) continue;
    for (const r of rows) { const name = text(r, ["sector", "name", "industry", "sector_name"]); const chp = number(r, ["change_percent", "percent_change", "pct_change", "change", "performance", "return", "chp"]); if (name && chp !== null) sectors.push({ name, chp }); }
    if (sectors.length) break;
  }
  const textU = [...new Set(out)].slice(0, 6);
  return textU.length || sectors.length ? { text: textU, sectors: sectors.slice(0, 20) } : null;
}

// --- disclosures and news ------------------------------------------------------------
type Listing = { id: string; tk: string; name: string };
const IMPORTANT = /dividend|result|earnings|financial statement|merger|acquisition|takeover|rights issue|bonus|suspension|delist|board meeting|closure of register|profit warning|interim|audited/i;
export function readDisclosure(r: Obj, listings: Map<string, Listing>, srcName: string, upd: string): (NewsDoc & { id: string }) | null {
  const title = text(r, ["title", "headline", "subject", "disclosure_title", "description", "name"]); const date = isoDate(pick2(r, ["date", "published_at", "disclosure_date", "created_at", "publish_date", "date_published", "timestamp", "uploaded_at"]));
  if (!title || !date) return null;
  const tk = text(r, ["symbol", "ticker", "company_symbol", "stock_code", "code"]).toUpperCase();
  const co = text(r, ["company_name", "company", "issuer", "company_title"]) || nameOf(r.company);
  const type = text(r, ["type", "category", "disclosure_type", "kind"]);
  const url = httpUrl(text(r, ["url", "link", "document_url", "pdf_url", "file_url", "href", "attachment_url", "source_url", "attachment"]));
  const l = (tk && listings.get(tk)) || (co ? [...listings.values()].find((x) => x.name && x.name.toLowerCase() === co.toLowerCase()) : undefined);
  const who = co || l?.name || tk;
  const full = who && !title.toLowerCase().includes(who.toLowerCase()) ? `${who}: ${title}` : title;
  return {
    id: `auto-ngxd-${hash(date + "|" + title.toLowerCase().slice(0, 120))}`,
    title: full.slice(0, 300), date, sum: [type, tk && `NGX: ${tk}`].filter(Boolean).join(" · "), cc: ["NG"], cat: "Corporate disclosure",
    imp: IMPORTANT.test(title + " " + type) ? 3 : 2, ids: l ? [l.id] : [], srcName: `${srcName} (NGX corporate disclosures)`, url, gen: GEN, upd,
  };
}
const pick2 = (r: Obj, keys: string[]) => { for (const k of keys) { const v = r[k]; if (v !== undefined && v !== null && v !== "") return v; } return undefined; };
export function readNews(r: Obj, l: Listing, upd: string): (NewsDoc & { id: string }) | null {
  const title = text(r, ["title", "headline", "name"]); const date = isoDate(pick2(r, ["published_at", "date", "publishedAt", "pub_date", "created_at", "timestamp", "time"]));
  if (!title || !date) return null;
  const url = httpUrl(text(r, ["url", "link", "source_url", "article_url"]));
  const source = text(r, ["source_name", "publisher"]) || nameOf(r.source);
  const sum = text(r, ["summary", "description", "excerpt", "snippet", "content"]).slice(0, 400);
  return { id: `auto-msn-${hash((url || title).toLowerCase())}`, title: title.slice(0, 300), date, sum, cc: ["NG"], cat: "Company news", imp: 2, ids: l.id ? [l.id] : [], srcName: source ? `${source} (via MyStocks Africa)` : "MyStocks Africa", url, gen: GEN, upd };
}

// --- dividends and elections ---------------------------------------------------------
export function readDividends(body: unknown, l: Listing, upd: string, from: string): (CalDoc & { id: string })[] {
  const out: (CalDoc & { id: string })[] = [];
  for (const r of firstRows(body)) {
    const amt = number(r, ["amount", "dividend_per_share", "dps", "dividend", "cash_amount", "value", "dividend_amount", "rate"]);
    const ex = isoDate(pick2(r, ["ex_date", "exdate", "ex_dividend_date", "qualification_date", "closure_date", "record_date", "register_closure_date"]));
    const pay = isoDate(pick2(r, ["payment_date", "pay_date", "paid_date", "payable_date", "payment"]));
    const kind = text(r, ["type", "dividend_type", "kind", "period", "description"]).slice(0, 40);
    const ccy = text(r, ["currency", "ccy"]).toUpperCase() || "NGN";
    if (!ex && !pay) continue;
    const label = !kind ? "Dividend" : /dividend/i.test(kind) ? kind : `${kind} dividend`;
    const what = `${l.name || l.tk} (${l.tk}): ${label}`;
    const amount = amt !== null ? `${ccy === "NGN" ? "₦" : ccy + " "}${amt.toFixed(amt < 1 ? 4 : 2).replace(/0+$/, "").replace(/\.$/, "")} per share` : "";
    const notes = [amount && `Amount: ${amount}.`, ex && `Qualification / ex date: ${ex}.`, pay && `Payment date: ${pay}.`].filter(Boolean).join(" ");
    const base = { time: "", cc: "NG", cat: "div", imp: 2 as const, unit: "", cons: "", prior: "", actual: amount, ids: l.id ? [l.id] : [], srcName: "Mansa API (NGX dividends)", url: "https://mansamarkets.com", notes, gen: GEN, upd };
    if (ex && ex >= from) out.push({ id: `auto-ngxdiv-${l.tk}-${ex}`, title: `${what}: qualification date`, date: ex, ...base });
    if (pay && pay >= from && pay !== ex) out.push({ id: `auto-ngxdiv-${l.tk}-${pay}-pay`, title: `${what}: payment`, date: pay, ...base });
  }
  return out;
}
export function readElection(r: Obj, today: string, until: string, upd: string): (CalDoc & { id: string }) | null {
  const date = isoDate(pick2(r, ["date", "election_date", "scheduled_date", "start_date", "expected_date"]));
  if (!date || date < today || date > until) return null;
  const cc = africanCode(text(r, ["country_code", "iso2", "iso_code", "country_iso2", "iso3", "country_iso3", "code"]) || text(r, ["country", "country_name"]) || nameOf(r.country));
  if (!cc) return null;
  const type = text(r, ["type", "election_type", "category", "name", "title"]).replace(/\s*elections?$/i, "") || "National";
  const desc = text(r, ["description", "notes", "summary", "status"]).slice(0, 300);
  const title = `${africanName(cc)}: ${type.charAt(0).toUpperCase() + type.slice(1)} election`;
  return { id: `auto-elec-${cc}-${date}-${slug(type)}`, title, date, time: "", cc, cat: "pol", imp: /presiden|general|parliament|legislat|national assembly/i.test(type) ? 3 : 2, unit: "", cons: "", prior: "", actual: "", ids: [], srcName: "Africa API (elections)", url: httpUrl(text(r, ["url", "source_url", "link"])) || "https://africa-api.com", notes: desc, gen: GEN, upd };
}

// --- the run -------------------------------------------------------------------------
export async function runAfricaSync(opts: { store?: DocStore; dryRun?: boolean; now?: Date; only?: AfricaSourceId[]; newsBudget?: number; divBudget?: number } = {}): Promise<AfricaReport> {
  const now = opts.now ?? new Date(); const nowMs = now.getTime(); const upd = now.toISOString(); const today = isoDay(nowMs);
  const store = opts.store ?? openStore();
  const report: AfricaReport = { date: today, dryRun: !!opts.dryRun, store: store.kind, sources: {}, snapshot: { sections: [] }, news: { written: 0, removed: 0 }, events: { written: 0, removed: 0 }, note: "" };
  const afr = await store.list(COL); const prevMeta = afr.find((d) => d.id === "_meta")?.data; const prevSnap = (afr.find((d) => d.id === "ngx")?.data ?? {}) as Partial<NgxSnapshot>;
  const state = { ...((prevMeta?.state as Record<string, number> | undefined) ?? {}) };

  // NGX listings the app knows (data desk instruments AD.NG.<TK>), for linking news and dividends to securities.
  const listings = new Map<string, Listing>();
  for (const d of await store.list("adm_inst").catch(() => [] as Doc[])) {
    const meta = (d.data.meta ?? {}) as { exch?: string; tk?: string; name?: string };
    if (d.data.of || !(d.id.startsWith("AD.NG.") || meta.exch === "NGX")) continue;
    const tk = String(meta.tk || d.id.split(".").pop() || "").toUpperCase(); if (tk) listings.set(tk, { id: d.id, tk, name: String(meta.name || "") });
  }

  const snap: NgxSnapshot = { type: "ngx", asOf: upd, at: { ...(prevSnap.at ?? {}) }, src: { ...(prevSnap.src ?? {}) }, ...pickSections(prevSnap) };
  const news: (NewsDoc & { id: string })[] = []; const events: (CalDoc & { id: string })[] = [];
  const fetchedDivTks = new Set<string>(); let electionsAnswered = false;
  const want = (id: AfricaSourceId) => !opts.only || opts.only.includes(id);
  const run = async (id: AfricaSourceId, fn: () => Promise<{ n: number; src?: string }>) => {
    if (!want(id)) return;
    if (!NEEDS[id].some(has)) { report.sources[id] = { n: 0, skipped: `${NEEDS[id].join(" or ")} not set` }; return; }
    try { report.sources[id] = await fn(); } catch (e) { report.sources[id] = { n: 0, error: errText(e) }; }
  };
  const setSection = <K extends keyof NgxSnapshot>(k: K, v: NgxSnapshot[K], src: string) => { snap[k] = v; snap.at[k as string] = upd; snap.src[k as string] = src; report.snapshot.sections.push(k as string); };
  // Try each provider in turn; the first one that answers with data wins.
  const firstOf = async <T>(tries: [string, string, () => Promise<T | null>][]): Promise<{ v: T; src: string } | null> => {
    const errs: string[] = [];
    for (const [env, src, fn] of tries) { if (!has(env)) continue; try { const v = await fn(); if (v && (!Array.isArray(v) || v.length)) return { v, src }; errs.push(`${src}: no data`); } catch (e) { errs.push(`${src}: ${errText(e)}`); } }
    if (errs.length) throw new Error(errs.join("; "));
    return null;
  };

  // Full NGX list (for most active and as a fallback for movers), fetched once.
  let full: { rows: Mover[]; src: string } | null | undefined;
  const fullList = async () => {
    if (full !== undefined) return full;
    const r = await firstOf<Mover[]>([
      ["NGX_PULSE_API_KEY", "NGX Pulse", async () => readMovers(await createNgxPulse().stocks(), 1000)],
      ["MANSA_API_KEY", "Mansa API", async () => readMovers(await createMansa().stocks("nigeria", { limit: 500 }), 1000)],
      ["MYSTOCKS_AFRICA_API_KEY", "MyStocks Africa", async () => readMovers(await createMyStocksAfrica().stocks({ exchange: "NGX", limit: 500 }), 1000)],
    ]).catch(() => null);
    full = r ? { rows: r.v, src: r.src } : null; return full;
  };

  await run("ngx-market", async () => {
    const r = await firstOf<NgxMarket>([
      ["NGX_PULSE_API_KEY", "NGX Pulse", async () => { const p = createNgxPulse(); const [m, s] = await Promise.all([p.market(), soft(p.marketStatus())]); return readMarket(m, s, "NGX Pulse"); }],
      ["MANSA_API_KEY", "Mansa API", async () => readMarket(await createMansa().exchange("nigeria"), null, "Mansa API")],
    ]);
    if (!r) return { n: 0 };
    // Breadth from the full list when the summary lacks it.
    if (r.v.adv === null && r.v.dec === null) { const f = await fullList(); const ch = f?.rows.filter((x) => x.chp !== null) ?? []; if (ch.length >= 3) { r.v.adv = ch.filter((x) => x.chp! > 0).length; r.v.dec = ch.filter((x) => x.chp! < 0).length; r.v.unch = ch.filter((x) => x.chp === 0).length; } }
    setSection("market", r.v, r.src); return { n: 1, src: r.src };
  });

  await run("ngx-movers", async () => {
    let src = "Mansa API"; let g: Mover[] = [], l: Mover[] = [];
    if (has("MANSA_API_KEY")) {
      try { const m = createMansa(); const [a, b] = await Promise.all([m.movers("nigeria", { type: "gainers", limit: 10 }), m.movers("nigeria", { type: "losers", limit: 10 })]); g = readMovers(a, 10).filter((x) => x.chp !== null); l = readMovers(b, 10).filter((x) => x.chp !== null); }
      catch (e) { if (!has("NGX_PULSE_API_KEY") && !has("MYSTOCKS_AFRICA_API_KEY")) throw e; }
    }
    const f = await fullList();
    if ((!g.length || !l.length) && f) { const ch = f.rows.filter((x) => x.chp !== null).sort((a, b) => b.chp! - a.chp!); if (ch.length >= 10) { g = ch.filter((x) => x.chp! > 0).slice(0, 10); l = ch.filter((x) => x.chp! < 0).slice(-10).reverse(); src = f.src; } }
    if (g.length || l.length) { setSection("gainers", g, src); setSection("losers", l, src); }
    if (f) { const act = f.rows.filter((x) => x.vol).sort((a, b) => b.vol! - a.vol!).slice(0, 10); if (act.length) setSection("active", act, f.src); }
    return { n: g.length + l.length, src };
  });

  await run("pan-african", async () => { const rows = readMovers(await createMansa().panAfricanMovers(10), 20); if (rows.length) setSection("pan", rows, "Mansa API"); return { n: rows.length, src: "Mansa API" }; });
  await run("etfs", async () => { const rows = readMovers(await createMansa().etfs("nigeria"), 50); if (rows.length) setSection("etfs", rows, "Mansa API"); return { n: rows.length, src: "Mansa API" }; });
  await run("nasd", async () => { const rows = readMovers(await createNgxPulse().nasdStocks(), 150); if (rows.length) setSection("nasd", rows, "NGX Pulse"); return { n: rows.length, src: "NGX Pulse" }; });
  await run("intel", async () => { const v = readIntel(await createMyStocksAfrica().marketIntel({ exchange: "NGX" })); if (v) setSection("intel", v, "MyStocks Africa"); return { n: v ? v.text.length + v.sectors.length : 0, src: "MyStocks Africa" }; });

  // Disclosures from every configured source, merged (one item per date and title).
  await run("disclosures", async () => {
    const since = isoDay(nowMs - 90 * DAY); const seen = new Set<string>(); const errs: string[] = []; const srcs: string[] = []; let n = 0;
    const tries: [string, string, () => Promise<unknown>][] = [["NGX_PULSE_API_KEY", "NGX Pulse", () => createNgxPulse().disclosures()], ["MANSA_API_KEY", "Mansa API", () => createMansa().disclosures("nigeria", { limit: 100 })]];
    for (const [env, name, fn] of tries) {
      if (!has(env)) continue;
      try {
        const rows = firstRows(await fn()); let k = 0;
        for (const r of rows) { const d = readDisclosure(r, listings, name, upd); if (!d || d.date < since || d.date > today || seen.has(d.id)) continue; seen.add(d.id); news.push(d); k++; }
        n += k; srcs.push(`${name} ${k}`);
      } catch (e) { errs.push(`${name}: ${errText(e)}`); }
    }
    if (!srcs.length && errs.length) throw new Error(errs.join("; "));
    return { n, src: srcs.join(", ") + (errs.length ? ` (failed: ${errs.join("; ")})` : "") };
  });

  // Rotation over the listings for per-company calls. Without data-desk listings, the most traded NGX stocks are used (not linked to a security page).
  const perCo = new Map(listings);
  if (!perCo.size && (want("company-news") || want("dividends"))) {
    const f = await fullList();
    for (const x of (f?.rows ?? []).filter((r) => r.tk).sort((a, b) => (b.val ?? b.vol ?? 0) - (a.val ?? a.vol ?? 0)).slice(0, 60)) perCo.set(x.tk, { id: "", tk: x.tk, name: x.name });
  }
  const tks = [...perCo.keys()].sort();
  const rotate = (key: string, budget: number) => { if (!tks.length || !budget) return [] as string[]; const start = (state[key] ?? 0) % tks.length; const out = Array.from({ length: Math.min(budget, tks.length) }, (_, i) => tks[(start + i) % tks.length]); state[key] = (start + out.length) % tks.length; return out; };

  await run("company-news", async () => {
    const batch = rotate("newsCursor", opts.newsBudget ?? intEnv("AFRICA_NEWS_BUDGET", 10)); if (!batch.length) return { n: 0, src: "no NGX listings found" };
    const m = createMyStocksAfrica(); const since = isoDay(nowMs - 30 * DAY); let n = 0; const errs: string[] = [];
    for (const tk of batch) {
      try { const items = firstRows(await m.news(tk)).map((r) => readNews(r, perCo.get(tk)!, upd)).filter((x): x is NewsDoc & { id: string } => !!x && x.date >= since && x.date <= today).slice(0, 5); news.push(...items); n += items.length; }
      catch (e) { errs.push(`${tk}: ${errText(e)}`); if (errs.length >= 3 && !n) throw new Error(errs.join("; ")); }
    }
    return { n, src: `MyStocks Africa, ${batch.length} listings${errs.length ? `; failed ${errs.length}` : ""}` };
  });

  await run("dividends", async () => {
    const batch = rotate("divCursor", opts.divBudget ?? intEnv("AFRICA_DIV_BUDGET", 15)); if (!batch.length) return { n: 0, src: "no NGX listings found" };
    const m = createMansa(); const from = isoDay(nowMs - 60 * DAY); let n = 0; const errs: string[] = [];
    for (const tk of batch) {
      try { const ev = readDividends(await m.dividends("nigeria", tk), perCo.get(tk)!, upd, from); events.push(...ev); n += ev.length; fetchedDivTks.add(tk); }
      catch (e) { if ((e as { status?: number }).status === 404) { fetchedDivTks.add(tk); continue; } errs.push(`${tk}: ${errText(e)}`); if (errs.length >= 3 && !fetchedDivTks.size) throw new Error(errs.join("; ")); }
    }
    return { n, src: `Mansa API, ${batch.length} listings${errs.length ? `; failed ${errs.length}` : ""}` };
  });

  await run("elections", async () => {
    const until = isoDay(nowMs + 730 * DAY); const seen = new Set<string>(); let n = 0;
    for (const r of firstRows(await createAfricaApi().upcomingElections(100))) { const e = readElection(r, today, until, upd); if (e && !seen.has(e.id)) { seen.add(e.id); events.push(e); n++; } }
    electionsAnswered = true; return { n, src: "Africa API" };
  });

  // --- write: news and events (owner documents are left alone) ---
  const admNews = new Map((await store.list("adm_news")).map((d) => [d.id, d.data]));
  const newsWrites: Doc[] = news.filter((x) => { const cur = admNews.get(x.id); return !cur || (cur.gen === GEN && (cur.title !== x.title || cur.url !== x.url || JSON.stringify(cur.ids) !== JSON.stringify(x.ids) || cur.sum !== x.sum)); })
    .map(({ id, ...data }) => ({ id, data }));
  const keepNews = (id: string, date: string) => (id.startsWith("auto-msn-") ? date >= isoDay(nowMs - 30 * DAY) : date >= isoDay(nowMs - 120 * DAY));
  const newsRemove = [...admNews].filter(([id, x]) => x.gen === GEN && !keepNews(id, String(x.date ?? ""))).map(([id]) => id);

  const admCal = new Map((await store.list("adm_cal")).map((d) => [d.id, d.data]));
  const fresh = new Set(events.map((e) => e.id));
  const calWrites: Doc[] = events.filter((e) => { const cur = admCal.get(e.id); return !cur || (cur.gen === GEN && (cur.title !== e.title || cur.notes !== e.notes || cur.actual !== e.actual || cur.imp !== e.imp)); })
    .map(({ id, ...data }) => ({ id, data }));
  const cutoff = isoDay(nowMs - 60 * DAY);
  const calRemove = [...admCal].filter(([id, x]) => {
    if (x.gen !== GEN || fresh.has(id)) return false; const date = String(x.date ?? "");
    if (date < cutoff) return true;
    if (date < today) return false;
    // An upcoming event the source no longer lists (rescheduled or cancelled), but only when that source answered for it.
    if (id.startsWith("auto-elec-")) return electionsAnswered;
    const m = /^auto-ngxdiv-([^-]+)-/.exec(id); return !!m && fetchedDivTks.has(m[1]);
  }).map(([id]) => id);
  report.news = { written: newsWrites.length, removed: newsRemove.length }; report.events = { written: calWrites.length, removed: calRemove.length };

  const ok = Object.values(report.sources).filter((s) => !s.error && !s.skipped); const failed = Object.entries(report.sources).filter(([, s]) => s.error).map(([k]) => k);
  const disc = report.sources.disclosures?.n ?? 0, cn = report.sources["company-news"]?.n ?? 0, div = report.sources.dividends?.n ?? 0, el = report.sources.elections?.n ?? 0;
  report.note = `African markets sync ${today}: ${ok.length} of ${Object.keys(report.sources).length} sources answered; NGX snapshot ${report.snapshot.sections.length ? `(${report.snapshot.sections.join(", ")})` : "unchanged"}; ${disc} disclosures, ${cn} company news items, ${div} dividend dates, ${el} elections; ${newsWrites.length} news and ${calWrites.length} events written.${failed.length ? ` Failed: ${failed.join(", ")}.` : ""}`;
  const n = report.snapshot.sections.length + disc + cn + div + el;
  if (!opts.dryRun) {
    if (report.snapshot.sections.length) await store.upsert(COL, [{ id: "ngx", data: snap as unknown as Record<string, unknown> }]);
    if (newsWrites.length) await store.upsert("adm_news", newsWrites);
    if (newsRemove.length) await store.remove("adm_news", newsRemove);
    if (calWrites.length) await store.upsert("adm_cal", calWrites);
    if (calRemove.length) await store.remove("adm_cal", calRemove);
    await store.upsert(COL, [{ id: "_meta", data: { type: "meta", checked: upd, n, note: report.note, sources: report.sources, state } }]);
  }
  return report;
}

const SECTIONS = ["market", "gainers", "losers", "active", "pan", "etfs", "nasd", "intel"] as const;
function pickSections(p: Partial<NgxSnapshot>): Partial<NgxSnapshot> { const o: Partial<NgxSnapshot> = {}; for (const k of SECTIONS) if (p[k] !== undefined) (o as Record<string, unknown>)[k] = p[k]; return o; }
