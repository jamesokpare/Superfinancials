/**
 * Global company register: one search across the live registers this server
 * can reach, in a compact shape for the app's "Company registry" page.
 *
 *   uk   Companies House (UK), when COMPANIES_HOUSE_API_KEY is set
 *   lei  GLEIF, the worldwide LEI register (no key needed)
 *   no   Norway, Brønnøysund Register Centre (no key; NLOD 2.0)
 *   fr   France, recherche-entreprises.api.gouv.fr (no key; Licence Ouverte 2.0)
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

export type RegItem = { src: "uk" | "lei" | "no" | "fr"; id: string; name: string; cc: string | null; number: string | null; status: string | null; type: string | null; created: string | null; address: string; lei?: string };
export type SourceState = { total: number } | { error: string } | { off: string };
const UA = { "user-agent": "Superfinancials company registry (https://github.com/jamesokpare/Superfinancials)", accept: "application/json" };
const get = async <T,>(name: string, url: string) => { const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20_000) }); if (r.status === 404) throw Object.assign(new Error(`${name}: not found`), { status: 404 }); if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`); return (await r.json()) as T; };

// --- Norway (Brønnøysund Register Centre, Enhetsregisteret) -----------------------------------------
type Brreg = { organisasjonsnummer: string; navn?: string; organisasjonsform?: { kode?: string; beskrivelse?: string }; forretningsadresse?: { adresse?: string[]; postnummer?: string; poststed?: string; land?: string }; stiftelsesdato?: string; registreringsdatoEnhetsregisteret?: string; naeringskode1?: { kode?: string; beskrivelse?: string }; antallAnsatte?: number; hjemmeside?: string; konkurs?: boolean; underAvvikling?: boolean; underTvangsavviklingEllerTvangsopplosning?: boolean; slettedato?: string; registrertIMvaregisteret?: boolean };
const noStatus = (x: Brreg) => (x.slettedato ? "Deleted" : x.konkurs ? "Bankrupt" : x.underAvvikling || x.underTvangsavviklingEllerTvangsopplosning ? "In liquidation" : "Active");
const noAddr = (x: Brreg) => { const a = x.forretningsadresse; return a ? [...(a.adresse ?? []), [a.postnummer, a.poststed].filter(Boolean).join(" "), a.land].filter(Boolean).join(", ") : ""; };
const noItem = (x: Brreg): RegItem => ({ src: "no", id: x.organisasjonsnummer, name: x.navn ?? "", cc: "NO", number: x.organisasjonsnummer, status: noStatus(x), type: x.organisasjonsform?.beskrivelse ?? null, created: x.stiftelsesdato ?? x.registreringsdatoEnhetsregisteret ?? null, address: noAddr(x) });
async function searchNorway(q: string, n: number) {
  const r = await get<{ _embedded?: { enheter?: Brreg[] }; page?: { totalElements?: number } }>("Brønnøysund", `https://data.brreg.no/enhetsregisteret/api/enheter?${/^\d{9}$/.test(q.replace(/\s/g, "")) ? `organisasjonsnummer=${q.replace(/\s/g, "")}` : `navn=${encodeURIComponent(q)}`}&size=${n}`);
  return { total: Number(r.page?.totalElements) || 0, items: (r._embedded?.enheter ?? []).map(noItem) };
}
export async function norwayDetail(orgnr: string) {
  return cached(`no:${orgnr}`, async () => {
    const x = await get<Brreg>("Brønnøysund", `https://data.brreg.no/enhetsregisteret/api/enheter/${encodeURIComponent(orgnr)}`);
    return { src: "no" as const, id: orgnr, link: `https://data.brreg.no/enhetsregisteret/oppslag/enheter/${orgnr}`, name: x.navn ?? "", cc: "NO", number: orgnr, status: noStatus(x), type: x.organisasjonsform?.beskrivelse ?? null, created: x.stiftelsesdato ?? null, registered: x.registreringsdatoEnhetsregisteret ?? null, address: noAddr(x),
      industry: x.naeringskode1 ? `${x.naeringskode1.kode} ${x.naeringskode1.beskrivelse ?? ""}`.trim() : null, employees: x.antallAnsatte ?? null, web: x.hjemmeside ? (/^https?:/.test(x.hjemmeside) ? x.hjemmeside : `https://${x.hjemmeside}`) : null, officers: [] as { name: string; role: string; since: string | null }[],
      registry: "Brønnøysund Register Centre (Enhetsregisteret)", licence: "Norwegian Licence for Open Government Data (NLOD) 2.0" };
  });
}

// --- France (recherche-entreprises.api.gouv.fr: SIRENE + RNE) ------------------------------------------
type FrDir = { nom?: string; prenoms?: string; denomination?: string; qualite?: string; type_dirigeant?: string; annee_de_naissance?: string };
type Fr = { siren: string; nom_complet?: string; nom_raison_sociale?: string; siege?: { adresse?: string; geo_adresse?: string; libelle_commune?: string; code_postal?: string; activite_principale?: string }; activite_principale?: string; nature_juridique?: string; date_creation?: string; date_fermeture?: string | null; etat_administratif?: string; tranche_effectif_salarie?: string; dirigeants?: FrDir[]; categorie_entreprise?: string };
const frItem = (x: Fr): RegItem => ({ src: "fr", id: x.siren, name: x.nom_complet ?? x.nom_raison_sociale ?? "", cc: "FR", number: x.siren, status: x.etat_administratif === "C" ? "Closed" : "Active", type: x.categorie_entreprise ? `${x.categorie_entreprise} (nature juridique ${x.nature_juridique ?? "—"})` : x.nature_juridique ?? null, created: x.date_creation ?? null, address: x.siege?.adresse ?? x.siege?.geo_adresse ?? "" });
async function searchFrance(q: string, n: number) {
  const r = await get<{ results?: Fr[]; total_results?: number }>("recherche-entreprises", `https://recherche-entreprises.api.gouv.fr/search?q=${encodeURIComponent(q)}&per_page=${Math.min(25, n)}`);
  return { total: Number(r.total_results) || 0, items: (r.results ?? []).map(frItem) };
}
export async function franceDetail(siren: string) {
  return cached(`fr:${siren}`, async () => {
    const r = await get<{ results?: Fr[] }>("recherche-entreprises", `https://recherche-entreprises.api.gouv.fr/search?q=${encodeURIComponent(siren)}&per_page=5`);
    const x = (r.results ?? []).find((y) => y.siren === siren); if (!x) throw Object.assign(new Error("not found"), { status: 404 });
    return { src: "fr" as const, id: siren, link: `https://annuaire-entreprises.data.gouv.fr/entreprise/${siren}`, name: x.nom_complet ?? "", cc: "FR", number: siren, status: x.etat_administratif === "C" ? "Closed" : "Active", type: x.nature_juridique ? `Nature juridique ${x.nature_juridique}` : null, created: x.date_creation ?? null, registered: null, address: x.siege?.adresse ?? "",
      industry: x.activite_principale ? `NAF ${x.activite_principale}` : null, employees: null, web: null,
      officers: (x.dirigeants ?? []).slice(0, 30).map((d) => ({ name: d.denomination ?? [d.prenoms, d.nom].filter(Boolean).join(" "), role: d.qualite ?? "", since: null })),
      registry: "Répertoire SIRENE (INSEE) and Registre national des entreprises (INPI)", licence: "Licence Ouverte / Etalab 2.0" };
  });
}
export type NationalCompany = Awaited<ReturnType<typeof norwayDetail>>;

function leiItem(r: GleifRecord): RegItem {
  const e = r.attributes.entity;
  return { src: "lei", id: r.attributes.lei, lei: r.attributes.lei, name: e.legalName?.name ?? "", cc: e.legalAddress?.country ?? e.jurisdiction?.slice(0, 2) ?? null, number: e.registeredAs ?? null, status: leiStatus(e), type: e.legalForm?.other || null, created: e.creationDate?.slice(0, 10) ?? null, address: addr(e.legalAddress) };
}

/** Searches every live register in parallel. One failing source does not fail the others. */
export async function searchRegistry(q: string, { n = 20, cc }: { n?: number; cc?: string } = {}) {
  const iso = isoCountry(cc);
  return cached(`r:${q.toLowerCase()}:${n}:${iso ?? ""}`, async () => {
    const ukOn = !!envKey("COMPANIES_HOUSE_API_KEY") && (!iso || iso === "GB");
    const noOn = !iso || iso === "NO", frOn = !iso || iso === "FR";
    const [uk, lei, no, fr] = await Promise.allSettled([
      ukOn ? searchCompanies(q, n) : Promise.resolve(null),
      createGleif().search(q, n, iso),
      noOn ? searchNorway(q, Math.min(n, 10)) : Promise.resolve(null),
      frOn ? searchFrance(q, Math.min(n, 10)) : Promise.resolve(null),
    ]);
    const nat = (on: boolean, r: PromiseSettledResult<{ total: number; items: RegItem[] } | null>): SourceState => (!on ? { off: "Not searched for this country" } : r.status === "fulfilled" ? { total: r.value!.total } : { error: msg(r.reason) });
    const sources: Record<"uk" | "lei" | "no" | "fr", SourceState> = {
      no: nat(noOn, no), fr: nat(frOn, fr),
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
    const natItems = [no, fr].flatMap((r) => (r.status === "fulfilled" && r.value ? r.value.items : []));
    // A Norwegian or French company that also holds an LEI appears once, as its national record with the LEI attached.
    const natNo = new Map(natItems.map((x) => [`${x.cc}|${x.number}`, x]));
    const leiLeft = leiItems.filter((x) => { const twin = x.number ? natNo.get(`${x.cc === "GB" ? "UK" : x.cc}|${x.number.replace(/\s/g, "")}`) : undefined; if (twin) { twin.lei = x.lei; return false; } return true; });
    return { items: [...ukItems, ...natItems, ...leiLeft], sources };
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
