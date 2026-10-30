// Fetches one real response from each provider endpoint whose format the app reads
// by guessing field names (Mansa, NGX Pulse, MyStocks Africa, Africa API) or that was
// written without live access (Alpha Vantage news, EODHD, IMF), and saves it so the
// readers can be checked against it.
//
// Run: npm run providers:samples              (writes samples/<provider>.<endpoint>.json)
//      npm run providers:samples -- --only=mansa,imf
//
// Keys never leave the process: error messages are scrubbed and responses hold no
// credentials. Long lists are cut to their first two items and long strings to 300
// characters, so the files stay small. The log shows each response's structure.
// Uses about 2 Alpha Vantage calls and ~10 EODHD calls.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createAfricaApi } from "../src/lib/providers/africa-api";
import { createAlphaVantage } from "../src/lib/providers/alphavantage";
import { createEodhd } from "../src/lib/providers/eodhd";
import { createMansa } from "../src/lib/providers/mansa";
import { createMyStocksAfrica } from "../src/lib/providers/mystocks-africa";
import { createNgxPulse } from "../src/lib/providers/ngx-pulse";
import { envKey } from "../src/lib/providers/http";
import { scrub } from "../src/lib/providers";

for (const f of [".env.local", ".env"]) if (existsSync(f)) process.loadEnvFile(f);
const only = process.argv.find((a) => a.startsWith("--only"))?.split("=")[1]?.split(",").map((s) => s.trim()).filter(Boolean);
const OUT = "samples"; mkdirSync(OUT, { recursive: true });
const day = (d: number) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
const y0 = new Date().getUTCFullYear();

/** Cuts a response down: arrays to their first 2 items (with the original length noted), strings to 300 characters, depth 6. */
function cut(x: unknown, depth = 0): unknown {
  if (depth > 6) return "…";
  if (typeof x === "string") return x.length > 300 ? x.slice(0, 300) + "…" : x;
  if (Array.isArray(x)) { const a = x.slice(0, 2).map((v) => cut(v, depth + 1)); return x.length > 2 ? [...a, `… ${x.length} items in all`] : a; }
  if (x && typeof x === "object") { const e = Object.entries(x as Record<string, unknown>); const o: Record<string, unknown> = {}; for (const [k, v] of e.slice(0, 60)) o[k] = cut(v, depth + 1); if (e.length > 60) o["…"] = `${e.length} keys in all`; return o; }
  return x;
}
/** One line per path: its type, and for arrays of objects the keys of the first item. */
function shape(x: unknown, path = "", out: string[] = [], depth = 0): string[] {
  if (depth > 4 || out.length > 40) return out;
  if (Array.isArray(x)) { const first = x.find((v) => v !== null && v !== undefined); out.push(`${path || "(root)"}: array[${x.length}]${first && typeof first === "object" && !Array.isArray(first) ? ` of { ${Object.keys(first).slice(0, 25).join(", ")} }` : first !== undefined ? ` of ${typeof first}` : ""}`); if (first && typeof first === "object") shape(first, `${path}[0]`, out, depth + 1); return out; }
  if (x && typeof x === "object") { const e = Object.entries(x as Record<string, unknown>); if (!path) out.push(`(root): { ${e.map(([k]) => k).slice(0, 25).join(", ")} }`); for (const [k, v] of e.slice(0, 25)) if (v && typeof v === "object") shape(v, path ? `${path}.${k}` : k, out, depth + 1); return out; }
  return out;
}

/** A plain GET returning JSON (for endpoints the client libraries don't cover). */
async function raw(url: string): Promise<unknown> { const r = await fetch(url, { signal: AbortSignal.timeout(30_000) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }
type Probe = [provider: string, endpoint: string, env: string | null, fn: () => Promise<unknown>];
const probes: Probe[] = [
  // Mansa API (NGX = "nigeria")
  ["mansa", "exchange", "MANSA_API_KEY", () => createMansa().exchange("nigeria")],
  ["mansa", "stocks", "MANSA_API_KEY", () => createMansa().stocks("nigeria", { limit: 3 })],
  ["mansa", "stock-MTNN", "MANSA_API_KEY", () => createMansa().stock("nigeria", "MTNN")],
  ["mansa", "indices", "MANSA_API_KEY", () => createMansa().indices("nigeria")],
  ["mansa", "movers-gainers", "MANSA_API_KEY", () => createMansa().movers("nigeria", { type: "gainers", limit: 3 })],
  ["mansa", "movers-pan-african", "MANSA_API_KEY", () => createMansa().panAfricanMovers(3)],
  ["mansa", "etfs", "MANSA_API_KEY", () => createMansa().etfs("nigeria")],
  ["mansa", "dividends-MTNN", "MANSA_API_KEY", () => createMansa().dividends("nigeria", "MTNN")],
  ["mansa", "disclosures", "MANSA_API_KEY", () => createMansa().disclosures("nigeria", { limit: 3 })],
  // NGX Pulse
  ["ngxpulse", "stocks", "NGX_PULSE_API_KEY", () => createNgxPulse().stocks()],
  ["ngxpulse", "price-MTNN", "NGX_PULSE_API_KEY", () => createNgxPulse().price("MTNN")],
  ["ngxpulse", "market", "NGX_PULSE_API_KEY", () => createNgxPulse().market()],
  ["ngxpulse", "market-status", "NGX_PULSE_API_KEY", () => createNgxPulse().marketStatus()],
  ["ngxpulse", "disclosures", "NGX_PULSE_API_KEY", () => createNgxPulse().disclosures()],
  ["ngxpulse", "nasd-stocks", "NGX_PULSE_API_KEY", () => createNgxPulse().nasdStocks()],
  // MyStocks Africa
  ["mystocks", "stocks", "MYSTOCKS_AFRICA_API_KEY", () => createMyStocksAfrica().stocks({ exchange: "NGX", limit: 3 })],
  ["mystocks", "stock-MTNN", "MYSTOCKS_AFRICA_API_KEY", () => createMyStocksAfrica().stock("MTNN")],
  ["mystocks", "company-MTNN", "MYSTOCKS_AFRICA_API_KEY", () => createMyStocksAfrica().company("MTNN")],
  ["mystocks", "news-MTNN", "MYSTOCKS_AFRICA_API_KEY", () => createMyStocksAfrica().news("MTNN")],
  ["mystocks", "market-intel", "MYSTOCKS_AFRICA_API_KEY", () => createMyStocksAfrica().marketIntel({ exchange: "NGX" })],
  // Africa API
  ["africa", "exchange-NGX", "AFRICA_API_KEY", () => createAfricaApi().exchange("NGX")],
  ["africa", "tickers", "AFRICA_API_KEY", () => createAfricaApi().tickers({ exchange_code: "NGX", limit: 3 })],
  ["africa", "ticker-MTNN", "AFRICA_API_KEY", () => createAfricaApi().ticker("NGX", "MTNN")],
  ["africa", "country-NG", "AFRICA_API_KEY", () => createAfricaApi().country("NG")],
  ["africa", "country-profile-NG", "AFRICA_API_KEY", () => createAfricaApi().countryProfile("NG")],
  ["africa", "trade-NG", "AFRICA_API_KEY", () => createAfricaApi().tradeOverview("NG", { start_year: y0 - 3, end_year: y0, top_limit: 3 })],
  ["africa", "elections", "AFRICA_API_KEY", () => createAfricaApi().upcomingElections(3)],
  // Alpha Vantage (2 calls)
  ["alphavantage", "news-sentiment", "ALPHAVANTAGE_API_KEY", () => createAlphaVantage().news({ topics: "financial_markets", sort: "LATEST", limit: 3 })],
  ["alphavantage", "quote-IBM", "ALPHAVANTAGE_API_KEY", () => createAlphaVantage().quote("IBM")],
  // EODHD (through its SDK, as the app does)
  ["eodhd", "real-time-AAPL", "EODHD_API_KEY", () => createEodhd().realTime("AAPL.US", { s: "GSPC.INDX,EURUSD.FOREX" })],
  ["eodhd", "eod-AAPL", "EODHD_API_KEY", () => createEodhd().eod("AAPL.US", { from: day(-7), period: "d", order: "a" })],
  ["eodhd", "intraday-AAPL", "EODHD_API_KEY", () => createEodhd().intraday("AAPL.US", { interval: "5m", from: Math.floor(Date.now() / 1000) - 3 * 86400 })],
  ["eodhd", "news-AAPL", "EODHD_API_KEY", () => createEodhd().news({ s: "AAPL.US", limit: 2 })],
  ["eodhd", "calendar-splits", "EODHD_API_KEY", () => createEodhd().calendar.splits({ from: day(-30), to: day(60) })],
  ["eodhd", "calendar-dividends", "EODHD_API_KEY", () => createEodhd().calendar.dividends({ "filter[date_from]": day(0), "filter[date_to]": day(7), "page[limit]": 3 })],
  ["eodhd", "calendar-earnings", "EODHD_API_KEY", () => createEodhd().calendar.earnings({ symbols: "AAPL.US", from: day(-120), to: day(120) })],
  ["eodhd", "fundamentals-AAPL-highlights", "EODHD_API_KEY", () => createEodhd().fundamentals("AAPL.US", { filter: "Highlights" })],
  ["eodhd", "fundamentals-DANGCEM-XNSA", "EODHD_API_KEY", () => createEodhd().fundamentals("DANGCEM.XNSA", { filter: "General" })],
  // EODHD credit & sovereign risk (Damodaran-sourced; Fundamentals or All-In-One plan)
  ["eodhd", "credit-ratings", "EODHD_API_KEY", () => raw(`https://eodhd.com/api/credit-risk/sovereign/credit-ratings?api_token=${envKey("EODHD_API_KEY")}&fmt=json`)],
  ["eodhd", "cds-spreads", "EODHD_API_KEY", () => raw(`https://eodhd.com/api/credit-risk/sovereign/cds-spreads?api_token=${envKey("EODHD_API_KEY")}&fmt=json`)],
  ["eodhd", "proxy-SRUUF", "EODHD_API_KEY", () => createEodhd().eod("SRUUF.US", { from: day(-7), period: "d", order: "a" })],
  // FRED: the copyright notes of every series the app shows (restricted ones are skipped by the sync)
  ...["T5YIE", "T10YIE", "T5YIFR", "DCPF3M", "DTB3", "SOFR", "GACDFSA066MSFRBPHI", "GACDISA066MSFRBNY", "BACTSAMFRBDAL", "USREC"].map((id): Probe => ["fred", `notes-${id}`, "FRED_API_KEY", async () => {
    const r = await raw(`https://api.stlouisfed.org/fred/series?series_id=${id}&file_type=json&api_key=${envKey("FRED_API_KEY")}`) as { seriess?: { title?: string; notes?: string; last_updated?: string }[] };
    const x = r.seriess?.[0] ?? {}; return { title: x.title, last_updated: x.last_updated, notes: x.notes };
  }]),
  // Cboe index history files (display terms to be checked)
  ["cboe", "VIX_History", null, async () => { const t = await (await fetch("https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv", { signal: AbortSignal.timeout(30_000) })).text(); const l = t.trim().split("\n"); return { header: l[0], last: l.slice(-2), rows: l.length }; }],
  // IMF World Economic Outlook (no key)
  ["imf", "weo-NGDP_RPCH", null, async () => {
    const r = await fetch(`https://www.imf.org/external/datamapper/api/v1/NGDP_RPCH?periods=${y0},${y0 + 1}`, { headers: { "user-agent": "Superfinancials data sync (https://github.com/jamesokpare/Superfinancials)" }, signal: AbortSignal.timeout(30_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const b = await r.json() as { values?: Record<string, Record<string, unknown>> };
    // Keep three countries, so the shape is clear and the file small.
    const v = b.values?.NGDP_RPCH ?? {}; return { ...b, values: { NGDP_RPCH: Object.fromEntries(["USA", "NGA", "GBR"].map((k) => [k, v[k]])) }, _countries_in_response: Object.keys(v).length };
  }],
];

const summary: string[] = []; let ok = 0, failed = 0, skipped = 0;
for (const [p, ep, env, fn] of probes) {
  if (only && !only.includes(p)) continue;
  const name = `${p}.${ep}`;
  if (env && !envKey(env)) { skipped++; summary.push(`- ${name}: skipped (${env} not set)`); console.log(`\n== ${name}: skipped (${env} not set)`); continue; }
  const t0 = Date.now();
  try {
    const body = await fn(); const ms = Date.now() - t0; ok++;
    writeFileSync(`${OUT}/${name}.json`, JSON.stringify({ endpoint: name, fetched: new Date().toISOString(), ms, response: cut(body) }, null, 2));
    const sh = shape(body);
    console.log(`\n== ${name}: OK (${ms} ms)\n${sh.map((l) => "   " + l).join("\n")}\n   sample: ${JSON.stringify(cut(body)).slice(0, 1500)}`);
    summary.push(`- ${name}: OK · ${sh[0] ?? typeof body}`);
  } catch (e) {
    failed++; const msg = scrub(String((e as Error)?.message ?? e)).replace(/api_token=[^&\s]+/g, "api_token=***").replace(/apikey=[^&\s]+/g, "apikey=***").slice(0, 400);
    writeFileSync(`${OUT}/${name}.json`, JSON.stringify({ endpoint: name, fetched: new Date().toISOString(), error: msg }, null, 2));
    console.log(`\n== ${name}: ERROR ${msg}`); summary.push(`- ${name}: **error** ${msg.slice(0, 160)}`);
  }
  // Alpha Vantage free keys allow 5 calls a minute; be gentle with every provider.
  await new Promise((r) => setTimeout(r, p === "alphavantage" ? 13_000 : 400));
}
const head = `${ok} responses saved, ${failed} errors, ${skipped} skipped (key not set).`;
writeFileSync(`${OUT}/SUMMARY.md`, `# Provider response samples\n\n${head}\n\n${summary.join("\n")}\n`);
console.log(`\n${head}\nFiles: ${OUT}/`);
