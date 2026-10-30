/**
 * UK Companies House — company profiles, officers, filing history and people
 * with significant control.
 * Docs: https://developer-specs.company-information.service.gov.uk/
 * Auth: HTTP Basic, with the API key as the username and an empty password.
 * Limit: 600 requests per 5 minutes per key.
 */
import { buildUrl, getJson, requireKey, type FetchOptions, type Query } from "./http";

export const ENV = "COMPANIES_HOUSE_API_KEY";
const NAME = "Companies House";
const BASE = "https://api.company-information.service.gov.uk";

export type ChSearchItem = { company_number: string; title: string; company_status: string; company_type: string; date_of_creation?: string; address_snippet?: string };
export type ChSearch = { items: ChSearchItem[]; total_results: number; items_per_page: number; start_index: number };
export type ChCompany = { company_number: string; company_name: string; company_status: string; type: string; date_of_creation?: string; sic_codes?: string[]; registered_office_address?: Record<string, string>; accounts?: Record<string, unknown>; confirmation_statement?: Record<string, unknown> };

export function createCompaniesHouse(apiKey = requireKey(NAME, ENV), opts: FetchOptions = {}) {
  const auth = "Basic " + Buffer.from(`${apiKey}:`).toString("base64");
  /** Call any endpoint, e.g. get("/company/00000006/charges"). */
  const get = <T = unknown>(path: string, params: Query = {}) =>
    getJson<T>(NAME, buildUrl(BASE, path, params), { ...opts, init: { ...opts.init, headers: { ...opts.init?.headers, authorization: auth } } });
  const co = (n: string) => `/company/${encodeURIComponent(n.trim().toUpperCase())}`;

  return {
    get,
    searchCompanies: (q: string, itemsPerPage = 20, startIndex = 0) => get<ChSearch>("/search/companies", { q, items_per_page: itemsPerPage, start_index: startIndex }),
    searchOfficers: (q: string, itemsPerPage = 20) => get("/search/officers", { q, items_per_page: itemsPerPage }),
    /** Every company an officer is or was appointed to (officer ids come from search results and company officer lists). */
    appointments: (officerId: string, itemsPerPage = 50) => get(`/officers/${encodeURIComponent(officerId)}/appointments`, { items_per_page: itemsPerPage }),
    company: (number: string) => get<ChCompany>(co(number)),
    officers: (number: string, itemsPerPage = 35) => get(`${co(number)}/officers`, { items_per_page: itemsPerPage }),
    filingHistory: (number: string, category?: string, itemsPerPage = 25) => get(`${co(number)}/filing-history`, { category, items_per_page: itemsPerPage }),
    psc: (number: string) => get(`${co(number)}/persons-with-significant-control`),
    charges: (number: string) => get(`${co(number)}/charges`),
    ping: () => get<ChSearch>("/search/companies", { q: "tesco", items_per_page: 1 }),
  };
}
