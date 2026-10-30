// Unit tests for src/lib/providers: request URLs, auth, error handling and
// key redaction, with a fake fetch (no network, no real keys).
// Run: npm test
import { createAlphaVantage } from "../src/lib/providers/alphavantage";
import { createAfricaApi } from "../src/lib/providers/africa-api";
import { createCompaniesHouse } from "../src/lib/providers/companies-house";
import { createCurrents } from "../src/lib/providers/currents";
import { createEodhd } from "../src/lib/providers/eodhd";
import { createExchangeRate } from "../src/lib/providers/exchangerate";
import { createFmp } from "../src/lib/providers/fmp";
import { createFred } from "../src/lib/providers/fred";
import { createMansa } from "../src/lib/providers/mansa";
import { createMarketaux } from "../src/lib/providers/marketaux";
import { createMarketstack } from "../src/lib/providers/marketstack";
import { createMyStocksAfrica } from "../src/lib/providers/mystocks-africa";
import { createNgxPulse } from "../src/lib/providers/ngx-pulse";
import { CONNECTIONS, checkConnections } from "../src/lib/providers";

type Call = { url: URL; headers: Headers };
let calls: Call[] = [];
let reply: { status?: number; body: unknown } = { body: {} };
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const headers = new Headers(input instanceof Request ? input.headers : init?.headers);
  calls.push({ url, headers });
  return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

let fails = 0;
const t = (label: string, ok: boolean, info?: unknown) => { if (!ok) fails++; console.log((ok ? "PASS " : "FAIL ") + label, ok ? "" : JSON.stringify(info)); };
const last = () => calls[calls.length - 1];
async function run(label: string, body: unknown, fn: () => Promise<unknown>, check: (c: Call) => boolean) {
  calls = []; reply = { body };
  try { await fn(); } catch (e) { t(label, false, (e as Error).message); return; }
  t(label, !!last() && check(last()), last()?.url.toString());
}
async function throws(label: string, fn: () => Promise<unknown>, test: (e: unknown) => boolean) {
  try { await fn(); t(label, false, "did not throw"); } catch (e) { t(label, test(e), (e as Error).message); }
}

// --- request shape per provider ---------------------------------------------
await run("Alpha Vantage quote", { "Global Quote": {} }, () => createAlphaVantage("AVKEY").quote("IBM"),
  (c) => c.url.origin === "https://www.alphavantage.co" && c.url.searchParams.get("function") === "GLOBAL_QUOTE" && c.url.searchParams.get("apikey") === "AVKEY");
await run("FMP quote (stable API)", [], () => createFmp("FMPKEY").quote("AAPL"),
  (c) => c.url.toString().startsWith("https://financialmodelingprep.com/stable/quote?") && c.url.searchParams.get("apikey") === "FMPKEY");
await run("FRED observations", { observations: [] }, () => createFred("FREDKEY").observations("CPIAUCSL", { units: "pc1" }),
  (c) => c.url.pathname === "/fred/series/observations" && c.url.searchParams.get("file_type") === "json" && c.url.searchParams.get("units") === "pc1" && c.url.searchParams.get("api_key") === "FREDKEY");
await run("Companies House basic auth", { items: [] }, () => createCompaniesHouse("CHKEY").company("sc123"),
  (c) => c.url.pathname === "/company/SC123" && c.headers.get("authorization") === "Basic " + Buffer.from("CHKEY:").toString("base64"));
await run("ExchangeRate-API pair", { result: "success" }, () => createExchangeRate("ERKEY").pair("usd", "ngn"),
  (c) => c.url.toString() === "https://v6.exchangerate-api.com/v6/ERKEY/pair/USD/NGN");
await run("Marketaux news", { data: [] }, () => createMarketaux("MXKEY").news({ symbols: "TSLA" }),
  (c) => c.url.pathname === "/v1/news/all" && c.url.searchParams.get("api_token") === "MXKEY" && c.url.searchParams.get("symbols") === "TSLA");
await run("Marketstack v2 eod", { data: [] }, () => createMarketstack("MSKEY").eod("AAPL", { limit: 5 }),
  (c) => c.url.toString().startsWith("https://api.marketstack.com/v2/eod?") && c.url.searchParams.get("access_key") === "MSKEY" && c.url.searchParams.get("limit") === "5");
await run("Africa API bearer", {}, () => createAfricaApi("AFKEY").ticker("NGX", "DANGCEM"),
  (c) => c.url.toString() === "https://api.africa-api.com/v1/markets/tickers/NGX/DANGCEM" && c.headers.get("authorization") === "Bearer AFKEY");
await run("Mansa bearer + lowercase exchange", { success: true, data: [] }, () => createMansa("MAKEY").stocks("Nigeria", { limit: 10 }),
  (c) => c.url.toString() === "https://www.mansaapi.com/api/v1/markets/exchanges/nigeria/stocks?limit=10" && c.headers.get("authorization") === "Bearer MAKEY");
await run("MyStocks live key", {}, () => createMyStocksAfrica("pk_live_x").stock("mtnn"),
  (c) => c.url.toString() === "https://mystocks.africa/api/v1/partner/stocks/MTNN" && c.headers.get("authorization") === "Bearer pk_live_x");
await run("MyStocks sandbox key", {}, () => createMyStocksAfrica("sk_sandbox_x").stocks({ exchange: "NSE" }),
  (c) => c.url.pathname === "/api/sandbox/v1/partner/stocks");
await run("NGX Pulse X-API-Key", {}, () => createNgxPulse("ngxpulse_sk_x").price("zenithbank"),
  (c) => c.url.toString() === "https://ngxpulse.ng/api/ngxdata/prices/ZENITHBANK" && c.headers.get("x-api-key") === "ngxpulse_sk_x");
await run("Currents SDK", { status: "ok", news: [] }, () => createCurrents("CUKEY").latestNews({ language: "en" }),
  (c) => c.url.origin === "https://api.currentsapi.services" && c.headers.get("authorization") === "CUKEY");
await run("EODHD SDK", [], () => createEodhd("EOKEY").eod("AAPL.US", { from: "2026-01-01" }),
  (c) => c.url.hostname === "eodhd.com" && c.url.pathname.endsWith("/eod/AAPL.US") && c.url.searchParams.get("api_token") === "EOKEY");

// (Errors are matched by name: tsx can load a module twice across ESM/CJS, which breaks instanceof.)
// --- error handling -----------------------------------------------------------
reply = { body: { Information: "Thank you for using Alpha Vantage! rate limit" } };
await throws("Alpha Vantage in-body rate-limit notice throws", () => createAlphaVantage("AVKEY").quote("IBM"), (e) => (e as Error).name === "ProviderError" && /rate limit/.test((e as Error).message));
reply = { body: { result: "error", "error-type": "invalid-key" } };
await throws("ExchangeRate-API error result throws", () => createExchangeRate("SECRETKEY123").latest(), (e) => /invalid-key/.test((e as Error).message));
reply = { body: { success: false, error: { code: "UNAUTHORIZED", message: "bad key" } } };
await throws("Mansa success:false throws", () => createMansa("MAKEY").exchanges(), (e) => /UNAUTHORIZED/.test((e as Error).message));
reply = { status: 401, body: { error: { code: "invalid_api_token", message: "Invalid API token" } } };
await throws("HTTP 401 throws with status and redacted key", () => createMarketaux("TOPSECRET").news(),
  (e) => { const x = e as Error & { status?: number }; return x.name === "ProviderError" && x.status === 401 && /Invalid API token/.test(x.message) && !x.message.includes("TOPSECRET"); });
reply = { status: 403, body: "Forbidden" };
await throws("ExchangeRate-API key redacted from path", () => createExchangeRate("PATHSECRET").latest(), (e) => !(e as Error).message.includes("PATHSECRET"));

delete process.env.FRED_API_KEY;
await throws("Missing key names the env var", async () => createFred(), (e) => (e as Error).name === "MissingKeyError" && (e as { envVar?: string }).envVar === "FRED_API_KEY");

// --- registry ---------------------------------------------------------------
const secrets = ["AFRICA_API_KEY", "ALPHAVANTAGE_API_KEY", "COMPANIES_HOUSE_API_KEY", "CURRENTS_API_KEY", "DATABASE_URL", "EDINET_API_KEY", "EODHD_API_KEY", "EXCHANGERATE_API_KEY", "FMP_API_KEY", "FRED_API_KEY", "MANSA_API_KEY", "MARKETAUX_API_KEY", "MARKETSTACK_API_KEY", "MYSTOCKS_AFRICA_API_KEY", "NEWSAPI_AI_KEY", "NGX_PULSE_API_KEY", "OPENDART_API_KEY"];
t("Registry covers every repository secret", JSON.stringify(CONNECTIONS.map((c) => c.env).sort()) === JSON.stringify(secrets), CONNECTIONS.map((c) => c.env));
for (const s of secrets) delete process.env[s];
process.env.FMP_API_KEY = "LEAKYKEY99";
reply = { status: 401, body: { "Error Message": "Invalid API KEY LEAKYKEY99" } };
const res = await checkConnections();
const fmpRes = res.find((r) => r.id === "fmp");
t("checkConnections skips unconfigured", res.filter((r) => r.configured).length === 1);
t("checkConnections reports failure without leaking the key", fmpRes?.ok === false && !fmpRes.error?.includes("LEAKYKEY99"), fmpRes);

console.log(fails ? `\n${fails} provider test(s) failed` : "\nAll provider tests passed");
process.exit(fails ? 1 : 0);
