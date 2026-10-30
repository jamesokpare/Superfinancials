/**
 * Intraday bars and a delayed quote for one app instrument from EODHD, read on
 * demand by the security page (/api/intraday/<id>). Instruments EODHD prices
 * (U.S. stocks and ETFs, indices, FX, crypto, gold) are covered; government
 * bond yields and economic series are not. Results are cached for a minute.
 */
import "server-only";
import { createEodhd } from "@/lib/providers/eodhd";
import { INSTRUMENT_SOURCES } from "./instruments";

export type IntradayResult = {
  id: string; sym: string; interval: "1m" | "5m" | "1h";
  quote: { t: string; c: number; o: number | null; h: number | null; l: number | null; prev: number | null; ch: number | null; chp: number | null; vol: number | null } | null;
  /** [time ms, open, high, low, close, volume], the latest session only. */
  bars: [number, number, number, number, number, number][];
  session: string | null; src: string; note: string;
};

/** The EODHD symbol for an app instrument, or null when EODHD doesn't price it intraday. */
export function eodhdSymbol(id: string): string | null {
  const s = (INSTRUMENT_SOURCES[id] ?? []).find((x) => x.p === "eodhd") as { s?: string } | undefined;
  return s?.s && !s.s.endsWith(".GBOND") ? s.s : null;
}

const fin = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
/** Keeps the bars of the most recent session (by UTC date of the exchange's local day). */
export function lastSession(bars: { timestamp: number; gmtoffset?: number; open: number; high: number; low: number; close: number; volume: number }[]) {
  const day = (b: { timestamp: number; gmtoffset?: number }) => new Date((b.timestamp + (b.gmtoffset ?? 0)) * 1000).toISOString().slice(0, 10);
  const ok = bars.filter((b) => Number.isFinite(b.timestamp) && Number.isFinite(b.close));
  const last = ok.length ? day(ok[ok.length - 1]) : null;
  return { session: last, bars: ok.filter((b) => day(b) === last).map((b) => [b.timestamp * 1000, b.open, b.high, b.low, b.close, b.volume ?? 0] as [number, number, number, number, number, number]) };
}

const cache = new Map<string, { t: number; v: IntradayResult }>();

export async function intraday(id: string, interval: "1m" | "5m" | "1h" = "5m", now = Date.now()): Promise<IntradayResult | null> {
  const sym = eodhdSymbol(id); if (!sym) return null;
  const key = `${id}|${interval}`; const hit = cache.get(key); if (hit && now - hit.t < 60e3) return hit.v;
  const eod = createEodhd();
  // Five days back covers weekends and holidays; only the latest session is returned.
  const [bars, q] = await Promise.all([
    eod.intraday(sym, { interval, from: Math.floor(now / 1000) - 5 * 86400 }),
    eod.realTime(sym).catch(() => null),
  ]);
  const s = lastSession(Array.isArray(bars) ? bars : []);
  const quote = q && fin(q.close) !== null && q.close > 0 ? { t: new Date(q.timestamp * 1000).toISOString(), c: q.close, o: fin(q.open), h: fin(q.high), l: fin(q.low), prev: fin(q.previousClose), ch: fin(q.change), chp: fin(q.change_p), vol: fin(q.volume) } : null;
  const v: IntradayResult = { id, sym, interval, quote, bars: s.bars, session: s.session, src: "EODHD", note: "Delayed quote (about 15 minutes for U.S. stocks) and intraday bars from EODHD." };
  cache.set(key, { t: now, v }); return v;
}
