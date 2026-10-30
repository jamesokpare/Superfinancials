/**
 * SEC sync (public domain, no key; needs SEC_USER_AGENT "Company contact@domain"):
 *
 *   secframes/t-<A…Z|0>   EPS and revenue for every U.S. filer with a ticker, from SEC XBRL frames,
 *                         sharded by the ticker's first character (the app loads one shard when a
 *                         company page needs it):
 *                         { type:'secframes', shard, checked, src, url, n, items: { <TK>: { cik, name, q[], fy[], sh } } }
 *   adm_priv/secc-<cik>   Regulation Crowdfunding offerings (Form C), kind 'raise', gen 'sec-datasets'
 *   adm_priv/secr-<cik>   Regulation A offerings (Form 1-A), kind 'raise', gen 'sec-datasets'
 *   secsync/_meta         last-run summary { checked, n, note, sources, state }
 *
 * Frames: ~57 requests cover 8 quarters and 3 years. Each run fetches the frames
 * that are due (recent periods daily, older ones monthly) within a request
 * budget (SEC_FRAMES_BUDGET, default 30), so a run fits the cron time limit
 * and the whole set is current after two runs.
 * Data sets: quarterly zips, each read once; the last 4 quarters are kept, and
 * an offering filed more than a year ago is retired. Owner entries in adm_priv
 * (without gen 'sec-datasets') are never touched.
 */
import "server-only";
import { ProviderError } from "@/lib/providers/http";
import { scrub } from "@/lib/providers";
import { openStore, type Doc, type DocStore } from "@/lib/market/store";
import { contactUA } from "@/lib/macro/sources";
import { applyFrame, fetchFrame, framePlan, trimCo, fillQ4, type FrameCo } from "./frames";
import { fetchDataset, pastQuarters, readDataset, type Offering } from "./datasets";

export const GEN = "sec-datasets";
const COL = "secframes";
export const FRAMES_SRC = "SEC EDGAR XBRL (public domain)";
const DAY = 864e5;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const gapMs = () => Number(process.env.SEC_GAP_MS ?? 150);
const intEnv = (k: string, d: number) => { const n = Number(process.env[k]); return process.env[k] && Number.isFinite(n) && n >= 0 ? n : d; };
const shardOf = (tk: string) => (/^[A-Z]/.test(tk) ? tk[0] : "0");

type State = { frameAt?: Record<string, string>; ds?: string[] };
export type SecPart = "frames" | "datasets";
export type SecReport = {
  dryRun: boolean; checked: string;
  sources: Record<string, { series: number; events: number; error?: string; skipped?: string }>;
  frames: { fetched: number; failed: string[]; due: number; companies: number; shardsWritten: number };
  datasets: { read: string[]; offerings: number; written: number; removed: number; kept: number };
  note: string;
};

async function secJson<T>(url: string, ua: string): Promise<T> {
  let res: Response;
  try { res = await fetch(url, { headers: { "user-agent": ua, accept: "application/json" }, signal: AbortSignal.timeout(30_000) }); }
  catch (e) { throw new ProviderError("SEC EDGAR", `request failed: ${(e as Error).message}`); }
  if (!res.ok) throw new ProviderError("SEC EDGAR", `HTTP ${res.status} from ${url}`, res.status);
  return (await res.json()) as T;
}

export async function runSecSync(opts: { store?: DocStore; dryRun?: boolean; now?: Date; only?: SecPart[]; budget?: number } = {}): Promise<SecReport> {
  const ua = contactUA(); if (!ua) throw new ProviderError("SEC EDGAR", "Set SEC_USER_AGENT to \"Company contact@domain\" (SEC requires a contact address)");
  const now = opts.now ?? new Date(); const checked = now.toISOString(); const store = opts.store ?? openStore();
  const meta = (await store.list("secsync")).find((d) => d.id === "_meta")?.data;
  const state: State = { frameAt: {}, ds: [], ...((meta?.state as State | undefined) ?? {}) };
  const report: SecReport = { dryRun: !!opts.dryRun, checked, sources: {}, frames: { fetched: 0, failed: [], due: 0, companies: 0, shardsWritten: 0 }, datasets: { read: [], offerings: 0, written: 0, removed: 0, kept: 0 }, note: "" };
  const want = (p: SecPart) => !opts.only || opts.only.includes(p);
  const writes: { col: string; docs: Doc[] }[] = []; const removes: { col: string; ids: string[] }[] = [];

  // 1. XBRL frames
  if (want("frames")) {
    try {
      const plan = framePlan(now); const at = { ...(state.frameAt ?? {}) };
      const due = plan.filter((f) => { const t = at[f.key] ? Date.parse(at[f.key]) : 0; const recent = now.getTime() - Date.parse(f.end) < 200 * DAY; return now.getTime() - t > (recent ? 20 * 3600e3 : 30 * DAY); })
        .sort((a, b) => (at[a.key] ? 1 : 0) - (at[b.key] ? 1 : 0) || (a.end < b.end ? 1 : a.end > b.end ? -1 : 0));
      report.frames.due = due.length;
      const budget = opts.budget ?? intEnv("SEC_FRAMES_BUDGET", 30);
      const shards = await store.list(COL); const by = new Map<number, FrameCo>();
      for (const s of shards) for (const co of Object.values((s.data.items as Record<string, FrameCo> | undefined) ?? {})) if (co && co.cik) by.set(co.cik, { ...co, q: [...(co.q ?? [])], fy: [...(co.fy ?? [])] });
      let errors = 0;
      for (const f of due.slice(0, budget)) {
        try { await sleep(gapMs()); const pts = await fetchFrame(f, ua); applyFrame(by, f, pts); at[f.key] = checked; report.frames.fetched++; errors = 0; }
        catch (e) {
          report.frames.failed.push(`${f.key}: ${scrub(String((e as Error).message)).slice(0, 120)}`);
          if ((e as { status?: number }).status === 403 || ++errors >= 5) break; // 403: SEC's rate limit, stop for today
        }
      }
      if (!report.frames.fetched && report.frames.failed.length) throw new Error(report.frames.failed[0]);
      if (report.frames.fetched) {
        const tick = await secJson<Record<string, { cik_str: number; ticker: string }>>("https://www.sec.gov/files/company_tickers.json", ua);
        const tkOf = new Map<number, string>(); for (const x of Object.values(tick)) { const c = Number(x.cik_str); if (!tkOf.has(c)) tkOf.set(c, String(x.ticker).toUpperCase()); } // first listed is the main class
        const keepQ = new Set(plan.filter((f) => f.kind === "q").map((f) => f.period)), keepY = new Set(plan.filter((f) => f.kind === "fy").map((f) => f.period));
        const out = new Map<string, Record<string, FrameCo>>();
        for (const [cik, co] of by) {
          const tk = tkOf.get(cik); if (!tk) continue; const t = trimCo(fillQ4(co, keepQ), keepQ, keepY); if (!t.q.length && !t.fy.length) continue;
          (out.get(shardOf(tk)) ?? out.set(shardOf(tk), {}).get(shardOf(tk))!)[tk] = t;
        }
        const old = new Map(shards.map((s) => [s.id, s.data]));
        const docs: Doc[] = [];
        for (const [sh, items] of [...out].sort()) {
          const id = `t-${sh}`; report.frames.companies += Object.keys(items).length;
          if (JSON.stringify(old.get(id)?.items ?? null) === JSON.stringify(items)) continue;
          docs.push({ id, data: { type: "secframes", shard: sh, checked, src: FRAMES_SRC, url: "https://www.sec.gov/search-filings/edgar-application-programming-interfaces", n: Object.keys(items).length, items } });
        }
        report.frames.shardsWritten = docs.length; if (docs.length) writes.push({ col: COL, docs });
      } else report.frames.companies = shards.reduce((a, s) => a + Number(s.data.n ?? 0), 0);
      // Saved only once the merged figures are written with them, so a failed run fetches the same frames again.
      state.frameAt = Object.fromEntries(Object.entries(at).filter(([k]) => plan.some((f) => f.key === k)));
      report.sources.frames = { series: report.frames.companies, events: report.frames.fetched };
    } catch (e) { report.sources.frames = { series: 0, events: 0, error: scrub(String((e as Error).message)).slice(0, 300) }; }
  }

  // 2. Form C and Regulation A data sets → adm_priv
  if (want("datasets")) {
    try {
      const done = new Set(state.ds ?? []); const offers: Offering[] = []; let fetched = 0; const errs: string[] = [];
      for (const q of pastQuarters(now, 4)) for (const kind of ["cf", "rega"] as const) {
        const key = `${q}_${kind}`; if (done.has(key) || fetched >= intEnv("SEC_DATASET_BUDGET", 4)) continue;
        try { await sleep(gapMs()); const zip = await fetchDataset(kind, q, ua); fetched++; if (!zip) continue; offers.push(...readDataset(kind, zip)); done.add(key); report.datasets.read.push(key); }
        catch (e) { errs.push(`${key}: ${(e as Error).message}`); if ((e as { status?: number }).status === 403) break; }
      }
      state.ds = [...done].sort().slice(-16);
      if (!report.datasets.read.length && errs.length) throw new Error(errs[0]);
      report.datasets.offerings = offers.length;
      const priv = new Map((await store.list("adm_priv")).map((d) => [d.id, d.data]));
      const yearAgo = new Date(now.getTime() - 365 * DAY).toISOString().slice(0, 10);
      const pw = new Map<string, Record<string, unknown>>();
      for (const o of offers.sort((a, b) => (a.filed < b.filed ? -1 : 1))) {
        if (o.filed < yearAgo) continue;
        const id = `${o.kind === "cf" ? "secc" : "secr"}-${o.cik}`; const cur = pw.get(id) ?? priv.get(id);
        if (cur && cur.gen !== GEN) { report.datasets.kept++; continue; } // the owner's own entry
        if (cur && String(cur.filed ?? "") > o.filed) continue;
        const label = o.kind === "cf" ? "Reg CF offering" : "Reg A offering";
        const amt = (v: number | null) => (v == null ? "" : `US$${(v / 1e6).toFixed(v < 1e6 ? 2 : 1)}m`);
        pw.set(id, {
          kind: "raise", name: o.name, fundType: label, cc: "US", city: o.city, state: o.state, founded: o.founded, filed: o.filed, firstSale: null,
          offered: o.offered, target: o.target, sold: o.sold, minInvest: null, investors: null, people: [], platform: o.platform, security: o.security, price: o.price, deadline: o.deadline,
          employees: o.employees, revenue: o.revenue, web: o.web, form: o.form, acc: o.acc, url: o.url,
          desc: `${o.kind === "cf" ? "Regulation Crowdfunding offering (SEC Form " : "Regulation A offering (SEC Form "}${o.form}, filed ${o.filed})${o.target != null ? `, target ${amt(o.target)}` : ""}${o.offered != null ? `, up to ${amt(o.offered)}` : ""}${o.platform ? ` via ${o.platform}` : ""}${o.security ? `; ${o.security}` : ""}${o.deadline ? `; deadline ${o.deadline}` : ""}.`,
          srcName: o.kind === "cf" ? "SEC Regulation Crowdfunding data sets" : "SEC Regulation A data sets", gen: GEN, upd: checked, last: o.filed,
        });
      }
      const remove = [...priv].filter(([id, x]) => /^sec[cr]-/.test(id) && x.gen === GEN && String(x.last ?? "") < yearAgo && !pw.has(id)).map(([id]) => id);
      report.datasets.written = pw.size; report.datasets.removed = remove.length;
      if (pw.size) writes.push({ col: "adm_priv", docs: [...pw].map(([id, data]) => ({ id, data })) });
      if (remove.length) removes.push({ col: "adm_priv", ids: remove });
      report.sources.datasets = { series: 0, events: report.datasets.written };
    } catch (e) { report.sources.datasets = { series: 0, events: 0, error: scrub(String((e as Error).message)).slice(0, 300) }; }
  }

  const f = report.frames, d = report.datasets;
  const failed = Object.entries(report.sources).filter(([, s]) => s.error).map(([k]) => k);
  report.note = `SEC ${checked.slice(0, 10)}: ${want("frames") ? `XBRL frames ${f.fetched} fetched (${f.due} due), EPS and revenue for ${f.companies} companies${f.failed.length ? `, ${f.failed.length} frames failed` : ""}` : "frames not run"}; ${want("datasets") ? `offering data sets ${d.read.length ? d.read.join(", ") : "none new"}, ${d.written} Reg CF / Reg A offerings updated, ${d.removed} retired` : "data sets not run"}.${failed.length ? ` Failed: ${failed.join(", ")}.` : ""}`;
  if (!opts.dryRun) {
    for (const w of writes) await store.upsert(w.col, w.docs);
    for (const r of removes) await store.remove(r.col, r.ids);
    await store.upsert("secsync", [{ id: "_meta", data: { type: "meta", checked, n: f.companies || Number(meta?.n ?? 0), note: report.note, sources: { ...((opts.only ? (meta?.sources as SecReport["sources"] | undefined) : undefined) ?? {}), ...report.sources }, state } }]);
  }
  return report;
}
