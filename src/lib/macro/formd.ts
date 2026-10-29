/**
 * SEC Form D: U.S. private fundraising, from EDGAR (public domain, no key).
 * Companies raising money under Regulation D must file a Form D within 15 days
 * of the first sale: issuer, industry, state, year of incorporation, amount
 * offered and amount sold. That makes it a real, daily feed of private rounds.
 *
 *   1. https://www.sec.gov/Archives/edgar/daily-index/<YYYY>/QTR<n>/form.<YYYYMMDD>.idx
 *      plain-text list of the day's filings; we take form type "D" (new filings).
 *   2. https://www.sec.gov/Archives/edgar/data/<cik>/<accession>/primary_doc.xml
 *      the Form D itself.
 *
 * SEC asks for a descriptive User-Agent with a contact address and at most 10
 * requests per second; requests here are sequential and spaced. Set
 * SEC_USER_AGENT (e.g. "Superfinancials data desk ops@example.com").
 * Pooled investment funds are skipped: Form D has no performance figures for them.
 */
import { ProviderError } from "@/lib/providers/http";

export type FormD = {
  cik: string; accession: string; filed: string; name: string; city: string; state: string; cc: string; founded: number | null;
  industry: string; sector: string; entityType: string; firstSale: string | null; offered: number | null; sold: number | null;
  equity: boolean; people: string[]; url: string;
};

export const secUserAgent = () => process.env.SEC_USER_AGENT?.trim() || "Superfinancials data sync (https://github.com/jamesokpare/Superfinancials)";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function secGet(url: string): Promise<{ status: number; text: string }> {
  let res: Response;
  try { res = await fetch(url, { headers: { "user-agent": secUserAgent(), accept: "text/plain, application/xml, */*" }, signal: AbortSignal.timeout(30_000) }); }
  catch (e) { throw new ProviderError("SEC EDGAR", `request failed: ${(e as Error).message}`); }
  return { status: res.status, text: await res.text() };
}

/** SEC industry group (Form D item 4) → the app's sectors. Pooled funds map to null (skipped). */
export const FORMD_SECTOR: Record<string, string | null> = {
  "Computers": "Technology", "Other Technology": "Technology", "Telecommunications": "Communication Services",
  "Biotechnology": "Health Care", "Pharmaceuticals": "Health Care", "Hospitals and Physicians": "Health Care", "Health Insurance": "Health Care", "Other Health Care": "Health Care",
  "Commercial Banking": "Financials", "Insurance": "Financials", "Investing": "Financials", "Investment Banking": "Financials", "Other Banking and Financial Services": "Financials", "Pooled Investment Fund": null,
  "Oil and Gas": "Energy", "Coal Mining": "Energy", "Other Energy": "Energy", "Electric Utilities": "Utilities", "Energy Conservation": "Industrials", "Environmental Services": "Industrials",
  "Commercial": "Real Estate", "REITS and Finance": "Real Estate", "Residential": "Real Estate", "Other Real Estate": "Real Estate", "Construction": "Industrials",
  "Agriculture": "Consumer Staples", "Manufacturing": "Industrials", "Business Services": "Industrials", "Retailing": "Consumer Discretionary", "Restaurants": "Consumer Discretionary",
  "Airlines and Airports": "Industrials", "Lodging and Conventions": "Consumer Discretionary", "Tourism and Travel Services": "Consumer Discretionary", "Other Travel": "Consumer Discretionary", "Other": "Unclassified",
};
const US_STATES = new Set("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR GU VI".split(" "));
/** A few EDGAR country codes for non-U.S. issuers (the rest stay blank). */
const EDGAR_CC: Record<string, string> = { X0: "UK", "2M": "DE", Z4: "CA", K3: "HK", F4: "CN", U0: "SG", L2: "IL", I0: "FR", V8: "CH", K7: "IN", M0: "JP", C3: "AU", T3: "ZA" };

const unxml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, "&").trim();
const tag = (xml: string, name: string) => { const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`)); return m ? unxml(m[1]) : ""; };
const section = (xml: string, name: string) => { const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`)); return m ? m[1] : ""; };
const amount = (s: string) => { const n = Number(s.replace(/[$,\s]/g, "")); return s && Number.isFinite(n) ? n : null; }; // "Indefinite" → null

/** Parses a Form D primary_doc.xml. */
export function parseFormD(xml: string, cik: string, accession: string, filed: string): FormD | null {
  const iss = section(xml, "primaryIssuer"); const off = section(xml, "offeringData");
  if (!iss || !off) return null;
  const addr = section(iss, "issuerAddress"); const st = tag(addr, "stateOrCountry").toUpperCase();
  const industry = tag(section(off, "industryGroup"), "industryGroupType");
  const sales = section(off, "offeringSalesAmounts"); const types = section(off, "typesOfSecuritiesOffered");
  const yr = Number(tag(section(iss, "yearOfInc"), "value"));
  const people = [...xml.matchAll(/<relatedPersonInfo>([\s\S]*?)<\/relatedPersonInfo>/g)].slice(0, 6).map((m) => {
    const n = section(m[1], "relatedPersonName"); const rel = [...m[1].matchAll(/<relationship>([^<]*)<\/relationship>/g)].map((r) => unxml(r[1])).join(", ");
    return `${[tag(n, "firstName"), tag(n, "lastName")].filter(Boolean).join(" ")}${rel ? ` (${rel})` : ""}`;
  }).filter((x) => x.trim());
  const first = tag(section(off, "dateOfFirstSale"), "value");
  return {
    cik: String(Number(cik)), accession, filed, name: tag(iss, "entityName"), city: tag(addr, "city"), state: st, cc: US_STATES.has(st) ? "US" : EDGAR_CC[st] ?? "",
    founded: Number.isFinite(yr) && yr > 1800 ? yr : null, industry, sector: industry in FORMD_SECTOR ? (FORMD_SECTOR[industry] ?? "") : "Unclassified", entityType: tag(iss, "entityType"),
    firstSale: /^\d{4}-\d{2}-\d{2}$/.test(first) ? first : null, offered: amount(tag(sales, "totalOfferingAmount")), sold: amount(tag(sales, "totalAmountSold")),
    equity: tag(types, "isEquityType") === "true", people,
    url: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, "")}/`,
  };
}

/** The day's new Form D filings from the EDGAR daily form index. null when there is no index for that day (weekend, holiday, not yet published). */
export async function formDIndex(day: string): Promise<{ cik: string; name: string; accession: string; filed: string }[] | null> {
  const [y, m] = day.split("-").map(Number); const q = Math.ceil(m / 3);
  const r = await secGet(`https://www.sec.gov/Archives/edgar/daily-index/${y}/QTR${q}/form.${day.replace(/-/g, "")}.idx`);
  if (r.status === 404 || r.status === 403 && /NoSuchKey|not found/i.test(r.text)) return null;
  if (r.status !== 200) throw new ProviderError("SEC EDGAR", `daily index ${day}: HTTP ${r.status}`, r.status);
  const out: { cik: string; name: string; accession: string; filed: string }[] = [];
  for (const line of r.text.split(/\r?\n/)) {
    const m = line.match(/^D\s{2,}(.+?)\s{2,}(\d{1,10})\s+(\d{8}|\d{4}-\d{2}-\d{2})\s+(edgar\/data\/\S+\.txt)\s*$/);
    if (!m) continue;
    const acc = m[4].match(/(\d{10}-\d{2}-\d{6})\.txt$/)?.[1]; if (!acc) continue;
    out.push({ cik: m[2], name: m[1].trim(), accession: acc, filed: m[3].length === 8 ? `${m[3].slice(0, 4)}-${m[3].slice(4, 6)}-${m[3].slice(6)}` : m[3] });
  }
  return out;
}

export async function formDFiling(x: { cik: string; accession: string; filed: string }, gapMs = 150): Promise<FormD | null> {
  await sleep(gapMs);
  const r = await secGet(`https://www.sec.gov/Archives/edgar/data/${Number(x.cik)}/${x.accession.replace(/-/g, "")}/primary_doc.xml`);
  if (r.status === 404) return null;
  if (r.status !== 200) throw new ProviderError("SEC EDGAR", `Form D ${x.accession}: HTTP ${r.status}`, r.status);
  return parseFormD(r.text, x.cik, x.accession, x.filed);
}
