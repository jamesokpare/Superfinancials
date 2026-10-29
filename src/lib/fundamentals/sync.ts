/**
 * Fundamentals sync: stores reported financials for the app's U.S. equities in
 *   fund/<instrument id>   (FundDoc, see sources.ts)
 *   fund/_meta             { type: "meta", checked, n, note }
 *
 * Statements change quarterly, so each run refreshes only the companies with
 * no data or data older than `refreshDays`, oldest first, up to `budget`
 * companies; a company that has reported since its last fetch goes first.
 * Each doc also holds quarterly earnings (report dates, EPS and revenue
 * actuals and consensus estimates). Every run updates those for all companies
 * from one bulk calendar call. The app turns these into ratios using the live
 * price (public/legacy/fundamentals.js).
 */
import "server-only";
import { envKey } from "@/lib/providers/http";
import { scrub } from "@/lib/providers";
import { US_EQUITIES } from "@/lib/market/instruments";
import { openStore, type Doc, type DocStore } from "@/lib/market/store";
import {
  alphaVantageFundamentals, eodhdEarningsCalendar, eodhdFundamentals, fmpEarningsCalendar, fmpFundamentals, tidyEarn,
  type FundDoc, type FundProvider,
} from "./sources";
import { africanFundamentals } from "./africa";

const ENVS: Record<FundProvider, string> = {
  eodhd: "EODHD_API_KEY", fmp: "FMP_API_KEY", alphavantage: "ALPHAVANTAGE_API_KEY",
  mansa: "MANSA_API_KEY", mystocks: "MYSTOCKS_AFRICA_API_KEY", ngxpulse: "NGX_PULSE_API_KEY", africa: "AFRICA_API_KEY",
};
const LABEL: Record<FundProvider, string> = { eodhd: "EODHD", fmp: "Financial Modeling Prep", alphavantage: "Alpha Vantage", mansa: "Mansa API", mystocks: "MyStocks Africa", ngxpulse: "NGX Pulse", africa: "Africa API" };
type Fetch = (id: string, tk: string) => Promise<FundDoc | null>;
/** U.S. listings: full statements. */
const US_FETCH: Partial<Record<FundProvider, Fetch>> = { eodhd: (id, tk) => eodhdFundamentals(id, tk, "US"), fmp: fmpFundamentals, alphavantage: alphaVantageFundamentals };
/** NGX listings: full statements from EODHD when it covers the company, else key figures from the African APIs. */
const NGX_FETCH: Partial<Record<FundProvider, Fetch>> = { eodhd: (id, tk) => eodhdFundamentals(id, tk, "XNSA"), ...africanFundamentals };
const NGX_ORDER: FundProvider[] = ["eodhd", "mansa", "mystocks", "ngxpulse", "africa"];
const COL = "fund";
const DAY = 864e5;

export type FundSyncOptions = {
  store?: DocStore;
  dryRun?: boolean;
  now?: Date;
  /** Limit to these tickers (e.g. ["AAPL", "MSFT"]; NGX tickers as on the exchange, e.g. "MTNN"). */
  only?: string[];
  /** U.S. companies fetched per run. Default FUND_BUDGET or 10. */
  budget?: number;
  /** NGX companies fetched per run. Default FUND_NGX_BUDGET or 10. */
  ngxBudget?: number;
  /** Refetch a company after this many days. Default FUND_REFRESH_DAYS or 7. */
  refreshDays?: number;
  /** Alpha Vantage companies per run (5 calls each; free keys allow 25 calls a day). Default 1. */
  alphaVantageCompanies?: number;
  providers?: FundProvider[];
};

export type FundSyncReport = {
  dryRun: boolean;
  configured: FundProvider[];
  updated: { tk: string; src: FundProvider; ngx?: boolean }[];
  failed: { tk: string; error: string }[];
  pending: number;
  earnings: { source?: FundProvider; updated: number; error?: string };
  total: number;
  ngxTotal: number;
  note: string;
};

const intEnv = (k: string, d: number) => { const n = Number(process.env[k]); return Number.isFinite(n) && n >= 0 ? n : d; };
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

export async function runFundamentalsSync(opts: FundSyncOptions = {}): Promise<FundSyncReport> {
  const now = opts.now ?? new Date(); const nowMs = now.getTime();
  const budget = opts.budget ?? intEnv("FUND_BUDGET", 10); const refreshDays = opts.refreshDays ?? intEnv("FUND_REFRESH_DAYS", 7);
  const configured = (opts.providers ?? (Object.keys(ENVS) as FundProvider[]).filter((p) => envKey(ENVS[p])));
  let avLeft = opts.alphaVantageCompanies ?? 1;
  const store = opts.store ?? openStore();
  const docs = new Map((await store.list(COL)).map((d) => [d.id, d.data as unknown as FundDoc]));

  const tks = US_EQUITIES.split(" ").filter((t) => !opts.only || opts.only.includes(t));
  const age = (tk: string) => { const d = docs.get(`EQ.${tk}`); return d ? nowMs - (Date.parse(d.asOf) || 0) : Infinity; };
  // A company that has reported since its last fetch goes first, so actuals arrive the next morning.
  const today = iso(nowMs);
  const reported = (tk: string) => { const d = docs.get(`EQ.${tk}`); return !!d?.nextEarn && d.nextEarn < today && d.asOf.slice(0, 10) <= d.nextEarn; };
  const due = tks.filter((tk) => reported(tk) || age(tk) > refreshDays * DAY).sort((a, b) => Number(reported(b)) - Number(reported(a)) || age(b) - age(a));
  const batch = due.slice(0, budget);

  // NGX listings come from the data desk's instruments (adm_inst/AD.NG.<TICKER>).
  const ngxIds = (await store.list("adm_inst").catch(() => [] as Doc[]))
    .filter((d) => !d.data.of && (d.id.startsWith("AD.NG.") || (d.data.meta as { exch?: string } | undefined)?.exch === "NGX"))
    .map((d) => ({ id: d.id, tk: String((d.data.meta as { tk?: string } | undefined)?.tk || d.id.split(".").pop()).toUpperCase() }))
    .filter((x) => !opts.only || opts.only.includes(x.tk));
  const ngxAge = (id: string) => { const d = docs.get(id); return d ? nowMs - (Date.parse(d.asOf) || 0) : Infinity; };
  const ngxDue = ngxIds.filter((x) => ngxAge(x.id) > refreshDays * DAY).sort((a, b) => ngxAge(b.id) - ngxAge(a.id));
  const ngxBatch = ngxDue.slice(0, opts.ngxBudget ?? intEnv("FUND_NGX_BUDGET", 10));
  const usProviders = configured.filter((p) => US_FETCH[p]);
  const ngxProviders = NGX_ORDER.filter((p) => configured.includes(p));

  type Job = { id: string; tk: string; ngx: boolean };
  const jobs: Job[] = [...batch.map((tk) => ({ id: `EQ.${tk}`, tk, ngx: false })), ...ngxBatch.map((x) => ({ ...x, ngx: true }))];
  const updated: FundSyncReport["updated"] = []; const failed: FundSyncReport["failed"] = []; const writes = new Map<string, FundDoc>();
  // Companies one at a time (a few in parallel) so per-minute limits are respected.
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(3, jobs.length) }, async () => {
    while (i < jobs.length) {
      const { id, tk, ngx } = jobs[i++]; const errs: string[] = [];
      for (const p of ngx ? ngxProviders : usProviders) {
        if (p === "alphavantage" && avLeft <= 0) continue;
        if (p === "alphavantage") avLeft--;
        try {
          const doc = await (ngx ? NGX_FETCH : US_FETCH)[p]!(id, tk);
          if (doc) { writes.set(id, doc); updated.push({ tk, src: p, ...(ngx ? { ngx: true } : {}) }); break; }
          errs.push(`${LABEL[p]}: ${ngx && p !== "eodhd" ? "no key figures" : "no annual statements"}`);
        } catch (e) { errs.push(scrub(String((e as Error)?.message ?? e)).slice(0, 200)); }
      }
      if (!writes.has(id)) failed.push({ tk: ngx ? `NGX:${tk}` : tk, error: errs.join("; ") || "no provider configured" });
    }
  }));

  // Recent actuals and upcoming dates and estimates for every company, from one calendar call.
  const earnings: FundSyncReport["earnings"] = { updated: 0 };
  const from = iso(nowMs - 10 * DAY), to = iso(nowMs + 120 * DAY);
  for (const p of (["eodhd", "fmp"] as const).filter((x) => configured.includes(x))) {
    try {
      const cal = p === "eodhd" ? await eodhdEarningsCalendar(tks, from, to) : await fmpEarningsCalendar(tks, from, to);
      if (!cal.size) continue;
      earnings.source = p;
      for (const tk of tks) {
        const id = `EQ.${tk}`; const rows = cal.get(tk); const d = writes.get(id) ?? docs.get(id);
        if (!rows || !d) continue;
        const earn = tidyEarn([...(d.earn ?? []), ...rows], today);
        const next = earn.find((r) => r.d >= today && r.eps === null);
        const upd: FundDoc = { ...d, earn, nextEarn: next?.d ?? d.nextEarn, earnTime: next ? next.time ?? d.earnTime : d.earnTime };
        if (JSON.stringify(upd) === JSON.stringify(d)) continue;
        writes.set(id, upd); earnings.updated++;
      }
      break;
    } catch (e) { earnings.error = scrub(String((e as Error)?.message ?? e)).slice(0, 200); }
  }

  const total = new Set([...docs.keys(), ...writes.keys()].filter((k) => k.startsWith("EQ."))).size;
  const ngxTotal = new Set([...docs.keys(), ...writes.keys()].filter((k) => ngxIds.some((x) => x.id === k))).size;
  const bySrc: Record<string, number> = {}; for (const u of updated) bySrc[u.src] = (bySrc[u.src] ?? 0) + 1;
  const pending = Math.max(0, due.length - batch.length) + Math.max(0, ngxDue.length - ngxBatch.length);
  const note = `Fundamentals sync ${iso(nowMs)}: ${updated.length} companies refreshed${updated.length ? ` (${Object.entries(bySrc).map(([p, n]) => `${LABEL[p as FundProvider]} ${n}`).join(", ")})` : ""}` +
    `; ${total} of ${US_EQUITIES.split(" ").length} U.S. companies have reported figures` + (ngxIds.length ? `; ${ngxTotal} of ${ngxIds.length} NGX listings` : "") +
    (pending ? `; ${pending} queued for later runs` : "") +
    (earnings.updated ? `; earnings calendar updated ${earnings.updated} companies` : "") + (failed.length ? `; failed: ${failed.map((f) => f.tk).join(", ")}` : "") + ".";
  const report: FundSyncReport = { dryRun: !!opts.dryRun, configured, updated, failed, pending, earnings, total, ngxTotal, note };
  if (opts.dryRun || !configured.length) return report;

  const out: Doc[] = [...writes].map(([id, d]) => ({ id, data: d as unknown as Record<string, unknown> }));
  if (out.length) await store.upsert(COL, out);
  await store.upsert(COL, [{ id: "_meta", data: { type: "meta", checked: now.toISOString(), n: total, note } }]);
  return report;
}
