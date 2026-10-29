/**
 * Currents API — latest and searchable news from 70+ countries in 18
 * languages. Uses Currents' official Node.js client (npm: currentsapi).
 * Docs: https://currentsapi.services/en/docs/
 * Auth: the key is sent in the Authorization header by the SDK.
 */
import CurrentsAPI from "currentsapi";
import { requireKey } from "./http";

export const ENV = "CURRENTS_API_KEY";
const NAME = "Currents API";

/**
 * e.g. createCurrents().latestNews({ language: "en", category: "finance" })
 *      createCurrents().search({ keywords: "naira", country: "NG", start_date: "2026-10-01" })
 */
export function createCurrents(apiKey = requireKey(NAME, ENV)) {
  const client = new CurrentsAPI(apiKey);
  return Object.assign(client, { ping: () => client.latestNews({ language: "en" }) });
}
