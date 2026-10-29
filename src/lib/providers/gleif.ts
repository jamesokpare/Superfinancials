/**
 * GLEIF — the Global Legal Entity Identifier Foundation's public LEI register:
 * about 2.9 million legal entities in 200+ jurisdictions, each with its legal
 * name, registered address, local registration number and authority, legal
 * form, status, and direct / ultimate parent companies.
 * Docs: https://www.gleif.org/en/lei-data/gleif-api
 * Auth: none (free, open data under CC0). Limit: 60 requests per minute.
 */
import { buildUrl, getJson, type FetchOptions, type Query } from "./http";

const NAME = "GLEIF";
const BASE = "https://api.gleif.org/api/v1";

export type GleifAddress = { addressLines?: string[]; city?: string; region?: string; country?: string; postalCode?: string };
export type GleifEntity = {
  legalName?: { name?: string }; otherNames?: { name?: string; type?: string }[];
  legalAddress?: GleifAddress; headquartersAddress?: GleifAddress;
  registeredAt?: { id?: string; other?: string | null }; registeredAs?: string | null;
  jurisdiction?: string | null; category?: string | null; legalForm?: { id?: string; other?: string | null };
  status?: string | null; creationDate?: string | null; expiration?: { date?: string | null; reason?: string | null };
};
export type GleifRecord = { id: string; attributes: { lei: string; entity: GleifEntity; registration: { initialRegistrationDate?: string; lastUpdateDate?: string; status?: string; nextRenewalDate?: string; corroborationLevel?: string }; bic?: string[] | null } };
export type GleifList = { data: GleifRecord[]; meta?: { pagination?: { total?: number } } };

export function createGleif(opts: FetchOptions = {}) {
  const get = <T = unknown>(path: string, params: Query = {}) => getJson<T>(NAME, buildUrl(BASE, path, params), { ...opts, init: { ...opts.init, headers: { ...opts.init?.headers, accept: "application/vnd.api+json" } } });
  const rec = (lei: string) => `/lei-records/${encodeURIComponent(lei.trim().toUpperCase())}`;
  return {
    get,
    /** Full-text search over names, numbers and addresses; `country` is ISO 3166-1 alpha-2 (legal address). */
    search: (q: string, size = 20, country?: string) => get<GleifList>("/lei-records", { "filter[fulltext]": q, "filter[entity.legalAddress.country]": country, "page[size]": size }),
    record: (lei: string) => get<{ data: GleifRecord }>(rec(lei)),
    /** 404 when the entity reports no parent (or has an exception instead). */
    parent: (lei: string, level: "direct" | "ultimate") => get<{ data: GleifRecord }>(`${rec(lei)}/${level}-parent`),
    children: (lei: string, size = 20) => get<GleifList>(`${rec(lei)}/direct-children`, { "page[size]": size }),
    authority: (id: string) => get<{ data: { attributes: { internationalName?: string | null; localName?: string | null; internationalOrganizationName?: string | null; localOrganizationName?: string | null; website?: string | null } } }>(`/registration-authorities/${encodeURIComponent(id)}`),
    ping: () => get<GleifList>("/lei-records", { "page[size]": 1 }),
  };
}
