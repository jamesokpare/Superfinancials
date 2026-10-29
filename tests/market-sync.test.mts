// End-to-end test of src/lib/market/sync.ts with a fake fetch and an in-memory
// docs table: source fallback, FX/DXY, FRED econ dating, NGX desk updates,
// history backfill, day-doc compaction and dry runs.
// Run: npm test
import { runMarketSync, decodeHist } from "../src/lib/market/sync";
import { memoryStore } from "../src/lib/market/store";
import { dxy } from "../src/lib/market/instruments";

for (const k of ["EODHD_API_KEY", "FMP_API_KEY", "FRED_API_KEY", "EXCHANGERATE_API_KEY", "NGX_PULSE_API_KEY"]) process.env[k] = "test-" + k;
const NOW = new Date("2026-10-29T22:30:00Z");
const RATES = { EUR: 0.86, JPY: 152.4, GBP: 0.75, CAD: 1.39, SEK: 9.4, CHF: 0.8, NGN: 1460.5, CNH: 7.1 };
const seen: string[] = [];

globalThis.fetch = (async (input: string | URL | Request) => {
  const url = new URL(input instanceof Request ? input.url : String(input)); seen.push(url.hostname + url.pathname);
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
  if (url.hostname === "eodhd.com") {
    if (url.pathname.startsWith("/api/real-time/")) {
      const syms = [url.pathname.split("/").pop()!, ...(url.searchParams.get("s")?.split(",") ?? [])];
      // EODHD knows AAPL and the S&P 500 but not MSFT (so MSFT must fall back to FMP).
      return json(syms.map((code) => code === "AAPL.US" ? { code, timestamp: 1793304000, close: 262.5, change: 1.5 } : code === "GSPC.INDX" ? { code, timestamp: 1793304000, close: 6890.1, change: -10 } : { code, timestamp: "NA", close: "NA" }));
    }
    if (url.pathname === "/api/eod/AAPL.US") return json([{ date: "2026-10-27", close: 259, adjusted_close: 259 }, { date: "2026-10-28", close: 261, adjusted_close: 261 }]);
    return json([]);
  }
  if (url.hostname === "financialmodelingprep.com") {
    if (url.pathname.endsWith("/batch-quote")) return json({ "Error Message": "Premium endpoint" }, 402);
    if (url.pathname.endsWith("/quote")) return json(url.searchParams.get("symbol") === "MSFT" ? [{ symbol: "MSFT", price: 530.25, change: 2, timestamp: 1793304000 }] : []);
    return json([]);
  }
  if (url.hostname === "v6.exchangerate-api.com") return json({ result: "success", base_code: "USD", time_last_update_utc: "Thu, 29 Oct 2026 00:00:01 +0000", conversion_rates: { USD: 1, ...RATES } });
  if (url.hostname === "api.stlouisfed.org") {
    const id = url.searchParams.get("series_id");
    if (id === "PAYEMS") return json({ observations: [{ date: "2026-08-01", value: "-12" }, { date: "2026-09-01", value: "-35" }] });
    if (id === "DGS10") return json({ observations: [{ date: "2026-10-27", value: "4.01" }, { date: "2026-10-28", value: "." }] });
    return json({ observations: [] });
  }
  if (url.hostname === "ngxpulse.ng") {
    if (url.pathname === "/api/ngxdata/stocks") return json({ data: [{ symbol: "MTNN", current_price: 455.5, change_percent: 1.2 }, { symbol: "DANGCEM", current_price: 610 }, { symbol: "GTCO", current_price: 98 }, { symbol: "ZENITHBANK", current_price: 70 }, { symbol: "UBA", current_price: 45 }] });
    if (url.pathname === "/api/ngxdata/market") return json({ data: { asi: 151234.56, market_cap: 95e12 } });
  }
  return json({ error: "not mocked" }, 404);
}) as typeof fetch;

let fails = 0;
const t = (label: string, ok: boolean, info?: unknown) => { if (!ok) fails++; console.log((ok ? "PASS " : "FAIL ") + label, ok ? "" : JSON.stringify(info)); };

const seed = {
  mkt: [
    { id: "d-2026-09-01", data: { type: "day", date: "2026-09-01", checked: "2026-09-01T22:00:00Z", q: { "CM.CL1": [70.5, null, "2026-09-01", "te"] } } },
    { id: "d-2026-10-28", data: { type: "day", date: "2026-10-28", checked: "2026-10-28T22:00:00Z", q: { "IX.NGSEINDX": [150000, null, "2026-10-28", "nm"] } } },
  ],
  adm_inst: [
    { id: "AD.NG.MTNN", data: { arr: ["d", "c"], d: ["2026-10-27"], c: [450], gen: "g1", parts: 2, id: "AD.NG.MTNN", kind: "inst", meta: { tk: "MTNN", exch: "NGX" }, new: true, src: "desk" } },
    { id: "AD.NG.MTNN~p1", data: { of: "AD.NG.MTNN", p: 1, gen: "g1", d: ["2026-10-28"], c: [452] } },
    { id: "AD.NG.NOPE", data: { arr: ["d", "c"], d: ["2026-10-27"], c: [10], gen: "g1", parts: 1, meta: { tk: "NOPE", exch: "NGX" } } },
  ],
};
const only = ["EQ.AAPL", "EQ.MSFT", "IX.SPX", "FX.EURUSD", "FX.USDJPY", "FX.GBPUSD", "FX.USDCAD", "FX.USDSEK", "FX.USDCHF", "FX.USDNGN", "FX.DXY", "EC.USNFP", "YD.US10", "IX.NGSEINDX", "NGX", "IX.MOVE"];
const providers = ["eodhd", "fmp", "fred", "exchangerate", "ngxpulse"] as const;

// --- dry run writes nothing ----
const dryStore = memoryStore(seed);
const dry = await runMarketSync({ store: dryStore, now: NOW, only, providers: [...providers], dryRun: true });
t("dry run resolves but writes nothing", dry.resolved > 0 && JSON.stringify(dryStore.dump()) === JSON.stringify(memoryStore(seed).dump()), dry.note);

// --- real run ----
const store = memoryStore(seed);
const r = await runMarketSync({ store, now: NOW, only, providers: [...providers], historyBudget: 5 });
const mkt = Object.fromEntries(store.dump().mkt.map((d) => [d.id, d.data as Record<string, unknown>]));
const q = (mkt["d-2026-10-29"] as { q: Record<string, unknown[]> }).q;

t("EODHD value with its change and date", JSON.stringify(q["EQ.AAPL"]) === JSON.stringify([262.5, 1.5, "2026-10-29", "eodhd"]), q["EQ.AAPL"]);
t("falls back to FMP when EODHD has no value", q["EQ.MSFT"]?.[0] === 530.25 && q["EQ.MSFT"]?.[3] === "fmp", q["EQ.MSFT"]);
t("index from EODHD", q["IX.SPX"]?.[0] === 6890.1);
t("FX from ExchangeRate-API (inverted for EURUSD)", Math.abs(Number(q["FX.EURUSD"]?.[0]) - 1 / 0.86) < 1e-6 && q["FX.USDNGN"]?.[0] === 1460.5 && q["FX.USDNGN"]?.[3] === "exchangerate", [q["FX.EURUSD"], q["FX.USDNGN"]]);
const want = dxy({ EURUSD: 1 / 0.86, USDJPY: 152.4, GBPUSD: 1 / 0.75, USDCAD: 1.39, USDSEK: 9.4, USDCHF: 0.8 })!;
t("DXY computed from its six components", Math.abs(Number(q["FX.DXY"]?.[0]) - want) < 1e-4 && want > 80 && want < 120, [q["FX.DXY"], want]);
t("FRED payrolls: negative kept, dated at month end", q["EC.USNFP"]?.[0] === -35 && q["EC.USNFP"]?.[2] === "2026-09-30", q["EC.USNFP"]);
t("FRED skips missing '.' values", q["YD.US10"]?.[0] === 4.01 && q["YD.US10"]?.[2] === "2026-10-27", q["YD.US10"]);
t("NGX All-Share from NGX Pulse", q["IX.NGSEINDX"]?.[0] === 151234.56 && q["IX.NGSEINDX"]?.[3] === "ngxpulse", q["IX.NGSEINDX"]);
t("unknown instrument stays simulated", r.unresolved.includes("IX.MOVE"), r.unresolved);

const hFred = mkt["h-EC.USNFP@fred"]; const hAapl = mkt["h-EQ.AAPL@eodhd"];
t("FRED history doc written", !!hFred && decodeHist(hFred).length === 2, hFred);
t("EODHD history backfilled within budget", !!hAapl && JSON.stringify(decodeHist(hAapl)) === JSON.stringify([{ t: "2026-10-27", c: 259 }, { t: "2026-10-28", c: 261 }]), hAapl);
t("history not fetched for computed DXY", !mkt["h-FX.DXY@exchangerate"] && !Object.keys(mkt).some((k) => k.includes("calc")));

t("old day doc folded into history and removed", !mkt["d-2026-09-01"] && decodeHist(mkt["h-CM.CL1@te"] ?? {})[0]?.c === 70.5, Object.keys(mkt));
t("recent day doc kept", !!mkt["d-2026-10-28"]);
t("meta note written", String((mkt._meta as { note?: string }).note).startsWith("API sync 2026-10-29"), mkt._meta);

const adm = Object.fromEntries(store.dump().adm_inst.map((d) => [d.id, d.data as Record<string, unknown>]));
const mtn = adm["AD.NG.MTNN"];
t("NGX desk listing: parts merged and today's close appended", JSON.stringify(mtn.d) === JSON.stringify(["2026-10-27", "2026-10-28", "2026-10-29"]) && JSON.stringify(mtn.c) === JSON.stringify([450, 452, 455.5]) && mtn.parts === 1, mtn);
t("NGX desk listing: stale part docs deleted", !adm["AD.NG.MTNN~p1"]);
t("NGX desk listing: source noted", /NGX Pulse/.test(String(mtn.src)) && /earlier: desk/.test(String(mtn.src)), mtn.src);
t("NGX listing without a quote untouched", JSON.stringify(adm["AD.NG.NOPE"].c) === "[10]");

// --- second run the same day: idempotent ----
seen.length = 0;
await runMarketSync({ store, now: NOW, only, providers: [...providers], historyBudget: 5 });
const mtn2 = store.dump().adm_inst.find((d) => d.id === "AD.NG.MTNN")!.data as { c: number[] };
t("re-running does not duplicate NGX points", mtn2.c.length === 3, mtn2.c);
t("re-running does not refetch EODHD history", !seen.includes("eodhd.com/api/eod/AAPL.US"), seen.filter((s) => s.includes("/eod/")));

// --- nothing configured: nothing written ----
const empty = memoryStore();
const r0 = await runMarketSync({ store: empty, now: NOW, providers: [] });
t("no providers: no writes", r0.resolved === 0 && JSON.stringify(empty.dump()) === "{}", empty.dump());

console.log(fails ? `\n${fails} market-sync test(s) failed` : "\nAll market-sync tests passed");
process.exit(fails ? 1 : 0);
