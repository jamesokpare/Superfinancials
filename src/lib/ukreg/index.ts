/**
 * UK company register (Companies House): search and company profiles in a
 * compact shape for the app's "UK company register" page. Results are cached
 * in memory for an hour so repeat views do not spend the key's limit
 * (600 requests per 5 minutes).
 */
import "server-only";
import { createCompaniesHouse } from "@/lib/providers/companies-house";

type Obj = Record<string, unknown>;
const o = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const a = (v: unknown) => (Array.isArray(v) ? (v as Obj[]) : []);
const s = (v: unknown) => (v === null || v === undefined ? null : String(v));
const FIND = "https://find-and-update.company-information.service.gov.uk";

/** "accounts-with-accounts-type-full" → "Accounts with accounts type full". */
const humanize = (k: unknown) => { const t = String(k ?? "").replace(/[-_]+/g, " ").trim(); return t ? t[0].toUpperCase() + t.slice(1) : ""; };
export const address = (v: unknown) => {
  const x = o(v);
  return [x.care_of, x.po_box, x.premises, x.address_line_1, x.address_line_2, x.locality, x.region, x.postal_code, x.country].filter(Boolean).map(String).join(", ");
};
/** Normalizes a company number: upper case, zero-padded to 8 characters when numeric. */
export function companyNumber(raw: string): string | null {
  const n = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (/^\d{1,8}$/.test(n)) return n.padStart(8, "0");
  return /^[A-Z]{2}\d{6}$/.test(n) ? n : null;
}

// --- cache ------------------------------------------------------------------------
const CACHE = new Map<string, { at: number; v: unknown }>();
const TTL = 60 * 60e3;
async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = CACHE.get(key); if (hit && Date.now() - hit.at < TTL) return hit.v as T;
  const v = await fn(); CACHE.set(key, { at: Date.now(), v });
  if (CACHE.size > 500) CACHE.delete(CACHE.keys().next().value!);
  return v;
}

export type UkSearchItem = { number: string; name: string; status: string | null; type: string | null; created: string | null; ceased: string | null; address: string };
export async function searchCompanies(q: string, n = 20): Promise<{ total: number; items: UkSearchItem[] }> {
  return cached(`s:${q.toLowerCase()}:${n}`, async () => {
    const r = await createCompaniesHouse().searchCompanies(q, n);
    return {
      total: Number(r.total_results) || 0,
      items: a(r.items).map((x) => ({ number: String(x.company_number), name: String(x.title ?? ""), status: s(x.company_status), type: s(x.company_type), created: s(x.date_of_creation), ceased: s(x.date_of_cessation), address: s(x.address_snippet) ?? address(x.address) })),
    };
  });
}

/** Profile, officers, people with significant control, recent filings and charges, fetched in parallel. */
export async function companyDetail(number: string) {
  return cached(`c:${number}`, async () => {
    const ch = createCompaniesHouse();
    const soft = <T>(p: Promise<T>) => p.catch(() => null);
    const [p, off, psc, fil, chg] = await Promise.all([
      ch.company(number), soft(ch.officers(number, 50)), soft(ch.psc(number)), soft(ch.filingHistory(number, undefined, 25)), soft(ch.charges(number)),
    ]) as [Obj, Obj | null, Obj | null, Obj | null, Obj | null];
    const acc = o(p.accounts), conf = o(p.confirmation_statement);
    return {
      number, link: `${FIND}/company/${number}`,
      profile: {
        name: String(p.company_name ?? ""), status: s(p.company_status), statusDetail: s(p.company_status_detail), type: s(p.type), jurisdiction: s(p.jurisdiction),
        created: s(p.date_of_creation), ceased: s(p.date_of_cessation), address: address(p.registered_office_address), sic: Array.isArray(p.sic_codes) ? p.sic_codes.map(String) : [],
        accounts: { nextDue: s(acc.next_due), lastMadeUpTo: s(o(acc.last_accounts).made_up_to), type: s(o(acc.last_accounts).type), overdue: !!acc.overdue },
        confirmation: { nextDue: s(conf.next_due), lastMadeUpTo: s(conf.last_made_up_to), overdue: !!conf.overdue },
        previousNames: a(p.previous_company_names).map((x) => ({ name: String(x.name ?? ""), from: s(x.effective_from), to: s(x.ceased_on) })),
        hasCharges: !!p.has_charges, hasInsolvency: !!p.has_insolvency_history, liquidated: !!p.has_been_liquidated,
      },
      officers: off ? {
        active: Number(off.active_count) || 0, resigned: Number(off.resigned_count) || 0,
        items: a(off.items).map((x) => ({ name: String(x.name ?? ""), role: humanize(x.officer_role), appointed: s(x.appointed_on), resigned: s(x.resigned_on), nationality: s(x.nationality), occupation: s(x.occupation), country: s(x.country_of_residence) })),
      } : null,
      psc: psc ? a(psc.items).map((x) => ({ name: String(x.name ?? ""), kind: humanize(x.kind), natures: a(x.natures_of_control).map(humanize), notified: s(x.notified_on), ceased: s(x.ceased_on), nationality: s(x.nationality), country: s(x.country_of_residence) })) : null,
      filings: fil ? a(fil.items).map((x) => {
        const tx = s(x.transaction_id); const dv = o(x.description_values);
        return { date: s(x.date), category: humanize(x.category), type: s(x.type), description: humanize(x.description) + (dv.made_up_date ? ` (made up to ${dv.made_up_date})` : ""), doc: tx && o(x.links).document_metadata ? `${FIND}/company/${number}/filing-history/${tx}/document?format=pdf&download=0` : null };
      }) : null,
      charges: chg ? {
        total: Number(chg.total_count) || 0, outstanding: Number(chg.unfiltered_count ?? chg.total_count) - (Number(chg.satisfied_count) || 0) - (Number(chg.part_satisfied_count) || 0),
        items: a(chg.items).map((x) => ({ status: humanize(x.status), created: s(x.created_on), delivered: s(x.delivered_on), satisfied: s(x.satisfied_on), classification: s(o(x.classification).description), entitled: a(x.persons_entitled).map((y) => String(y.name ?? "")) })),
      } : null,
    };
  });
}
export type UkCompany = Awaited<ReturnType<typeof companyDetail>>;
