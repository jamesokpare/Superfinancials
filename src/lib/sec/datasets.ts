/**
 * SEC quarterly offering data sets (public domain, no key), built by SEC's
 * Division of Economic and Risk Analysis from the XML part of each filing:
 *
 *   Regulation Crowdfunding (Form C)  https://www.sec.gov/files/dera/data/crowdfunding-offerings-data-sets/<yyyy>q<n>_cf.zip
 *   Regulation A (Form 1-A)           https://www.sec.gov/files/dera/data/regulation-a-data-sets/<yyyy>q<n>_rega.zip
 *
 * Each zip holds tab-delimited tables joined by ACCESSION_NUMBER (submission,
 * issuer information, offering details). Column names are matched loosely,
 * because SEC has renamed a few between releases.
 */
import { ProviderError } from "@/lib/providers/http";
import { unzip } from "@/lib/macro/xlsx";

export type Offering = {
  kind: "cf" | "rega"; cik: number; acc: string; form: string; filed: string;
  name: string; city: string; state: string; web: string; founded: number | null; legal: string;
  /** Crowdfunding portal (Form C) or none. */
  platform: string;
  /** Target amount (Form C) and maximum amount sought (Form C maximum, Form 1-A total offering), USD. */
  target: number | null; offered: number | null; sold: number | null;
  security: string; price: number | null; deadline: string | null; employees: number | null; revenue: number | null;
  url: string;
};

export const DATASET_BASE = {
  cf: process.env.SEC_CF_BASE ?? "https://www.sec.gov/files/dera/data/crowdfunding-offerings-data-sets",
  rega: process.env.SEC_REGA_BASE ?? "https://www.sec.gov/files/dera/data/regulation-a-data-sets",
};
export const datasetFile = (kind: "cf" | "rega", q: string) => `${q}_${kind}.zip`;
export const datasetUrl = (kind: "cf" | "rega", q: string) => `${DATASET_BASE[kind]}/${datasetFile(kind, q)}`;

/** Tab-delimited text → rows keyed by upper-case header. */
export function parseTsv(text: string): Record<string, string>[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const head = lines[0].split("\t").map((h) => h.trim().replace(/^"|"$/g, "").toUpperCase());
  return lines.slice(1).map((l) => { const c = l.split("\t"); return Object.fromEntries(head.map((h, i) => [h, (c[i] ?? "").trim().replace(/^"|"$/g, "")])); });
}
/** First non-empty value among columns matching the patterns, tried in order. */
export function pick(row: Record<string, string> | undefined, ...pats: RegExp[]): string {
  if (!row) return "";
  for (const p of pats) for (const k of Object.keys(row)) if (p.test(k) && row[k] !== "") return row[k];
  return "";
}
const MON: Record<string, string> = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" };
/** "05-JAN-2026", "2026-01-05", "01/05/2026" (+ optional time) → "2026-01-05". */
export function isoDate(s: string): string | null {
  const t = s.trim(); let m;
  if ((m = t.match(/^(\d{4})-(\d{2})-(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = t.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})/)) && MON[m[2].toUpperCase()]) return `${m[3]}-${MON[m[2].toUpperCase()]}-${m[1].padStart(2, "0")}`;
  if ((m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/))) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return null;
}
const money = (s: string) => { const v = Number(s.replace(/[$,\s]/g, "")); return s.trim() !== "" && Number.isFinite(v) ? v : null; };

/** The table in the zip whose file name matches. */
function table(files: Map<string, Buffer>, pat: RegExp): Record<string, string>[] {
  for (const [name, buf] of files) if (pat.test(name.split("/").pop() ?? name) && /\.(tsv|txt)$/i.test(name)) return parseTsv(buf.toString("utf8"));
  return [];
}

/** Reads one quarterly zip into offerings (original filings and amendments; progress updates and reports are skipped). */
export function readDataset(kind: "cf" | "rega", zip: Buffer): Offering[] {
  const files = unzip(zip);
  const subs = table(files, /SUBMISSION/i);
  const issuers = table(files, /ISSUER/i);
  const offer = kind === "cf" ? table(files, /DISCLOSURE/i) : table(files, /OFFERING|SUMMARY/i);
  const acc = (r: Record<string, string>) => pick(r, /^ACCESSION_?NUMBER$/);
  const iss = new Map<string, Record<string, string>>();
  for (const r of issuers) { const a = acc(r); if (!a) continue; const primary = !/^N/i.test(pick(r, /PRIMARY/)); if (!iss.has(a) || primary) iss.set(a, r); }
  const off = new Map(offer.map((r) => [acc(r), r]));
  const keep = kind === "cf" ? /^C(\/A)?$/i : /^1-A(\/A)?$|^1-A POS$/i;
  const out: Offering[] = [];
  for (const s of subs) {
    const a = acc(s); const form = pick(s, /^SUBMISSION_?TYPE$/, /FORM_?TYPE/).toUpperCase(); const cik = Number(pick(s, /^CIK$/, /FILER_?CIK/)); const filed = isoDate(pick(s, /^FILING_?DATE$/, /FILED/));
    if (!a || !keep.test(form) || !cik || !filed) continue;
    const i = iss.get(a); const o = off.get(a);
    const name = pick(i, /^NAMEOFISSUER$/, /ISSUER_?NAME/, /^NAME/); if (!name) continue;
    const inc = isoDate(pick(i, /DATEINCORPORATION|INCORPORATION_?DATE|YEAR_?OF_?INC/)) ?? pick(i, /YEAR_?OF_?INC/);
    const founded = Number(String(inc).slice(0, 4)) || null;
    const max = money(pick(o, /^MAXIMUMOFFERINGAMOUNT$/, /MAXIMUM.*AMOUNT/, /TOTAL_?AGGREGATE_?OFFERING|AGGREGATE_?OFFERING/, /OFFERING_?AMOUNT/));
    out.push({
      kind, cik, acc: a, form, filed, name,
      city: pick(i, /^CITY$/, /CITY/), state: pick(i, /STATEORCOUNTRY$/, /^STATE/, /STATE/), web: pick(i, /WEBSITE/), legal: pick(i, /LEGALSTATUS|LEGAL_?ENTITY|JURISDICTION/), founded,
      platform: kind === "cf" ? pick(i, /^COMPANYNAME$/, /INTERMEDIARY.*NAME/) : "",
      target: kind === "cf" ? money(pick(o, /^OFFERINGAMOUNT$/, /TARGET/)) : null,
      offered: max, sold: money(pick(o, /AGGREGATE.*SOLD|SOLD/)),
      security: pick(o, /SECURITYOFFEREDTYPE|SECURITIES?_?OFFERED|SECURITY.*TYPE/), price: money(pick(o, /^PRICE$/, /PRICE_?PER/)),
      deadline: isoDate(pick(o, /DEADLINE/)), employees: money(pick(o, /CURRENTEMPLOYEES|EMPLOYEES/)), revenue: money(pick(o, /REVENUEMOSTRECENT|REVENUE/)),
      url: `https://www.sec.gov/Archives/edgar/data/${cik}/${a.replace(/-/g, "")}/${a}-index.htm`,
    });
  }
  return out;
}

/** Downloads one quarterly zip; null when SEC has not published it (404). */
export async function fetchDataset(kind: "cf" | "rega", q: string, ua: string): Promise<Buffer | null> {
  const url = datasetUrl(kind, q); let res: Response;
  try { res = await fetch(url, { headers: { "user-agent": ua }, signal: AbortSignal.timeout(120_000) }); }
  catch (e) { throw new ProviderError("SEC EDGAR", `request failed: ${(e as Error).message}`); }
  if (res.status === 404) return null;
  if (!res.ok) throw new ProviderError("SEC EDGAR", `HTTP ${res.status} from ${url}`, res.status);
  return Buffer.from(await res.arrayBuffer());
}

/** Last `n` quarters before the current one: ["2026q3", "2026q2", …]. */
export function pastQuarters(now: Date, n: number): string[] {
  let y = now.getUTCFullYear(), q = Math.floor(now.getUTCMonth() / 3); const out: string[] = [];
  while (out.length < n) { if (q === 0) { y--; q = 4; } out.push(`${y}q${q}`); q--; }
  return out;
}
