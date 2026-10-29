/**
 * Market sync: pulls end-of-day prices from the configured data providers and
 * writes them where the app's Provider layer already reads real data:
 *
 *   mkt/d-<run date>     { type: "day",  q: { <id>: [close, change, obsDate, src, note?] } }
 *   mkt/_meta            { type: "meta", checked, n, note }                   last-run summary
 *   mkt/_hist            { type: "histidx", ids: { <id>: <last date> } }     which instruments have history
 *   mkthist/<id>         { type: "hist", id, parts: { <src>: { t0, c, dd, checked } } }   daily history
 *
 * Browsers load `mkt` (small) up front and an instrument's `mkthist` doc only
 * when its series is first needed. History docs from earlier versions
 * (mkt/h-<id>@<src>, mkt/h-<id>) are moved to `mkthist` on the next run.
 *   adm_inst/AD.NG.<TK>  NGX listings kept by the data desk (d/c arrays)
 *
 * In the browser, liveBuild() splices these onto the simulated series and the
 * UI labels them REAL with their source. Anything not resolved stays SIM.
 *
 * Day docs older than `keepDayDocs` days are folded into the history docs, so
 * the number of documents every client loads stays bounded.
 */
import "server-only";
import { envKey } from "@/lib/providers/http";
import { scrub } from "@/lib/providers";
import { INSTRUMENT_SOURCES, NGX_SOURCES, SOURCE_LABELS, dxy, type ProviderId, type Source } from "./instruments";
import {
  africanSources, alphaVantageLatest, eodhdHistory, eodhdLatest, exchangeRateLatest, fmpHistory, fmpLatest,
  fredSeries, marketstackHistory, marketstackLatest, type AfricanRow, type Obs, type Point,
} from "./sources";
import { openStore, type Doc, type DocStore } from "./store";

const DAY = 864e5;
const ENVS: Record<ProviderId, string> = {
  eodhd: "EODHD_API_KEY", fmp: "FMP_API_KEY", marketstack: "MARKETSTACK_API_KEY", alphavantage: "ALPHAVANTAGE_API_KEY",
  fred: "FRED_API_KEY", exchangerate: "EXCHANGERATE_API_KEY", ngxpulse: "NGX_PULSE_API_KEY", mansa: "MANSA_API_KEY",
  mystocks: "MYSTOCKS_AFRICA_API_KEY", africa: "AFRICA_API_KEY",
};
const HIST_FETCH: Partial<Record<ProviderId, (s: string, from: string) => Promise<Point[]>>> = { eodhd: eodhdHistory, fmp: fmpHistory, marketstack: marketstackHistory };

export type SyncOptions = {
  store?: DocStore;
  /** Fetch and report, but write nothing. */
  dryRun?: boolean;
  now?: Date;
  /** Limit the run to these instrument ids (e.g. ["EQ.AAPL", "FX.USDNGN"]). NGX listings use "NGX". */
  only?: string[];
  /** Days of daily history kept per instrument. Default MARKET_HISTORY_DAYS or 400. */
  historyDays?: number;
  /** Max history backfills per run from metered providers (EODHD, FMP, Marketstack). Default MARKET_HISTORY_BUDGET or 25. */
  historyBudget?: number;
  /** Max Alpha Vantage calls per run (free keys allow 25 a day). Default MARKET_ALPHAVANTAGE_BUDGET or 20. */
  alphaVantageBudget?: number;
  /** Day docs younger than this many days are kept as they are. Default 35. */
  keepDayDocs?: number;
  /** Override which providers count as configured (tests). Default: those whose key is set. */
  providers?: ProviderId[];
};

export type SyncReport = {
  date: string;
  dryRun: boolean;
  store: string;
  configured: ProviderId[];
  resolved: number;
  bySource: Record<string, number>;
  unresolved: string[];
  providers: Record<string, { requested: number; resolved: number; error?: string }>;
  history: { written: string[]; pending: number };
  ngx: { source?: ProviderId; updated: number; asi?: number; error?: string };
  compacted: string[];
  note: string;
};

type Hit = { id: string; p: ProviderId; s: string; obs: Obs; note?: string; points?: Point[] };

const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const intEnv = (k: string, d: number) => { const n = Number(process.env[k]); return Number.isFinite(n) && n >= 0 ? n : d; };
const round = (v: number) => Number(v.toPrecision(8));
const fredKey = (s: Source) => (s.p === "fred" ? JSON.stringify(s.s) : String(s.s));

/** Last weekday on or before `now` in Lagos (UTC+1), for NGX rows without a date. */
function lagosTradingDay(now: Date) {
  let t = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + (now.getUTCHours() >= 23 ? DAY : 0);
  while ([0, 6].includes(new Date(t).getUTCDay())) t -= DAY;
  return iso(t);
}

// --- history doc encoding (same as the app's `hist` docs) ---------------------------
export function decodeHist(x: Record<string, unknown>): Point[] {
  const c = Array.isArray(x.c) ? x.c : []; const dd = Array.isArray(x.dd) ? x.dd : []; let t = Date.parse(String(x.t0));
  if (!Number.isFinite(t)) return [];
  return c.flatMap((v, i) => { if (i) t += (Number(dd[i - 1]) || 1) * DAY; const n = Number(v); return Number.isFinite(n) ? [{ t: iso(t), c: n }] : []; });
}
export function encodeHist(id: string, src: string, points: Point[], checked: string) {
  const ts = points.map((p) => Date.parse(p.t));
  return { type: "hist", id, src, checked, t0: points[0].t, c: points.map((p) => round(p.c)), dd: ts.slice(1).map((t, i) => Math.round((t - ts[i]) / DAY)) };
}
/** Merges point lists (later lists win on the same date), sorts, and keeps the last `days`. */
function mergePoints(days: number, now: number, ...lists: Point[][]) {
  const m = new Map<string, number>(); for (const l of lists) for (const p of l) m.set(p.t, p.c);
  const from = iso(now - days * DAY);
  return [...m].filter(([t]) => t >= from).sort(([a], [b]) => (a < b ? -1 : 1)).map(([t, c]) => ({ t, c }));
}

export async function runMarketSync(opts: SyncOptions = {}): Promise<SyncReport> {
  const now = opts.now ?? new Date(); const nowMs = now.getTime(); const checked = now.toISOString(); const runDay = iso(nowMs);
  const historyDays = opts.historyDays ?? intEnv("MARKET_HISTORY_DAYS", 400);
  const historyBudget = opts.historyBudget ?? intEnv("MARKET_HISTORY_BUDGET", 25);
  const avBudget = opts.alphaVantageBudget ?? intEnv("MARKET_ALPHAVANTAGE_BUDGET", 20);
  const keepDayDocs = opts.keepDayDocs ?? 35;
  const histFrom = iso(nowMs - historyDays * DAY), recentFrom = iso(nowMs - 45 * DAY);
  const configured = (opts.providers ?? (Object.keys(ENVS) as ProviderId[]).filter((p) => envKey(ENVS[p]))).filter((p) => p in ENVS);
  const on = new Set(configured);
  const store = opts.store ?? openStore();

  const mkt = new Map((await store.list("mkt")).map((d) => [d.id, d.data]));
  const histId = (id: string, src: string) => `h-${id}@${src}`;
  // History by source, keyed h-<id>@<src>: from mkthist, plus legacy docs still in mkt (moved on write).
  const hist = new Map<string, Record<string, unknown>>();
  const histDocsById = new Map<string, Record<string, unknown>>();
  for (const d of await store.list("mkthist")) {
    histDocsById.set(d.id, d.data);
    for (const [src, part] of Object.entries((d.data.parts ?? {}) as Record<string, Record<string, unknown>>)) hist.set(histId(d.id, src), { type: "hist", id: d.id, src, ...part });
  }
  const legacyHist = [...mkt].filter(([id, x]) => id.startsWith("h-") && (x as { type?: string }).type === "hist");
  for (const [, x] of legacyHist) { const k = histId(String(x.id), String(x.src ?? "web")); if (!hist.has(k)) hist.set(k, x as Record<string, unknown>); }
  const histAge = (docId: string) => { const x = hist.get(docId); return x ? nowMs - (Date.parse(String(x.checked)) || 0) : Infinity; };

  const providers: SyncReport["providers"] = {};
  const stat = (p: string) => (providers[p] ??= { requested: 0, resolved: 0 });
  const fail = (p: string, e: unknown) => { stat(p).error = scrub(String((e as Error)?.message ?? e)).slice(0, 300); };

  // --- 1. latest values, trying each instrument's sources in order -------------------
  // FX.DXY (computed) and IX.NGSEINDX (African sources) have no entry in the source map.
  const ids = [...Object.keys(INSTRUMENT_SOURCES), "FX.DXY", "IX.NGSEINDX"].filter((id) => !opts.only || opts.only.includes(id));
  const cands = new Map(ids.map((id) => [id, (INSTRUMENT_SOURCES[id] ?? []).filter((s) => on.has(s.p))]));
  const hits = new Map<string, Hit>();
  for (let round = 0; ; round++) {
    const byP = new Map<ProviderId, { id: string; src: Source }[]>();
    for (const id of ids) { if (hits.has(id)) continue; const src = cands.get(id)![round]; if (src) { if (!byP.has(src.p)) byP.set(src.p, []); byP.get(src.p)!.push({ id, src }); } }
    if (!byP.size) break;
    await Promise.all([...byP].map(async ([p, list]) => {
      stat(p).requested += list.length;
      const take = (got: Map<string, Obs>) => { for (const { id, src } of list) { const o = got.get(String(src.s)); if (o) { hits.set(id, { id, p, s: String(src.s), obs: o, note: src.note }); stat(p).resolved++; } } };
      try {
        const syms = [...new Set(list.map((x) => String(x.src.s)))];
        if (p === "eodhd") take(await eodhdLatest(syms));
        else if (p === "fmp") take(await fmpLatest(syms));
        else if (p === "marketstack") take(await marketstackLatest(syms));
        else if (p === "exchangerate") take(await exchangeRateLatest(syms));
        else if (p === "alphavantage") take(await alphaVantageLatest(syms, avBudget));
        else if (p === "fred") {
          // One request per series; full history when the stored copy is missing or a week old.
          const errs: string[] = [];
          await Promise.all(list.map(async ({ id, src }) => {
            if (src.p !== "fred") return;
            const full = histAge(histId(id, "fred")) > 7 * DAY;
            try {
              const pts = await fredSeries(src.s, full ? histFrom : recentFrom); const last = pts.at(-1);
              if (last) { hits.set(id, { id, p, s: fredKey(src), obs: { t: last.t, c: last.c, ch: null }, note: src.note, points: full ? pts : undefined }); stat(p).resolved++; }
            } catch (e) { errs.push(`${src.s.series}: ${(e as Error).message}`); }
          }));
          if (errs.length) fail(p, `${errs.length} series failed, e.g. ${errs[0]}`);
        }
      } catch (e) { fail(p, e); }
    }));
  }

  // --- 2. U.S. Dollar Index from its six components ------------------------------------
  if (ids.includes("FX.DXY") && !hits.has("FX.DXY")) {
    const r = (pair: string) => hits.get(`FX.${pair}`)?.obs.c;
    const v = dxy({ EURUSD: r("EURUSD"), USDJPY: r("USDJPY"), GBPUSD: r("GBPUSD"), USDCAD: r("USDCAD"), USDSEK: r("USDSEK"), USDCHF: r("USDCHF") });
    const base = hits.get("FX.EURUSD");
    if (v && base) hits.set("FX.DXY", { id: "FX.DXY", p: base.p, s: "calc", obs: { t: base.obs.t, c: v, ch: null }, note: "computed from EUR, JPY, GBP, CAD, SEK, CHF (ICE weights)" });
  }

  // --- 3. NGX: All-Share index and the data desk's NGX listings ------------------------
  const ngx: SyncReport["ngx"] = { updated: 0 };
  const wantNgx = !opts.only || opts.only.includes("NGX") || opts.only.includes("IX.NGSEINDX");
  let ngxRows: Map<string, AfricanRow> | null = null;
  if (wantNgx) {
    const ngxDay = lagosTradingDay(now);
    for (const p of NGX_SOURCES.filter((x) => on.has(x))) {
      const src = africanSources[p as keyof typeof africanSources];
      try {
        if (!hits.has("IX.NGSEINDX") && ids.includes("IX.NGSEINDX")) {
          const asi = await src.asi().catch(() => null);
          if (asi) { hits.set("IX.NGSEINDX", { id: "IX.NGSEINDX", p, s: "ASI", obs: { t: ngxDay, c: asi, ch: null } }); ngx.asi = asi; }
        }
        if (!ngxRows && (!opts.only || opts.only.includes("NGX"))) {
          stat(p).requested += 1; const rows = await src.stocks();
          if (rows.length >= 5) { ngxRows = new Map(rows.map((r) => [r.symbol, { ...r, t: r.t ?? ngxDay }])); ngx.source = p; stat(p).resolved += rows.length; }
        }
      } catch (e) { fail(p, e); ngx.error = providers[p].error; }
      if (ngxRows && hits.has("IX.NGSEINDX")) break;
    }
  }

  // --- 4. history backfill -------------------------------------------------------------
  const histDocs: Doc[] = [];
  for (const h of hits.values()) if (h.points?.length) histDocs.push({ id: histId(h.id, h.p), data: encodeHist(h.id, h.p, mergePoints(historyDays, nowMs, h.points), checked) });
  const need = [...hits.values()].filter((h) => HIST_FETCH[h.p] && h.s !== "calc" && !hist.has(histId(h.id, h.p)));
  const batch = need.slice(0, historyBudget);
  await Promise.all(chunked(batch, 3).map(async (group) => {
    for (const h of group) {
      try { const pts = await HIST_FETCH[h.p]!(h.s, histFrom); if (pts.length) histDocs.push({ id: histId(h.id, h.p), data: encodeHist(h.id, h.p, mergePoints(historyDays, nowMs, pts), checked) }); }
      catch (e) { fail(h.p, e); }
    }
  }));

  // --- 5. today's day doc --------------------------------------------------------------
  const dayId = `d-${runDay}`; const prev = (mkt.get(dayId) ?? {}) as { q?: Record<string, unknown> };
  const q: Record<string, unknown[]> = { ...(prev.q as Record<string, unknown[]> | undefined) };
  for (const h of hits.values()) { const r: unknown[] = [round(h.obs.c), h.obs.ch === null ? null : round(h.obs.ch), h.obs.t, h.p]; if (h.note) r.push(h.note); q[h.id] = r; }

  // --- 6. fold old day docs into history docs ------------------------------------------
  const cutoff = iso(nowMs - keepDayDocs * DAY); const compacted: string[] = []; const folded = new Map<string, Point[]>();
  for (const [id, x] of mkt) {
    const m = /^d-(\d{4}-\d{2}-\d{2})$/.exec(id); if (!m || m[1] >= cutoff || (x as { type?: string }).type !== "day") continue;
    for (const [k, r] of Object.entries(((x as { q?: Record<string, unknown> }).q ?? {}) as Record<string, unknown[]>)) {
      if (!Array.isArray(r)) continue; const c = Number(r[0]); const t = String(r[2] ?? m[1]).slice(0, 10); const s = String(r[3] ?? "web");
      if (!Number.isFinite(c) || !/^\d{4}-\d{2}-\d{2}$/.test(t)) continue;
      const key = histId(k, s); if (!folded.has(key)) folded.set(key, []); folded.get(key)!.push({ t, c });
    }
    compacted.push(id);
  }
  for (const [docId, pts] of folded) {
    const [, k, s] = /^h-(.+)@([^@]+)$/.exec(docId)!;
    const fresh = histDocs.find((d) => d.id === docId); const old = fresh?.data ?? hist.get(docId);
    const merged = mergePoints(historyDays, nowMs, pts, old ? decodeHist(old) : []);
    if (!merged.length) continue;
    const doc = { id: docId, data: encodeHist(k, s, merged, checked) };
    if (fresh) fresh.data = doc.data; else histDocs.push(doc);
  }

  // --- 7. NGX desk listings --------------------------------------------------------------
  const admWrites: Doc[] = []; const admDeletes: string[] = [];
  if (ngxRows && ngx.source) {
    const adm = await store.list("adm_inst");
    const parts = new Map<string, Doc[]>(); for (const d of adm) { const of = d.data.of; if (typeof of === "string") { if (!parts.has(of)) parts.set(of, []); parts.get(of)!.push(d); } }
    const label = SOURCE_LABELS[ngx.source][0];
    for (const d of adm) {
      const x = d.data as Record<string, unknown> & { meta?: Record<string, unknown> };
      if (x.of || !(d.id.startsWith("AD.NG.") || x.meta?.exch === "NGX")) continue;
      const tk = String(x.meta?.tk ?? d.id.split(".").pop()).toUpperCase(); const row = ngxRows.get(tk); if (!row?.t) continue;
      const fields = (Array.isArray(x.arr) ? x.arr : ["d", "c"]) as string[];
      const ps = (parts.get(d.id) ?? []).filter((p) => p.data.gen === x.gen).sort((a, b) => Number(a.data.p) - Number(b.data.p));
      const cols: Record<string, unknown[]> = Object.fromEntries(fields.map((f) => [f, [...((x[f] as unknown[]) ?? []), ...ps.flatMap((p) => (p.data[f] as unknown[]) ?? [])]]));
      const at = (cols.d as string[]).indexOf(row.t);
      if (at >= 0) { if (Number(cols.c[at]) === row.c) continue; cols.c[at] = row.c; }
      else { for (const f of fields) cols[f].push(f === "d" ? row.t : f === "c" ? row.c : null); }
      const order = (cols.d as string[]).map((_, i) => i).sort((a, b) => ((cols.d[a] as string) < (cols.d[b] as string) ? -1 : 1));
      for (const f of fields) cols[f] = order.map((i) => cols[f][i]);
      const src0 = String(x.src ?? "");
      const src = src0.includes(label) ? src0 : `NGX close via ${label} API from ${row.t}${src0 ? `; earlier: ${src0}` : ""}`;
      admWrites.push({ id: d.id, data: { ...x, ...cols, arr: fields, gen: `sync-${nowMs.toString(36)}`, parts: 1, n: cols.d.length, src, upd: checked } });
      admDeletes.push(...(parts.get(d.id) ?? []).map((p) => p.id));
      ngx.updated++;
    }
  }

  // --- 8. report and write -----------------------------------------------------------------
  const bySource: Record<string, number> = {}; for (const h of hits.values()) bySource[h.p] = (bySource[h.p] ?? 0) + 1;
  const unresolved = ids.filter((id) => !hits.has(id));
  const written = histDocs.map((d) => d.id);
  const parts2 = Object.entries(bySource).sort((a, b) => b[1] - a[1]).map(([p, n]) => `${SOURCE_LABELS[p as ProviderId]?.[0] ?? p} ${n}`);
  const note = `API sync ${runDay}: ${hits.size} instruments (${parts2.join(", ") || "none"})` +
    (ngx.updated ? `; ${ngx.updated} NGX listings via ${SOURCE_LABELS[ngx.source!][0]}` : "") +
    (written.length ? `; history written for ${written.length}` : "") + (need.length > batch.length ? ` (${need.length - batch.length} more queued for later runs)` : "") +
    (compacted.length ? `; ${compacted.length} old day docs folded into history` : "") +
    (unresolved.length ? `; still simulated: ${unresolved.length}` : "") + ".";

  const report: SyncReport = {
    date: runDay, dryRun: !!opts.dryRun, store: store.kind, configured, resolved: hits.size, bySource, unresolved, providers,
    history: { written, pending: Math.max(0, need.length - batch.length) }, ngx, compacted, note,
  };
  if (opts.dryRun || (!hits.size && !ngx.updated && !compacted.length && !legacyHist.length)) return report;

  // History: one mkthist doc per instrument holding every source's series.
  for (const d of histDocs) hist.set(d.id, d.data);
  const touched = new Set([...histDocs.map((d) => String(d.data.id)), ...legacyHist.map(([, x]) => String(x.id))]);
  const histWrites: Doc[] = [...touched].map((id) => {
    const parts: Record<string, unknown> = { ...((histDocsById.get(id)?.parts ?? {}) as Record<string, unknown>) };
    for (const [k, x] of hist) if (String(x.id) === id) { const { type: _t, id: _i, src, ...part } = x; void _t; void _i; parts[String(src ?? k.split("@").pop())] = part; }
    return { id, data: { type: "hist", id, checked, parts } };
  });
  if (histWrites.length) await store.upsert("mkthist", histWrites);
  // Index of instruments with history and their last date, loaded by every browser with mkt.
  const idx: Record<string, string> = {};
  for (const x of hist.values()) { const pts = decodeHist(x); const last = pts.at(-1)?.t; const id = String(x.id); if (last && (!idx[id] || last > idx[id])) idx[id] = last; }
  await store.upsert("mkt", [{ id: "_hist", data: { type: "histidx", checked, ids: idx } }]);
  if (legacyHist.length) await store.remove("mkt", legacyHist.map(([id]) => id));
  if (admWrites.length) { await store.upsert("adm_inst", admWrites); await store.remove("adm_inst", admDeletes); }
  if (hits.size) await store.upsert("mkt", [{ id: dayId, data: { type: "day", date: runDay, checked, q } }]);
  await store.upsert("mkt", [{ id: "_meta", data: { type: "meta", checked, n: Object.keys(q).length, resolved: hits.size, note } }]);
  await store.remove("mkt", compacted.filter((id) => id !== dayId));
  return report;
}

function chunked<T>(a: T[], n: number): T[][] {
  const out: T[][] = Array.from({ length: n }, () => []); a.forEach((x, i) => out[i % n].push(x)); return out.filter((x) => x.length);
}
