/**
 * Country profile, trade and upcoming elections for an African country, from
 * Africa API, read on demand by the Country data page (/api/africa/country/<CC>).
 * Responses are cached in memory for six hours. Values are found by name, so
 * the result is a list of labelled facts and ranked lists rather than fixed fields.
 */
import "server-only";
import { createAfricaApi } from "@/lib/providers/africa-api";
import { africanCode, africanName, allRows, firstRows, httpUrl, isoDate, nameOf, number, text, type Obj } from "./read";

export type Fact = { k: string; label: string; v: string | number };
export type Ranked = { title: string; rows: { name: string; v: number; share: number | null }[] };
export type CountryDetail = { cc: string; name: string; profile: Fact[]; trade: { facts: Fact[]; lists: Ranked[]; years: string }; elections: { date: string; type: string }[]; errors: string[]; asOf: string };

const SKIP = /(^id$|_id$|^iso|code$|^slug$|url|link|image|flag|svg|png|icon|^lat|^lng$|^lon|latitude|longitude|^geo|created|updated|timestamp)/i;
export const label = (k: string) => k.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().replace(/^\w/, (c) => c.toUpperCase()).replace(/\bgdp\b/gi, "GDP").replace(/\busd\b/gi, "USD").replace(/\bpct\b/gi, "%");

/** Labelled primitive values, depth-first (depth ≤ 2), skipping ids, codes, links and timestamps. */
export function facts(body: unknown, max = 30): Fact[] {
  const out: Fact[] = []; const seen = new Set<string>();
  const walk = (o: unknown, depth: number, prefix: string) => {
    if (!o || typeof o !== "object" || Array.isArray(o) || depth > 2) return;
    for (const [k, v] of Object.entries(o as Obj)) {
      if (out.length >= max) return;
      if (SKIP.test(k)) continue;
      if (typeof v === "number" && Number.isFinite(v) || (typeof v === "string" && v.trim() && v.length <= 160 && !/^https?:/.test(v))) {
        const l = label(prefix && !["data", "profile", "overview", "summary", "country"].includes(prefix) ? `${prefix} ${k}` : k); if (seen.has(l)) continue; seen.add(l);
        out.push({ k, label: l, v: typeof v === "string" ? v.trim() : v });
      } else if (typeof v === "boolean") { /* skip flags */ }
      else if (v && typeof v === "object" && !Array.isArray(v)) walk(v, depth + 1, k);
    }
  };
  walk(body, 0, ""); return out;
}

/** Ranked lists (top partners, products) from arrays of { name, value } rows. */
export function rankedLists(body: unknown, maxRows = 8): Ranked[] {
  const out: Ranked[] = [];
  for (const { key, rows } of allRows(body)) {
    const items = rows.map((r) => ({ name: text(r, ["name", "partner", "partner_name", "country", "product", "product_name", "description", "commodity", "sector", "label"]) || nameOf(r.partner) || nameOf(r.product), v: number(r, ["value", "value_usd", "trade_value", "amount", "total", "exports", "imports", "usd"]), share: number(r, ["share", "share_pct", "percent", "percentage", "pct"]) }))
      .filter((x): x is { name: string; v: number; share: number | null } => !!x.name && x.v !== null);
    if (items.length >= 2) out.push({ title: label(key || "items"), rows: items.sort((a, b) => b.v - a.v).slice(0, maxRows) });
    if (out.length >= 6) break;
  }
  return out;
}

const cache = new Map<string, { t: number; v: CountryDetail }>();
const TTL = 6 * 3600e3;

export async function countryDetail(code: string): Promise<CountryDetail | null> {
  const cc = africanCode(code); if (!cc) return null;
  const hit = cache.get(cc); if (hit && Date.now() - hit.t < TTL) return hit.v;
  const api = createAfricaApi(); const errors: string[] = [];
  const soft = <T>(name: string, p: Promise<T>) => p.catch((e) => { errors.push(`${name}: ${String((e as Error)?.message ?? e).replace(/https?:\/\/\S+/g, "").slice(0, 160)}`); return null; });
  const y = new Date().getUTCFullYear();
  const [country, profile, trade, elections] = await Promise.all([
    soft("country", api.country(cc)), soft("profile", api.countryProfile(cc)), soft("trade", api.tradeOverview(cc, { start_year: y - 6, end_year: y, top_limit: 8 })), soft("elections", api.upcomingElections(100)),
  ]);
  if (!country && !profile && !trade) throw new Error(errors.join("; ") || "Africa API returned nothing");
  const pf = facts(profile ?? {}, 30); const base = facts(country ?? {}, 20);
  const merged = [...pf, ...base.filter((b) => !pf.some((p) => p.label === b.label))].slice(0, 36);
  const today = new Date().toISOString().slice(0, 10);
  const el = firstRows(elections ?? {}).filter((r) => africanCode(text(r, ["country_code", "iso2", "iso3", "code"]) || text(r, ["country", "country_name"]) || nameOf(r.country)) === cc)
    .map((r) => ({ date: isoDate(r.date ?? r.election_date ?? r.scheduled_date ?? r.start_date) ?? "", type: text(r, ["type", "election_type", "category", "name", "title"]) || "Election", url: httpUrl(text(r, ["url", "source_url"])) }))
    .filter((e) => e.date >= today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 6).map(({ date, type }) => ({ date, type }));
  const v: CountryDetail = {
    cc, name: africanName(cc), profile: merged,
    trade: { facts: facts(trade ?? {}, 16).filter((f) => typeof f.v === "number"), lists: rankedLists(trade ?? {}), years: `${y - 6}–${y}` },
    elections: el, errors, asOf: new Date().toISOString(),
  };
  cache.set(cc, { t: Date.now(), v }); return v;
}
