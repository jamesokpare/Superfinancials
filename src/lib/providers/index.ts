/**
 * One place to see every external data connection: which env var it reads,
 * whether it is configured, and a cheap `ping` to check the key works.
 *
 *   import { createFred } from "@/lib/providers";
 *   const fred = createFred();                 // reads FRED_API_KEY
 *   await fred.observations("CPIAUCSL");
 *
 * Server-only. Keys are never sent to the browser.
 */
import "server-only";
import { envKey } from "./http";
import * as africa from "./africa-api";
import * as av from "./alphavantage";
import * as ch from "./companies-house";
import * as currents from "./currents";
import * as db from "../db/postgres";
import * as eodhd from "./eodhd";
import * as fx from "./exchangerate";
import * as fmp from "./fmp";
import * as fred from "./fred";
import * as mansa from "./mansa";
import * as maux from "./marketaux";
import * as mstack from "./marketstack";
import * as mysa from "./mystocks-africa";
import * as newsai from "./newsapi-ai";
import * as ngx from "./ngx-pulse";

export { ProviderError, MissingKeyError } from "./http";
export { createAfricaApi } from "./africa-api";
export { createAlphaVantage } from "./alphavantage";
export { createCompaniesHouse } from "./companies-house";
export { createCurrents } from "./currents";
export { createEodhd } from "./eodhd";
export { createExchangeRate } from "./exchangerate";
export { createFmp } from "./fmp";
export { createFred } from "./fred";
export { createMansa } from "./mansa";
export { createMarketaux } from "./marketaux";
export { createMarketstack } from "./marketstack";
export { createMyStocksAfrica } from "./mystocks-africa";
export { createNewsApiAi } from "./newsapi-ai";
export { createNgxPulse } from "./ngx-pulse";
export { sql } from "../db/postgres";

export type Connection = {
  id: string;
  name: string;
  env: string;
  kind: "market data" | "news" | "economic" | "fx" | "company registry" | "database";
  docs: string;
  /** Makes one cheap request. Throws if the key is missing or rejected. */
  ping: () => Promise<unknown>;
};

export const CONNECTIONS: Connection[] = [
  { id: "africa-api", name: "Africa API", env: africa.ENV, kind: "economic", docs: "https://africa-api.com", ping: () => africa.createAfricaApi().ping() },
  { id: "alphavantage", name: "Alpha Vantage", env: av.ENV, kind: "market data", docs: "https://www.alphavantage.co/documentation/", ping: () => av.createAlphaVantage().ping() },
  { id: "companies-house", name: "Companies House", env: ch.ENV, kind: "company registry", docs: "https://developer-specs.company-information.service.gov.uk/", ping: () => ch.createCompaniesHouse().ping() },
  { id: "currents", name: "Currents API", env: currents.ENV, kind: "news", docs: "https://currentsapi.services/en/docs/", ping: () => currents.createCurrents().ping() },
  { id: "database", name: "Postgres (DATABASE_URL)", env: db.ENV, kind: "database", docs: "https://github.com/porsager/postgres", ping: db.ping },
  { id: "eodhd", name: "EODHD", env: eodhd.ENV, kind: "market data", docs: "https://eodhd.com/financial-apis/", ping: () => eodhd.createEodhd().ping() },
  { id: "exchangerate", name: "ExchangeRate-API", env: fx.ENV, kind: "fx", docs: "https://www.exchangerate-api.com/docs/overview", ping: () => fx.createExchangeRate().ping() },
  { id: "fmp", name: "Financial Modeling Prep", env: fmp.ENV, kind: "market data", docs: "https://site.financialmodelingprep.com/developer/docs", ping: () => fmp.createFmp().ping() },
  { id: "fred", name: "FRED", env: fred.ENV, kind: "economic", docs: "https://fred.stlouisfed.org/docs/api/fred/", ping: () => fred.createFred().ping() },
  { id: "mansa", name: "Mansa API", env: mansa.ENV, kind: "market data", docs: "https://mansaapi.com/docs", ping: () => mansa.createMansa().ping() },
  { id: "marketaux", name: "Marketaux", env: maux.ENV, kind: "news", docs: "https://www.marketaux.com/documentation", ping: () => maux.createMarketaux().ping() },
  { id: "marketstack", name: "Marketstack", env: mstack.ENV, kind: "market data", docs: "https://marketstack.com/documentation_v2", ping: () => mstack.createMarketstack().ping() },
  { id: "mystocks-africa", name: "MyStocks Africa", env: mysa.ENV, kind: "market data", docs: "https://mystocks.africa/partners/docs/market-data", ping: () => mysa.createMyStocksAfrica().ping() },
  { id: "newsapi-ai", name: "NewsAPI.ai", env: newsai.ENV, kind: "news", docs: "https://newsapi.ai/documentation", ping: () => newsai.createNewsApiAi().ping() },
  { id: "ngx-pulse", name: "NGX Pulse", env: ngx.ENV, kind: "market data", docs: "https://ngxpulse.ng/api", ping: () => ngx.createNgxPulse().ping() },
];

export const isConfigured = (c: Pick<Connection, "env">) => !!envKey(c.env);

/** Replaces any configured secret that appears in a message, e.g. inside an SDK's error URL. */
export function scrub(msg: string) {
  for (const c of CONNECTIONS) {
    const v = envKey(c.env);
    if (v && v.length >= 6) msg = msg.split(v).join("***");
  }
  return msg.replace(/\/\/[^/\s:@]+:[^@\s]+@/g, "//***:***@");
}

export type CheckResult = { id: string; name: string; env: string; configured: boolean; ok?: boolean; ms?: number; error?: string };

/** Pings every configured connection in parallel. Unconfigured ones are skipped. */
export async function checkConnections(ids?: string[]): Promise<CheckResult[]> {
  const list = ids?.length ? CONNECTIONS.filter((c) => ids.includes(c.id)) : CONNECTIONS;
  return Promise.all(list.map(async (c): Promise<CheckResult> => {
    const base = { id: c.id, name: c.name, env: c.env, configured: isConfigured(c) };
    if (!base.configured) return base;
    const t0 = Date.now();
    try {
      await c.ping();
      return { ...base, ok: true, ms: Date.now() - t0 };
    } catch (e) {
      return { ...base, ok: false, ms: Date.now() - t0, error: scrub(String((e as Error)?.message ?? e)).slice(0, 300) };
    }
  }));
}
