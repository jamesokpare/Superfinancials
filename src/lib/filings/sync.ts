/**
 * SEC EDGAR filings for the app's U.S. equities (public domain, no key):
 *
 *   filings/EQ.<TK>   { type: "filings", id, tk, cik, name, checked, items: Filing[] }
 *   filings/_meta     { type: "meta", checked, n, note, state: { cik: { <TK>: cik }, cikAt } }
 *
 * Sources:
 *   https://www.sec.gov/files/company_tickers.json             ticker → CIK (refreshed weekly)
 *   https://data.sec.gov/submissions/CIK<10 digits>.json        each company's recent filings
 *   https://www.sec.gov/Archives/edgar/data/<cik>/<acc>/index.json   files of one filing, to find
 *                                                                    the press release (exhibit 99.1)
 * Kept: annual and quarterly reports, current reports (8-K, with their item codes),
 * proxy statements and registration statements of the last two years, up to 40 a
 * company. 8-Ks with item 2.02 (results of operations) are earnings releases: the
 * exhibit with the press release is looked up once and kept.
 * SEC asks for a User-Agent with a contact address (SEC_USER_AGENT) and at most
 * 10 requests a second; requests here are sequential and spaced.
 */
import "server-only";
import { ProviderError } from "@/lib/providers/http";
import { scrub } from "@/lib/providers";
import { US_EQUITIES } from "@/lib/market/instruments";
import { openStore, type Doc, type DocStore } from "@/lib/market/store";
import { contactUA } from "@/lib/macro/sources";

export type Filing = {
  form: string; date: string; period: string | null; acc: string;
  /** Primary document and the filing index on sec.gov. */
  url: string; index: string;
  desc: string;
  /** 8-K item codes, e.g. ["2.02", "9.01"]. */
  items: string[];
  /** An earnings release (8-K item 2.02). */
  earn?: boolean;
  /** The press release exhibit (99.1), when found. */
  ex?: string | null;
};

export const FORMS = new Set(["10-K", "10-K/A", "10-Q", "10-Q/A", "8-K", "8-K/A", "20-F", "40-F", "6-K", "DEF 14A", "S-1", "S-3", "S-4", "424B5", "SC 13D", "SC 13G"]);
/** Readable names for the 8-K items people look for. */
export const ITEMS: Record<string, string> = {
  "1.01": "Material agreement", "1.02": "Agreement terminated", "1.03": "Bankruptcy", "2.01": "Acquisition or disposition completed", "2.02": "Results of operations",
  "2.03": "New debt obligation", "2.05": "Restructuring costs", "2.06": "Impairment", "3.01": "Listing notice", "3.02": "Unregistered share sale", "4.01": "Auditor change",
  "4.02": "Restatement", "5.01": "Change in control", "5.02": "Director or officer change", "5.03": "Bylaws or fiscal year change", "5.07": "Shareholder vote results",
  "7.01": "Regulation FD disclosure", "8.01": "Other events", "9.01": "Financial statements and exhibits",
};
const FORM_NAME: Record<string, string> = { "10-K": "Annual report", "10-Q": "Quarterly report", "8-K": "Current report", "20-F": "Annual report (foreign issuer)", "40-F": "Annual report (Canadian issuer)", "6-K": "Current report (foreign issuer)", "DEF 14A": "Proxy statement", "S-1": "Registration statement", "S-3": "Shelf registration", "S-4": "Registration (merger)", "424B5": "Prospectus supplement", "SC 13D": "Beneficial ownership (activist)", "SC 13G": "Beneficial ownership (passive)" };

const COL = "filings";
const DAY = 864e5;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const gapMs = () => Number(process.env.SEC_GAP_MS ?? 150);

async function secJson<T>(url: string, ua: string): Promise<T> {
  let res: Response;
  try { res = await fetch(url, { headers: { "user-agent": ua, accept: "application/json" }, signal: AbortSignal.timeout(30_000) }); }
  catch (e) { throw new ProviderError("SEC EDGAR", `request failed: ${(e as Error).message}`); }
  if (!res.ok) throw new ProviderError("SEC EDGAR", `HTTP ${res.status} from ${url}`, res.status);
  return (await res.json()) as T;
}

/** A filing's description: the form's name, plus 8-K items. */
export function describe(form: string, items: string[], primaryDesc: string): string {
  const base = FORM_NAME[form.replace(/\/A$/, "")] ?? (primaryDesc || form);
  const named = items.map((i) => ITEMS[i]).filter((x): x is string => !!x && x !== ITEMS["9.01"]);
  return `${base}${form.endsWith("/A") ? " (amendment)" : ""}${named.length ? `: ${named.join("; ")}` : ""}`;
}

type Recent = { accessionNumber?: string[]; filingDate?: string[]; reportDate?: string[]; form?: string[]; items?: string[]; primaryDocument?: string[]; primaryDocDescription?: string[] };
/** Recent filings of interest from a submissions response, newest first. */
export function readSubmissions(cik: number, sub: { filings?: { recent?: Recent } }, since: string, max = 40): Filing[] {
  const r = sub.filings?.recent ?? {}; const n = r.accessionNumber?.length ?? 0; const out: Filing[] = [];
  for (let i = 0; i < n && out.length < max; i++) {
    const form = String(r.form?.[i] ?? ""); const date = String(r.filingDate?.[i] ?? ""); const acc = String(r.accessionNumber?.[i] ?? "");
    if (!FORMS.has(form) || !acc || date < since) continue;
    const items = String(r.items?.[i] ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    const folder = `https://www.sec.gov/Archives/edgar/data/${cik}/${acc.replace(/-/g, "")}`;
    const doc = String(r.primaryDocument?.[i] ?? "");
    out.push({ form, date, period: r.reportDate?.[i] || null, acc, url: doc ? `${folder}/${doc}` : `${folder}/`, index: `${folder}/${acc}-index.htm`, desc: describe(form, items, String(r.primaryDocDescription?.[i] ?? "")), items, ...(form.startsWith("8-K") && items.includes("2.02") ? { earn: true, ex: null } : {}) });
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/** The press-release exhibit (99.1, else the first 99.x) in a filing's file list. */
export function pickExhibit(files: { name?: string; type?: string }[]): string | null {
  const names = files.map((f) => String(f.name ?? "")).filter((n) => /\.(htm|html|txt|pdf)$/i.test(n));
  return names.find((n) => /ex-?99[._-]?0?1\b|ex991|exhibit-?99-?1\b|dex991/i.test(n)) ?? names.find((n) => /ex-?99|exhibit-?99/i.test(n)) ?? null;
}

export type FilingsReport = { dryRun: boolean; updated: string[]; failed: { tk: string; error: string }[]; exhibits: number; note: string };

export async function runFilingsSync(opts: { store?: DocStore; dryRun?: boolean; now?: Date; only?: string[]; exhibitBudget?: number } = {}): Promise<FilingsReport> {
  const ua = contactUA(); if (!ua) throw new ProviderError("SEC EDGAR", "Set SEC_USER_AGENT to \"Company contact@domain\" (SEC requires a contact address)");
  const now = opts.now ?? new Date(); const checked = now.toISOString(); const since = new Date(now.getTime() - 730 * DAY).toISOString().slice(0, 10);
  const store = opts.store ?? openStore();
  const docs = new Map((await store.list(COL)).map((d) => [d.id, d.data]));
  const meta = docs.get("_meta"); const state = { cik: {} as Record<string, number>, cikAt: "", ...((meta?.state as object | undefined) ?? {}) } as { cik: Record<string, number>; cikAt: string };
  const tks = US_EQUITIES.split(" ").filter((t) => !opts.only || opts.only.includes(t));

  // Ticker → CIK, refreshed weekly (or when a ticker is missing).
  if (!state.cikAt || now.getTime() - Date.parse(state.cikAt) > 7 * DAY || tks.some((t) => !state.cik[t])) {
    const all = await secJson<Record<string, { cik_str: number; ticker: string }>>("https://www.sec.gov/files/company_tickers.json", ua);
    const map: Record<string, number> = {}; for (const x of Object.values(all)) map[String(x.ticker).toUpperCase()] = Number(x.cik_str);
    state.cik = Object.fromEntries(US_EQUITIES.split(" ").filter((t) => map[t]).map((t) => [t, map[t]])); state.cikAt = checked;
  }

  const updated: string[] = []; const failed: FilingsReport["failed"] = []; const writes: Doc[] = []; let exLeft = opts.exhibitBudget ?? Number(process.env.SEC_EXHIBIT_BUDGET ?? 40); let exhibits = 0;
  for (const tk of tks) {
    const cik = state.cik[tk]; if (!cik) { failed.push({ tk, error: "no CIK for this ticker" }); continue; }
    try {
      await sleep(gapMs());
      const sub = await secJson<{ name?: string; filings?: { recent?: Recent } }>(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, "0")}.json`, ua);
      const items = readSubmissions(cik, sub, since);
      // Keep exhibits already found; look up new earnings releases (newest first, a few per company).
      const old = new Map(((docs.get(`EQ.${tk}`)?.items as Filing[] | undefined) ?? []).map((f) => [f.acc, f]));
      for (const f of items) {
        if (!f.earn) continue; const prev = old.get(f.acc);
        if (prev && prev.ex !== undefined && prev.ex !== null) { f.ex = prev.ex; continue; }
        if (exLeft <= 0 || items.filter((x) => x.earn).indexOf(f) >= 4) continue;
        exLeft--;
        try {
          await sleep(gapMs());
          const idx = await secJson<{ directory?: { item?: { name?: string; type?: string }[] } }>(`https://www.sec.gov/Archives/edgar/data/${cik}/${f.acc.replace(/-/g, "")}/index.json`, ua);
          const ex = pickExhibit(idx.directory?.item ?? []); f.ex = ex ? `https://www.sec.gov/Archives/edgar/data/${cik}/${f.acc.replace(/-/g, "")}/${ex}` : null; if (ex) exhibits++;
        } catch { /* left for the next run */ }
      }
      const doc = { type: "filings", id: `EQ.${tk}`, tk, cik, name: String(sub.name ?? ""), checked, items };
      const prevItems = JSON.stringify(docs.get(`EQ.${tk}`)?.items ?? null);
      if (prevItems !== JSON.stringify(items)) { writes.push({ id: `EQ.${tk}`, data: doc }); updated.push(tk); }
    } catch (e) {
      failed.push({ tk, error: scrub(String((e as Error)?.message ?? e)).slice(0, 200) });
      // A 403 is SEC's rate limit or "undeclared tool" answer: stop for today.
      if ((e as { status?: number }).status === 403) break;
    }
  }
  const total = new Set([...[...docs.keys()].filter((k) => k.startsWith("EQ.")), ...writes.map((w) => w.id)]).size;
  const note = `SEC filings ${checked.slice(0, 10)}: ${tks.length - failed.length} of ${tks.length} companies checked, ${updated.length} with new filings${exhibits ? `, ${exhibits} earnings press releases found` : ""}; ${total} companies on file.${failed.length ? ` Failed: ${failed.slice(0, 8).map((f) => f.tk).join(", ")}${failed.length > 8 ? "…" : ""}.` : ""}`;
  const report: FilingsReport = { dryRun: !!opts.dryRun, updated, failed, exhibits, note };
  if (!opts.dryRun) {
    if (writes.length) await store.upsert(COL, writes);
    await store.upsert(COL, [{ id: "_meta", data: { type: "meta", checked, n: total, note, state } }]);
  }
  return report;
}
