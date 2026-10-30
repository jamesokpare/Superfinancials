// Test of src/lib/market/intraday with a fake EODHD: symbol mapping, latest
// session only, quote shaping, uncovered instruments and the one-minute cache.
// Run: npm test
import { eodhdSymbol, intraday, lastSession } from "../src/lib/market/intraday";

process.env.EODHD_API_KEY = "test-eod";
const calls: string[] = [];
const NOW = Date.parse("2026-10-30T18:00:00Z");
const bar = (iso: string, c: number) => ({ timestamp: Date.parse(iso) / 1000, gmtoffset: 0, datetime: iso, open: c, high: c + 1, low: c - 1, close: c, volume: 100 });
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = new URL(input instanceof Request ? input.url : String(input)); calls.push(url.pathname);
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
  if (url.pathname === "/api/intraday/AAPL.US") return json([bar("2026-10-29T19:55:00Z", 230), bar("2026-10-30T13:30:00Z", 231), bar("2026-10-30T13:35:00Z", 232.5)]);
  if (url.pathname === "/api/real-time/AAPL.US") return json({ code: "AAPL.US", timestamp: Date.parse("2026-10-30T17:45:00Z") / 1000, gmtoffset: 0, open: 231, high: 234, low: 230.5, close: 233.2, volume: 4.1e7, previousClose: 230, change: 3.2, change_p: 1.391 });
  return json({ error: "not mocked" }, 404);
}) as typeof fetch;

let fails = 0;
const t = (label: string, ok: boolean, info?: unknown) => { if (!ok) fails++; console.log((ok ? "PASS " : "FAIL ") + label, ok ? "" : JSON.stringify(info)); };

t("EODHD symbols: stocks, FX, crypto; not bond yields or unknown ids", eodhdSymbol("EQ.AAPL") === "AAPL.US" && eodhdSymbol("FX.EURUSD") === "EURUSD.FOREX" && eodhdSymbol("CR.BTCUSD") === "BTC-USD.CC" && eodhdSymbol("YD.US10") === null && eodhdSymbol("ZZ.NONE") === null);
const ls = lastSession([bar("2026-10-29T19:55:00Z", 1), bar("2026-10-30T13:30:00Z", 2)]);
t("latest session only", ls.session === "2026-10-30" && ls.bars.length === 1 && ls.bars[0][4] === 2, ls);
const r = await intraday("EQ.AAPL", "5m", NOW);
t("bars and quote", r?.sym === "AAPL.US" && r.bars.length === 2 && r.bars[1][4] === 232.5 && r.quote?.c === 233.2 && r.quote.chp === 1.391 && r.quote.prev === 230 && r.session === "2026-10-30", r);
const n = calls.length; await intraday("EQ.AAPL", "5m", NOW + 30e3);
t("cached for a minute", calls.length === n, calls.slice(n));
t("uncovered instrument → null", (await intraday("YD.US10", "5m", NOW)) === null);

console.log(fails ? `\n${fails} intraday test(s) failed` : "\nAll intraday tests passed");
process.exit(fails ? 1 : 0);
