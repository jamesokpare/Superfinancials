/**
 * EODHD — end-of-day, intraday and live prices for 150k+ tickers on 70+
 * exchanges, fundamentals, dividends/splits, calendars, macro data, news and
 * a screener. Uses EODHD's official TypeScript SDK (npm: eodhd).
 * Docs: https://eodhd.com/financial-apis/
 * Tickers are SYMBOL.EXCHANGE, e.g. AAPL.US, VOD.LSE, DANGCEM.XNSA.
 */
import { EODHDClient } from "eodhd";
import { requireKey } from "./http";

export { EODHDClient, EODHDError, EODHDAuthError, EODHDRateLimitError } from "eodhd";
export const ENV = "EODHD_API_KEY";
const NAME = "EODHD";

/**
 * Returns the SDK client, e.g.
 *   const eodhd = createEodhd();
 *   await eodhd.eod("AAPL.US", { from: "2026-01-01" });
 *   await eodhd.realTime("AAPL.US");
 *   await eodhd.fundamentals("AAPL.US", { filter: "General" });
 */
export function createEodhd(apiKey = requireKey(NAME, ENV), options: { timeout?: number; maxRetries?: number } = {}) {
  const client = new EODHDClient({ apiToken: apiKey, timeout: 15_000, maxRetries: 1, ...options });
  return Object.assign(client, { ping: () => client.realTime("AAPL.US") });
}
