/**
 * Company filings outside the U.S. (see src/lib/filings/sync.ts for SEC EDGAR):
 *
 *   EDINET (Japan)          api.edinet-fsa.go.jp/api/v2/documents.json        key EDINET_API_KEY (free)
 *                           Securities reports of listed companies. Public Data License 1.0:
 *                           "Source: EDINET, Financial Services Agency".
 *   OpenDART (Korea)        opendart.fss.or.kr/api/list.json                   key OPENDART_API_KEY (free)
 *                           Periodic and major-issue reports of KOSPI / KOSDAQ companies.
 *                           Credit: Financial Supervisory Service, OpenDART.
 *   filings.xbrl.org (EU/UK) filings.xbrl.org/api/filings                       no key
 *                           ESEF annual financial reports collected by XBRL International.
 *
 * Written to the `filings` collection, next to the SEC documents:
 *
 *   filings/latest-<CC>   { type: "intl-filings", cc, src, credit, checked, items: IntlFiling[] }
 *                         newest filings per country (JP, KR, UK, DE, FR, …), the last 60 days
 *   filings/latest-EU     every ESEF filing from filings.xbrl.org, all countries together
 *   filings/<inst id>     { type: "filings", id, name, src, credit, checked, items } for data-desk
 *                         instruments (adm_inst with meta.country) whose ticker or name matches a filer
 *   filings/_intl         last-run summary { checked, n, note, sources, state }  (filings/_meta stays SEC's)
 *
 * A source without its key is skipped and named in the summary.
 */
import "server-only";
import { ProviderError, envKey } from "@/lib/providers/http";
import { scrub } from "@/lib/providers";
import { openStore, type Doc, type DocStore } from "@/lib/market/store";
import type { Filing } from "./sync";

export type IntlFiling = Filing & {
  /** Source: "EDINET", "OpenDART" or "filings.xbrl.org". */
  src: string;
  /** Filer name and its id at the source (EDINET code, DART corp code, LEI). */
  co: string; cid: string;
  /** App country code (UK, not GB). */
  cc: string;
  /** Local ticker when the source gives one (EDINET securities code without the check digit, KRX stock code). */
  tk?: string;
  /** Title in the filing's own language, when it differs from desc. */
  orig?: string;
};
export type IntlSourceId = "edinet" | "opendart" | "xbrl";

const COL = "filings";
const DAY = 864e5;
const KEEP_DAYS = 60, KEEP_N = 300;
const UA = { "user-agent": "Mozilla/5.0 (compatible; Superfinancials data sync; +https://github.com/jamesokpare/Superfinancials)" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const gapMs = () => Number(process.env.INTL_GAP_MS ?? 400);
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);

export const CREDIT: Record<IntlSourceId, { name: string; credit: string; url: string }> = {
  edinet: { name: "EDINET", credit: "Source: EDINET, Financial Services Agency (Public Data License 1.0)", url: "https://disclosure2.edinet-fsa.go.jp/" },
  opendart: { name: "OpenDART", credit: "Source: Financial Supervisory Service, OpenDART (dart.fss.or.kr)", url: "https://dart.fss.or.kr/" },
  xbrl: { name: "filings.xbrl.org", credit: "Source: filings.xbrl.org (XBRL International), ESEF filings as published by each issuer", url: "https://filings.xbrl.org/" },
};

async function getJson<T>(name: string, url: string, headers: Record<string, string> = {}): Promise<T> {
  let res: Response;
  try { res = await fetch(url, { headers: { ...UA, accept: "application/json, application/vnd.api+json", ...headers }, signal: AbortSignal.timeout(45_000) }); }
  catch (e) { throw new ProviderError(name, `request failed: ${(e as Error).message}`); }
  const text = await res.text();
  if (!res.ok) throw new ProviderError(name, `HTTP ${res.status}: ${scrub(text.slice(0, 160))}`, res.status);
  try { return JSON.parse(text) as T; } catch { throw new ProviderError(name, `not JSON: ${scrub(text.slice(0, 120))}`); }
}

// --- EDINET (Japan) ---------------------------------------------------------------------------------------
/** docTypeCode → English name. Amendments (odd codes 130…190) are marked as such. */
export const EDINET_TYPES: Record<string, string> = {
  "120": "Annual securities report", "130": "Annual securities report (amendment)",
  "140": "Quarterly securities report", "150": "Quarterly securities report (amendment)",
  "160": "Semi-annual securities report", "170": "Semi-annual securities report (amendment)",
  "180": "Extraordinary report", "190": "Extraordinary report (amendment)",
  "350": "Large shareholding report", "360": "Large shareholding report (amendment)",
};
type EdinetDoc = { docID?: string; edinetCode?: string; secCode?: string | null; filerName?: string; fundCode?: string | null; docTypeCode?: string; periodStart?: string | null; periodEnd?: string | null; submitDateTime?: string; docDescription?: string; withdrawalStatus?: string; pdfFlag?: string; xbrlFlag?: string; subjectEdinetCode?: string | null; issuerEdinetCode?: string | null };
/** Listed companies' reports of interest from one day's document list. */
export function readEdinet(results: EdinetDoc[]): IntlFiling[] {
  const out: IntlFiling[] = [];
  for (const r of results) {
    const type = String(r.docTypeCode ?? ""); const id = String(r.docID ?? "");
    if (!EDINET_TYPES[type] || !id || r.fundCode || (r.withdrawalStatus && r.withdrawalStatus !== "0")) continue;
    // Large shareholding reports name the holder as filer; they are kept only when they concern a listed issuer.
    if (!r.secCode && !(type === "350" || type === "360")) continue;
    const date = String(r.submitDateTime ?? "").slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const sec = String(r.secCode ?? ""); const tk = /^\d{4}0$/.test(sec) ? sec.slice(0, 4) : /^[0-9A-Z]{4}0$/.test(sec) ? sec.slice(0, 4) : sec || undefined;
    const viewer = `https://disclosure2.edinet-fsa.go.jp/WZEK0040.aspx?${id}`;
    out.push({ src: "EDINET", co: String(r.filerName ?? ""), cid: String(r.edinetCode ?? ""), cc: "JP", ...(tk ? { tk } : {}), form: type, date, period: r.periodEnd || null, acc: id, url: viewer, index: viewer, desc: EDINET_TYPES[type], items: [], ...(r.docDescription ? { orig: String(r.docDescription) } : {}) });
  }
  return out;
}
export async function edinet(now: Date, days = Number(process.env.EDINET_DAYS ?? 3)): Promise<IntlFiling[]> {
  const key = envKey("EDINET_API_KEY"); if (!key) throw new ProviderError("EDINET", "EDINET_API_KEY not set");
  const out: IntlFiling[] = []; const errs: string[] = [];
  for (let k = 0; k < days; k++) {
    const day = isoDay(now.getTime() - k * DAY); if (k) await sleep(gapMs());
    try {
      const r = await getJson<{ metadata?: { status?: string; message?: string }; results?: EdinetDoc[]; statusCode?: number; message?: string }>("EDINET", `https://api.edinet-fsa.go.jp/api/v2/documents.json?date=${day}&type=2&Subscription-Key=${encodeURIComponent(key)}`);
      // Errors come back as HTTP 200 with a status in the body.
      const st = String(r.metadata?.status ?? r.statusCode ?? "200");
      if (st !== "200") { errs.push(`${day}: ${st} ${r.metadata?.message ?? r.message ?? ""}`.trim()); if (st === "401" || st === "403") break; continue; }
      out.push(...readEdinet(r.results ?? []));
    } catch (e) { errs.push(`${day}: ${(e as Error).message}`); if ([401, 403].includes((e as { status?: number }).status ?? 0)) break; }
  }
  if (!out.length && errs.length) throw new ProviderError("EDINET", errs.slice(0, 2).join(" | "));
  return out;
}

// --- OpenDART (Korea) ---------------------------------------------------------------------------------------
/** Report-name keywords → English. Checked in order; the first match wins. */
const DART_NAMES: [RegExp, string][] = [
  [/사업보고서/, "Annual report"], [/반기보고서/, "Semi-annual report"], [/분기보고서/, "Quarterly report"],
  [/주요사항보고서/, "Major issues report"], [/유상증자/, "Rights offering"], [/무상증자/, "Bonus issue"], [/전환사채/, "Convertible bonds"],
  [/자기주식/, "Share buyback"], [/합병/, "Merger"], [/분할/, "Spin-off / split"], [/영업양수|영업양도/, "Business transfer"], [/소송/, "Litigation"],
];
type DartRow = { corp_code?: string; corp_name?: string; stock_code?: string; corp_cls?: string; report_nm?: string; rcept_no?: string; flr_nm?: string; rcept_dt?: string; rm?: string };
export function dartDesc(name: string): string {
  const n = name.replace(/\s+/g, " ").trim(); const base = DART_NAMES.find(([re]) => re.test(n))?.[1] ?? "Disclosure";
  return `${base}${/\[기재정정\]|\[첨부정정\]|정정/.test(n) ? " (correction)" : ""}`;
}
export function readDart(list: DartRow[]): IntlFiling[] {
  return list.flatMap((r) => {
    const acc = String(r.rcept_no ?? ""); const d = String(r.rcept_dt ?? "");
    if (!acc || !/^\d{8}$/.test(d) || !["Y", "K"].includes(String(r.corp_cls ?? ""))) return []; // KOSPI and KOSDAQ only
    const url = `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${acc}`; const nm = String(r.report_nm ?? "").replace(/\s+/g, " ").trim();
    const period = nm.match(/\((\d{4})\.(\d{2})\)/); // "사업보고서 (2025.12)"
    return [{ src: "OpenDART", co: String(r.corp_name ?? ""), cid: String(r.corp_code ?? ""), cc: "KR", ...(r.stock_code ? { tk: String(r.stock_code) } : {}), form: r.corp_cls === "Y" ? "KOSPI" : "KOSDAQ", date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, period: period ? `${period[1]}-${period[2]}` : null, acc, url, index: url, desc: dartDesc(nm), items: [], orig: nm }];
  });
}
export async function openDart(now: Date, days = 3, maxPages = Number(process.env.DART_PAGES ?? 4)): Promise<IntlFiling[]> {
  const key = envKey("OPENDART_API_KEY"); if (!key) throw new ProviderError("OpenDART", "OPENDART_API_KEY not set");
  const ymd = (t: number) => isoDay(t).replace(/-/g, "");
  const out: IntlFiling[] = []; const errs: string[] = []; let n = 0;
  // A = periodic reports, B = major-issue reports.
  for (const ty of ["A", "B"]) {
    for (let page = 1; page <= maxPages; page++) {
      if (n++) await sleep(gapMs());
      const r = await getJson<{ status?: string; message?: string; total_page?: number; list?: DartRow[] }>("OpenDART", `https://opendart.fss.or.kr/api/list.json?crtfc_key=${encodeURIComponent(key)}&bgn_de=${ymd(now.getTime() - (days - 1) * DAY)}&end_de=${ymd(now.getTime())}&pblntf_ty=${ty}&page_no=${page}&page_count=100`);
      const st = String(r.status ?? "");
      if (st === "013") break; // no filings in the range
      if (st !== "000") { errs.push(`${ty}: ${st} ${r.message ?? ""}`.trim()); if (["010", "011", "012", "020", "901"].includes(st)) throw new ProviderError("OpenDART", errs.at(-1)!); break; }
      out.push(...readDart(r.list ?? []));
      if (page >= Number(r.total_page ?? 1)) break;
    }
  }
  if (!out.length && errs.length) throw new ProviderError("OpenDART", errs.join(" | "));
  return out;
}

// --- filings.xbrl.org (ESEF, EU and UK) -----------------------------------------------------------------------
/** Countries asked for (ISO codes as filings.xbrl.org uses them). */
export const XBRL_COUNTRIES = "GB DE FR IT ES NL BE AT IE PT FI DK SE NO PL GR LU CZ HU RO".split(" ");
const appCc = (c: string) => (c === "GB" ? "UK" : c === "EL" ? "GR" : c);
type JsonApi = { data?: { id?: string; attributes?: Record<string, unknown>; relationships?: { entity?: { data?: { id?: string } } } }[]; included?: { type?: string; id?: string; attributes?: Record<string, unknown> }[] };
export function readXbrl(r: JsonApi): IntlFiling[] {
  const ents = new Map((r.included ?? []).filter((x) => x.type === "entity").map((x) => [String(x.id), x.attributes ?? {}]));
  const abs = (u: unknown) => { const s = String(u ?? ""); return !s ? "" : /^https?:/.test(s) ? s : `https://filings.xbrl.org${s.startsWith("/") ? "" : "/"}${s}`; };
  return (r.data ?? []).flatMap((f) => {
    const a = f.attributes ?? {}; const e = ents.get(String(f.relationships?.entity?.data?.id ?? "")) ?? {};
    const date = String(a.date_added ?? a.processed ?? "").slice(0, 10); const cc = appCc(String(a.country ?? ""));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !cc) return [];
    const viewer = abs(a.viewer_url) || abs(a.report_url); const pkg = abs(a.package_url);
    const errs = Number(a.error_count ?? 0);
    return [{ src: "filings.xbrl.org", co: String(e.name ?? ""), cid: String(e.identifier ?? a.fxo_id ?? ""), cc, form: "ESEF", date, period: a.period_end ? String(a.period_end).slice(0, 10) : null, acc: String(a.fxo_id ?? f.id ?? ""), url: viewer || pkg, index: pkg || viewer, desc: `Annual financial report (ESEF)${errs ? ` · ${errs} validation error${errs === 1 ? "" : "s"}` : ""}`, items: [] }];
  });
}
export async function xbrlFilings(countries = XBRL_COUNTRIES, size = Number(process.env.XBRL_PAGE ?? 40)): Promise<IntlFiling[]> {
  const out: IntlFiling[] = []; const errs: string[] = [];
  for (const [i, c] of countries.entries()) {
    if (i) await sleep(gapMs());
    try { out.push(...readXbrl(await getJson<JsonApi>("filings.xbrl.org", `https://filings.xbrl.org/api/filings?filter%5Bcountry%5D=${c}&sort=-date_added&page%5Bsize%5D=${size}&include=entity`))); }
    catch (e) { errs.push(`${c}: ${(e as Error).message}`); }
  }
  if (!out.length && errs.length) throw new ProviderError("filings.xbrl.org", errs.slice(0, 2).join(" | "));
  return out;
}

// --- matching onto data-desk instruments ---------------------------------------------------------------------
const normName = (s: string) => s.toUpperCase().normalize("NFKD").replace(/[^A-Z0-9 ]/g, " ").replace(/\b(PLC|AG|SE|SA|S A|NV|N V|SPA|S P A|AB|ASA|OYJ|A S|AS|CO|LTD|LIMITED|INC|CORP|CORPORATION|HOLDINGS?|GROUP|KABUSHIKI KAISHA|KK|THE)\b/g, " ").replace(/\s+/g, " ").trim();
const tkCore = (s: string) => s.toUpperCase().replace(/\.[A-Z]{1,4}$/, "").replace(/^0+(?=\d)/, "");
type Inst = { id: string; tk: string; name: string; cc: string };
/** Data-desk instruments a filing belongs to: same country and the same local ticker, or the same name. */
export function matchInst(f: IntlFiling, insts: Inst[]): string[] {
  const n = normName(f.co);
  return insts.filter((x) => x.cc === f.cc && ((f.tk && x.tk && tkCore(x.tk) === tkCore(f.tk)) || (n.length >= 3 && normName(x.name) === n))).map((x) => x.id);
}

// --- sync ---------------------------------------------------------------------------------------------------------
export const INTL_SOURCES: { id: IntlSourceId; needs?: string; run: (now: Date) => Promise<IntlFiling[]> }[] = [
  { id: "edinet", needs: "EDINET_API_KEY", run: (now) => edinet(now) },
  { id: "opendart", needs: "OPENDART_API_KEY", run: (now) => openDart(now) },
  { id: "xbrl", run: () => xbrlFilings() },
];
export type IntlReport = { dryRun: boolean; sources: Record<string, { n: number; error?: string; skipped?: string }>; lists: Record<string, number>; matched: string[]; note: string };

const byNewest = (a: IntlFiling, b: IntlFiling) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.acc < b.acc ? 1 : -1);
/** Old and new items together: one per accession number, the last 60 days, newest first. */
export function mergeItems(old: IntlFiling[], add: IntlFiling[], now: Date, keep = KEEP_N): IntlFiling[] {
  const cut = isoDay(now.getTime() - KEEP_DAYS * DAY); const m = new Map<string, IntlFiling>();
  for (const f of [...old, ...add]) if (f.date >= cut) m.set(`${f.src}|${f.acc}`, f);
  return [...m.values()].sort(byNewest).slice(0, keep);
}

export async function runIntlFilingsSync(opts: { store?: DocStore; dryRun?: boolean; now?: Date; only?: IntlSourceId[] } = {}): Promise<IntlReport> {
  const now = opts.now ?? new Date(); const checked = now.toISOString(); const store = opts.store ?? openStore();
  const docs = new Map((await store.list(COL)).map((d) => [d.id, d.data]));
  const report: IntlReport = { dryRun: !!opts.dryRun, sources: {}, lists: {}, matched: [], note: "" };
  const got = new Map<IntlSourceId, IntlFiling[]>();
  for (const s of INTL_SOURCES) {
    if (opts.only && !opts.only.includes(s.id)) continue;
    if (s.needs && !envKey(s.needs)) { report.sources[s.id] = { n: 0, skipped: `${s.needs} not set` }; continue; }
    try { const r = await s.run(now); got.set(s.id, r); report.sources[s.id] = { n: r.length }; }
    catch (e) { report.sources[s.id] = { n: 0, error: scrub(String((e as Error)?.message ?? e)).slice(0, 300) }; }
  }

  // Per-country lists (and the combined ESEF list).
  const writes: Doc[] = []; const prevItems = (id: string) => ((docs.get(id)?.items as IntlFiling[] | undefined) ?? []);
  const lists = new Map<string, { src: IntlSourceId; items: IntlFiling[] }>();
  for (const [src, fs] of got) for (const f of fs) {
    const ids = [`latest-${f.cc}`, ...(src === "xbrl" && f.cc !== "UK" ? ["latest-EU"] : [])];
    for (const id of ids) (lists.get(id) ?? lists.set(id, { src, items: [] }).get(id)!).items.push(f);
  }
  for (const [id, { src, items }] of lists) {
    const merged = mergeItems(prevItems(id), items, now); report.lists[id] = merged.length;
    if (JSON.stringify(merged) === JSON.stringify(prevItems(id))) continue;
    writes.push({ id, data: { type: "intl-filings", id, cc: id.slice(7), src: CREDIT[src].name, credit: CREDIT[src].credit, srcUrl: CREDIT[src].url, checked, items: merged } });
  }

  // Data-desk instruments (adm_inst with meta.country / meta.tk) that match a filer.
  const insts: Inst[] = (await store.list("adm_inst")).flatMap((d) => { const m = (d.data.meta ?? {}) as Record<string, unknown>; const cc = String(m.country ?? ""); return cc && (m.tk || m.name) ? [{ id: d.id, tk: String(m.tk ?? ""), name: String(m.name ?? ""), cc: cc === "GB" ? "UK" : cc }] : []; });
  if (insts.length) {
    const per = new Map<string, { src: IntlSourceId; items: IntlFiling[]; name: string }>();
    for (const [src, fs] of got) for (const f of fs) for (const id of matchInst(f, insts)) (per.get(id) ?? per.set(id, { src, items: [], name: f.co }).get(id)!).items.push(f);
    for (const [id, { src, items, name }] of per) {
      if (/^EQ\.[A-Z.]+$/.test(id) && docs.get(id)?.cik) continue; // an SEC company: filings/sync.ts owns it
      const merged = mergeItems(prevItems(id), items, now, 60);
      if (JSON.stringify(merged) === JSON.stringify(prevItems(id))) continue;
      writes.push({ id, data: { type: "filings", id, name, src: CREDIT[src].name, credit: CREDIT[src].credit, srcUrl: CREDIT[src].url, checked, items: merged } }); report.matched.push(id);
    }
  }

  const prevMeta = docs.get("_intl"); const state = {};
  const ok = Object.values(report.sources).filter((s) => !s.error && !s.skipped).length; const tried = Object.keys(report.sources).length;
  const n = Object.values(report.lists).reduce((a, b) => a + b, 0);
  const bad = Object.entries(report.sources).filter(([, s]) => s.error || s.skipped).map(([k, s]) => `${CREDIT[k as IntlSourceId].name} (${s.error ? "failed" : s.skipped})`);
  report.note = `International filings ${checked.slice(0, 10)}: ${ok} of ${tried} sources answered; ${n} filings on ${Object.keys(report.lists).length} country lists${report.matched.length ? `, ${report.matched.length} data-desk instruments matched` : ""}.${bad.length ? ` Not updated: ${bad.join(", ")}.` : ""}`;
  if (!opts.dryRun) {
    if (writes.length) await store.upsert(COL, writes);
    const partial = !!opts.only;
    await store.upsert(COL, [{ id: "_intl", data: { type: "meta", checked, n: partial ? Math.max(n, Number(prevMeta?.n ?? 0)) : n, note: report.note, sources: { ...(partial ? (prevMeta?.sources as object | undefined) ?? {} : {}), ...report.sources }, state } }]);
  }
  return report;
}
