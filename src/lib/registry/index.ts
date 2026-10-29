/**
 * Global company register: one search across the live registers this server
 * can reach, in a compact shape for the app's "Company registry" page.
 *
 *   uk   Companies House (UK), when COMPANIES_HOUSE_API_KEY is set
 *   lei  GLEIF, the worldwide LEI register (no key needed)
 *
 * Companies the developer adds in the Data studio live in the shared database
 * (adm_reg) and are searched in the browser, so they are not part of this.
 * Results are cached in memory for an hour.
 */
import "server-only";
import { envKey } from "@/lib/providers/http";
import { createGleif, type GleifAddress, type GleifRecord } from "@/lib/providers/gleif";
import { searchCompanies } from "@/lib/ukreg";

const CACHE = new Map<string, { at: number; v: unknown }>();
const TTL = 60 * 60e3;
async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = CACHE.get(key); if (hit && Date.now() - hit.at < TTL) return hit.v as T;
  const v = await fn(); CACHE.set(key, { at: Date.now(), v });
  if (CACHE.size > 500) CACHE.delete(CACHE.keys().next().value!);
  return v;
}

/** LEI: 18 letters/digits then 2 check digits (ISO 17442). */
export function leiCode(raw: string): string | null {
  const n = raw.trim().toUpperCase().replace(/\s+/g, "");
  return /^[A-Z0-9]{18}\d{2}$/.test(n) ? n : null;
}
/** The app calls the United Kingdom "UK"; registers use ISO "GB". */
export const isoCountry = (cc?: string | null) => { const c = String(cc ?? "").trim().toUpperCase(); return c === "UK" ? "GB" : /^[A-Z]{2}$/.test(c) ? c : undefined; };

const addr = (a?: GleifAddress) => a ? [...(a.addressLines ?? []), a.city, a.region, a.postalCode, a.country].filter(Boolean).join(", ") : "";
const titled = (s?: string | null) => (s ? s.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()) : null);
/** ACTIVE, or the reason an inactive entity ended (e.g. "Dissolved"). */
const leiStatus = (e: GleifRecord["attributes"]["entity"]) => e.status === "INACTIVE" ? titled(e.expiration?.reason) || "Inactive" : titled(e.status) || null;

export type RegItem = { src: "uk" | "lei"; id: string; name: string; cc: string | null; number: string | null; status: string | null; type: string | null; created: string | null; address: string; lei?: string };
export type SourceState = { total: number } | { error: string } | { off: string };

function leiItem(r: GleifRecord): RegItem {
  const e = r.attributes.entity;
  return { src: "lei", id: r.attributes.lei, lei: r.attributes.lei, name: e.legalName?.name ?? "", cc: e.legalAddress?.country ?? e.jurisdiction?.slice(0, 2) ?? null, number: e.registeredAs ?? null, status: leiStatus(e), type: e.legalForm?.other || null, created: e.creationDate?.slice(0, 10) ?? null, address: addr(e.legalAddress) };
}

/** Searches every live register in parallel. One failing source does not fail the others. */
export async function searchRegistry(q: string, { n = 20, cc }: { n?: number; cc?: string } = {}) {
  const iso = isoCountry(cc);
  return cached(`r:${q.toLowerCase()}:${n}:${iso ?? ""}`, async () => {
    const ukOn = !!envKey("COMPANIES_HOUSE_API_KEY") && (!iso || iso === "GB");
    const [uk, lei] = await Promise.allSettled([
      ukOn ? searchCompanies(q, n) : Promise.resolve(null),
      createGleif().search(q, n, iso),
    ]);
    const sources: Record<"uk" | "lei", SourceState> = {
      uk: !ukOn ? { off: iso && iso !== "GB" ? "UK register not searched for this country" : "Companies House is not connected on this server" } : uk.status === "fulfilled" ? { total: uk.value!.total } : { error: msg(uk.reason) },
      lei: lei.status === "fulfilled" ? { total: Number(lei.value.meta?.pagination?.total) || lei.value.data.length } : { error: msg(lei.reason) },
    };
    const ukItems: RegItem[] = uk.status === "fulfilled" && uk.value ? uk.value.items.map((x) => ({ src: "uk", id: x.number, name: x.name, cc: "GB", number: x.number, status: x.status, type: x.type, created: x.created, address: x.address })) : [];
    // A UK company that also holds an LEI appears once, as its UK record with the LEI attached.
    const byNo = new Map(ukItems.map((x) => [x.number, x]));
    const leiItems = (lei.status === "fulfilled" ? lei.value.data : []).map(leiItem).filter((x) => {
      const twin = x.cc === "GB" && x.number ? byNo.get(x.number.toUpperCase().padStart(8, "0")) : undefined;
      if (twin) { twin.lei = x.lei; return false; }
      return true;
    });
    return { items: [...ukItems, ...leiItems], sources };
  });
}
const msg = (e: unknown) => String((e as Error)?.message ?? e).replace(/https?:\/\/\S+/g, "").slice(0, 200);

/** One LEI record with its registration authority, parents and subsidiaries (each fetched softly). */
export async function leiDetail(lei: string) {
  return cached(`l:${lei}`, async () => {
    const g = createGleif(); const soft = <T>(p: Promise<T>) => p.catch(() => null);
    const { data: r } = await g.record(lei);
    const e = r.attributes.entity, reg = r.attributes.registration;
    const [ra, dp, up, ch] = await Promise.all([
      e.registeredAt?.id && e.registeredAt.id !== "RA999999" ? soft(g.authority(e.registeredAt.id)) : null,
      soft(g.parent(lei, "direct")), soft(g.parent(lei, "ultimate")), soft(g.children(lei, 25)),
    ]);
    const a = ra?.data.attributes;
    const rel = (x: { data: GleifRecord } | null) => (x ? leiItem(x.data) : null);
    return {
      lei, link: `https://search.gleif.org/#/record/${lei}`,
      profile: {
        name: e.legalName?.name ?? "", otherNames: (e.otherNames ?? []).map((x) => ({ name: x.name ?? "", type: titled(x.type) })),
        status: leiStatus(e), cc: e.legalAddress?.country ?? null, jurisdiction: e.jurisdiction ?? null, category: titled(e.category), legalForm: e.legalForm?.other || e.legalForm?.id || null,
        number: e.registeredAs ?? null, created: e.creationDate?.slice(0, 10) ?? null, ended: e.expiration?.date?.slice(0, 10) ?? null,
        legalAddress: addr(e.legalAddress), hqAddress: addr(e.headquartersAddress),
        registry: a ? (a.internationalName || a.localName || a.internationalOrganizationName || a.localOrganizationName || e.registeredAt?.id) ?? null : e.registeredAt?.other || null,
        registryWeb: a?.website && /^https?:\/\//.test(a.website) ? a.website : null,
        bic: r.attributes.bic ?? [],
      },
      registration: { status: titled(reg.status), first: reg.initialRegistrationDate?.slice(0, 10) ?? null, updated: reg.lastUpdateDate?.slice(0, 10) ?? null, renewal: reg.nextRenewalDate?.slice(0, 10) ?? null, corroboration: titled(reg.corroborationLevel) },
      directParent: rel(dp), ultimateParent: rel(up),
      children: ch ? { total: Number(ch.meta?.pagination?.total) || ch.data.length, items: ch.data.map(leiItem) } : null,
    };
  });
}
export type LeiCompany = Awaited<ReturnType<typeof leiDetail>>;
