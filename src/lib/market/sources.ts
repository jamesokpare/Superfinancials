/**
 * Thin adapters from each provider client to two shapes the sync needs:
 *   latest(symbols)  -> Map<symbol, Obs>   (one batch call where the API allows it)
 *   history(symbol)  -> Point[]            (daily closes since a date)
 * Dates are ISO days (YYYY-MM-DD). Values that are missing or not finite are dropped.
 */
import { createAfricaApi } from "@/lib/providers/africa-api";
import { createAlphaVantage } from "@/lib/providers/alphavantage";
import { createEodhd } from "@/lib/providers/eodhd";
import { createExchangeRate } from "@/lib/providers/exchangerate";
import { createFmp } from "@/lib/providers/fmp";
import { createFred, type FredObservations } from "@/lib/providers/fred";
import { createMansa } from "@/lib/providers/mansa";
import { createMarketstack } from "@/lib/providers/marketstack";
import { createMyStocksAfrica } from "@/lib/providers/mystocks-africa";
import { createNgxPulse } from "@/lib/providers/ngx-pulse";
import type { FredSpec } from "./instruments";

/** A day's open, high, low and volume, when the provider gives them (any may be null). */
export type Bar = { o: number | null; h: number | null; l: number | null; v: number | null };
/** One observation. `ch` is the change from the previous close when the provider gives it; `x` the day's range and volume. */
export type Obs = { t: string; c: number; ch: number | null; x?: Bar };
export type Point = { t: string; c: number } & Partial<Bar>;

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "" || v === "NA") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};
const day = (v: unknown): string | null => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number" || /^\d{9,13}$/.test(String(v))) {
    const n = Number(v); const ms = n < 1e11 ? n * 1000 : n;
    return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : null;
  }
  const s = String(v); if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const t = Date.parse(s); return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
};
/** A Bar, or undefined when the provider gave none of the four. Zero volume (indices, FX) counts as none. */
export function bar(o: unknown, h: unknown, l: unknown, v: unknown): Bar | undefined {
  const pos = (x: unknown) => { const n = num(x); return n !== null && n > 0 ? n : null; };
  const b = { o: num(o), h: num(h), l: num(l), v: pos(v) };
  return b.o === null && b.h === null && b.l === null && b.v === null ? undefined : b;
}
/** A daily row on the adjusted-close basis: open, high and low scaled by adjusted ÷ raw close, volume by its inverse (splits). */
function adjBar(c: number, raw: number | null, o: unknown, h: unknown, l: unknown, v: unknown): Partial<Bar> {
  const b = bar(o, h, l, v); if (!b) return {};
  const k = raw && raw > 0 ? c / raw : 1; const sc = (x: number | null) => (x === null ? null : x * k);
  return { o: sc(b.o), h: sc(b.h), l: sc(b.l), v: b.v === null ? null : Math.round(b.v / k) };
}
const chunk = <T>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
const arr = (x: unknown): Record<string, unknown>[] => (Array.isArray(x) ? x : x && typeof x === "object" ? [x] : []) as Record<string, unknown>[];

/** Runs async jobs with a small concurrency limit. */
async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}

// --- EODHD ---------------------------------------------------------------------
export async function eodhdLatest(symbols: string[]): Promise<Map<string, Obs>> {
  const client = createEodhd(); const out = new Map<string, Obs>();
  for (const group of chunk(symbols, 20)) {
    const [first, ...rest] = group;
    const res = await client.realTime(first, rest.length ? { s: rest.join(",") } : undefined);
    for (const r of arr(res)) {
      const code = String(r.code ?? ""); const c = num(r.close); const t = day(r.timestamp);
      if (!code || c === null || !t) continue;
      const key = group.find((s) => s.toUpperCase() === code.toUpperCase()) ?? code;
      out.set(key, { t, c, ch: num(r.change), x: bar(r.open, r.high, r.low, r.volume) });
    }
  }
  return out;
}
export async function eodhdHistory(symbol: string, from: string): Promise<Point[]> {
  const rows = await createEodhd().eod(symbol, { from, period: "d", order: "a" });
  return arr(rows).flatMap((r) => { const c = num(r.adjusted_close) ?? num(r.close); const t = day(r.date); return c !== null && t ? [{ t, c, ...adjBar(c, num(r.close), r.open, r.high, r.low, r.volume) }] : []; });
}

// --- Financial Modeling Prep ------------------------------------------------------
export async function fmpLatest(symbols: string[]): Promise<Map<string, Obs>> {
  const fmp = createFmp(); const out = new Map<string, Obs>();
  const put = (r: Record<string, unknown>) => { const s = String(r.symbol ?? ""); const c = num(r.price); const t = day(r.timestamp); if (s && c !== null && t) out.set(s, { t, c, ch: num(r.change), x: bar(r.open, r.dayHigh, r.dayLow, r.volume) }); };
  try {
    for (const group of chunk(symbols, 100)) for (const r of arr(await fmp.get("/batch-quote", { symbols: group.join(",") }))) put(r);
  } catch {
    // Batch quotes need a paid plan; fall back to one request per symbol.
    await pool(symbols.filter((s) => !out.has(s)), 4, async (s) => { try { for (const r of arr(await fmp.quote(s))) put(r); } catch { /* reported as unresolved */ } });
  }
  return out;
}
export async function fmpHistory(symbol: string, from: string): Promise<Point[]> {
  const res = await createFmp().historicalEod(symbol, from);
  const rows = Array.isArray(res) ? res : arr((res as { historical?: unknown })?.historical);
  return arr(rows).flatMap((r) => { const c = num(r.adjClose) ?? num(r.close) ?? num(r.price); const t = day(r.date); return c !== null && t ? [{ t, c, ...adjBar(c, num(r.close) ?? c, r.open, r.high, r.low, r.volume) }] : []; }).sort((a, b) => (a.t < b.t ? -1 : 1));
}

// --- Marketstack ---------------------------------------------------------------
export async function marketstackLatest(symbols: string[]): Promise<Map<string, Obs>> {
  const ms = createMarketstack(); const out = new Map<string, Obs>();
  for (const group of chunk(symbols, 100)) {
    const res = await ms.eodLatest(group.join(","));
    for (const r of arr(res.data)) { const s = String(r.symbol ?? ""); const c = num(r.close); const t = day(r.date); if (s && c !== null && t) out.set(s, { t, c, ch: null, x: bar(r.open, r.high, r.low, r.volume) }); }
  }
  return out;
}
export async function marketstackHistory(symbol: string, from: string): Promise<Point[]> {
  const res = await createMarketstack().eod(symbol, { date_from: from, limit: 1000 });
  return arr(res.data).flatMap((r) => {
    const c = num(r.adj_close) ?? num(r.close); const t = day(r.date); if (c === null || !t) return [];
    // Marketstack gives adjusted open/high/low/volume itself when it has them.
    const x = num(r.adj_open) !== null ? { ...bar(r.adj_open, r.adj_high, r.adj_low, r.adj_volume) } : adjBar(c, num(r.close) ?? c, r.open, r.high, r.low, r.volume);
    return [{ t, c, ...x }];
  }).sort((a, b) => (a.t < b.t ? -1 : 1));
}

// --- Alpha Vantage (free keys allow 25 calls a day, so callers pass a budget) ----
const isPair = (s: string) => /^[A-Z]{6}$/.test(s) && /USD/.test(s);
export async function alphaVantageLatest(symbols: string[], budget: number): Promise<Map<string, Obs>> {
  const av = createAlphaVantage(); const out = new Map<string, Obs>();
  for (const s of symbols.slice(0, Math.max(0, budget))) {
    try {
      if (isPair(s) || s === "BTCUSD" || s === "ETHUSD") {
        const r = (await av.fxRate(s.slice(0, 3), s.slice(3)))["Realtime Currency Exchange Rate"] as Record<string, unknown> | undefined;
        const c = num(r?.["5. Exchange Rate"]); const t = day(r?.["6. Last Refreshed"]);
        if (c !== null && t) out.set(s, { t, c, ch: null });
      } else {
        const q = (await av.quote(s))["Global Quote"]; const c = num(q?.["05. price"]); const t = day(q?.["07. latest trading day"]);
        if (c !== null && t) out.set(s, { t, c, ch: num(q?.["09. change"]), x: bar(q?.["02. open"], q?.["03. high"], q?.["04. low"], q?.["06. volume"]) });
      }
    } catch (e) {
      // A rate-limit notice means the rest would fail too.
      if (/rate limit|Thank you for using|premium/i.test((e as Error).message)) break;
    }
  }
  return out;
}

// --- FRED ----------------------------------------------------------------------
const periodEnd = (t: string, p?: "M" | "Q") => {
  if (!p) return t;
  const [y, m] = t.split("-").map(Number); const mm = p === "Q" ? m + 2 : m;
  return new Date(Date.UTC(y, mm, 0)).toISOString().slice(0, 10);
};
export async function fredSeries(spec: FredSpec, from: string): Promise<Point[]> {
  const res = await createFred().get<FredObservations>("/series/observations", {
    series_id: spec.series, observation_start: from, units: spec.units, frequency: spec.frequency, aggregation_method: spec.aggregation,
  });
  return res.observations.flatMap((o) => { const c = num(o.value); return c === null ? [] : [{ t: periodEnd(o.date, spec.period), c }]; });
}

// --- ExchangeRate-API: every pair from one USD-based call ------------------------
export async function exchangeRateLatest(pairs: string[]): Promise<Map<string, Obs>> {
  const r = await createExchangeRate().latest("USD"); const rates = r.conversion_rates; const t = day(r.time_last_update_utc);
  const out = new Map<string, Obs>(); if (!t) return out;
  for (const p of pairs) {
    const base = p.slice(0, 3), quote = p.slice(3);
    const c = base === "USD" ? rates[quote] : quote === "USD" && rates[base] ? 1 / rates[base] : undefined;
    if (c && Number.isFinite(c)) out.set(p, { t, c, ch: null });
  }
  return out;
}

// --- African market sources (NGX) --------------------------------------------------
// The four African APIs return differently named fields, so rows are read by
// trying the common names. A row without a recognisable symbol and price is skipped.
export type AfricanRow = { symbol: string; c: number; ch: number | null; t: string | null; vol?: number | null };
const pick = (r: Record<string, unknown>, keys: string[]) => { for (const k of keys) if (r[k] !== undefined && r[k] !== null && r[k] !== "") return r[k]; return undefined; };
const SYM = ["symbol", "ticker", "code", "stock_code", "security"];
const PRICE = ["current_price", "price", "close", "close_price", "closing_price", "last_price", "last", "lastPrice", "value"];
const CHANGE = ["change", "price_change", "change_amount"];
const VOLUME = ["volume", "traded_volume", "total_volume", "vol", "quantity"];
const DATE = ["date", "trade_date", "trading_date", "as_of", "asOf", "last_updated", "updated_at", "timestamp", "price_date"];

/** Finds the first array of row objects in a response ({ data: [...] }, { stocks: [...] }, [...], ...). */
export function rowsOf(body: unknown, depth = 0): Record<string, unknown>[] {
  if (Array.isArray(body)) return body.filter((x) => x && typeof x === "object") as Record<string, unknown>[];
  if (!body || typeof body !== "object" || depth > 3) return [];
  const o = body as Record<string, unknown>;
  for (const k of ["data", "stocks", "results", "items", "tickers", "equities", "rows"]) { const r = rowsOf(o[k], depth + 1); if (r.length) return r; }
  return [];
}
export function readRow(r: Record<string, unknown>): AfricanRow | null {
  const symbol = String(pick(r, SYM) ?? "").trim().toUpperCase(); const c = num(pick(r, PRICE));
  if (!symbol || c === null || c <= 0) return null;
  const vol = num(pick(r, VOLUME));
  return { symbol, c, ch: num(pick(r, CHANGE)), t: day(pick(r, DATE)), ...(vol !== null && vol > 0 ? { vol: Math.round(vol) } : {}) };
}
/** Depth-first search for a numeric field whose name matches `re` (used for the All-Share index level). */
export function findNumber(body: unknown, re: RegExp, depth = 0): number | null {
  if (!body || typeof body !== "object" || depth > 4) return null;
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (re.test(k)) { const n = num(v); if (n !== null && n > 0) return n; if (v && typeof v === "object") { const inner = num(pick(v as Record<string, unknown>, ["value", "level", "close", "current", "index"])); if (inner !== null && inner > 0) return inner; } }
  }
  for (const v of Object.values(body as Record<string, unknown>)) { const n = findNumber(v, re, depth + 1); if (n !== null) return n; }
  return null;
}
const ASI = /^(asi|ngx_?asi|all_?share(_?index)?|allshare(index)?|ngxasi|ngseindx)$/i;

export const africanSources = {
  ngxpulse: {
    stocks: async () => rowsOf(await createNgxPulse().stocks()).map(readRow).filter((x): x is AfricanRow => !!x),
    asi: async () => findNumber(await createNgxPulse().market(), ASI),
  },
  mansa: {
    stocks: async () => rowsOf(await createMansa().stocks("nigeria", { limit: 500 })).map(readRow).filter((x): x is AfricanRow => !!x),
    asi: async () => {
      const rows = rowsOf(await createMansa().indices("nigeria"));
      const r = rows.find((x) => /all.?share|asi/i.test(String(x.name ?? x.code ?? x.symbol ?? "")));
      return r ? num(pick(r, ["value", "level", "close", "current_value", "price", "last"])) : null;
    },
  },
  mystocks: {
    stocks: async () => rowsOf(await createMyStocksAfrica().stocks({ exchange: "NGX", limit: 500 })).map(readRow).filter((x): x is AfricanRow => !!x),
    asi: async () => findNumber(await createMyStocksAfrica().marketIntel({ exchange: "NGX" }), ASI),
  },
  africa: {
    stocks: async () => rowsOf(await createAfricaApi().tickers({ exchange_code: "NGX", limit: 500 })).map(readRow).filter((x): x is AfricanRow => !!x),
    asi: async () => findNumber(await createAfricaApi().exchange("NGX"), ASI),
  },
} as const;
