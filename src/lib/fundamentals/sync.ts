/**
 * Fundamentals sync: stores reported financials for the app's U.S. equities in
 *   fund/<instrument id>   (FundDoc, see sources.ts)
 *   fund/_meta             { type: "meta", checked, n, note }
 *
 * Statements change quarterly, so each run refreshes only the companies with
 * no data or data older than `refreshDays`, oldest first, up to `budget`
 * companies. Every run also refreshes next earnings dates for all companies
 * from one bulk calendar call. The app turns these into ratios using the live
 * price (public/legacy/fundamentals.js).
 */
import "server-only";
import { envKey } from "@/lib/providers/http";
import { scrub } from "@/lib/providers";
import { US_EQUITIES } from "@/lib/market/instruments";
import { openStore, type Doc, type DocStore } from "@/lib/market/store";
import {
  alphaVantageFundamentals, eodhdEarningsCalendar, eodhdFundamentals, fmpEarningsCalendar, fmpFundamentals,
  type FundDoc, type FundProvider,
} from "./sources";

const ENVS: Record<FundProvider, string> = { eodhd: "EODHD_API_KEY", fmp: "FMP_API_KEY", alphavantage: "ALPHAVANTAGE_API_KEY" };
const LABEL: Record<FundProvider, string> = { eodhd: "EODHD", fmp: "Financial Modeling Prep", alphavantage: "Alpha Vantage" };
const FETCH: Record<FundProvider, (id: string, tk: string) => Promise<FundDoc | null>> = { eodhd: eodhdFundamentals, fmp: fmpFundamentals, alphavantage: alphaVantageFundamentals };
const COL = "fund";
const DAY = 864e5;

export type FundSyncOptions = {
  store?: DocStore;
  dryRun?: boolean;
  now?: Date;
  /** Limit to these tickers (e.g. ["AAPL", "MSFT"]). */
  only?: string[];
  /** Companies fetched per run. Default FUND_BUDGET or 10. */
  budget?: number;
  /** Refetch a company after this many days. Default FUND_REFRESH_DAYS or 7. */
  refreshDays?: number;
  /** Alpha Vantage companies per run (5 calls each; free keys allow 25 calls a day). Default 1. */
  alphaVantageCompanies?: number;
  providers?: FundProvider[];
};

export type FundSyncReport = {
  dryRun: boolean;
  configured: FundProvider[];
  updated: { tk: string; src: FundProvider }[];
  failed: { tk: string; error: string }[];
  pending: number;
  earnings: { source?: FundProvider; updated: number; error?: string };
  total: number;
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
  const due = tks.filter((tk) => age(tk) > refreshDays * DAY).sort((a, b) => age(b) - age(a));
  const batch = due.slice(0, budget);

  const updated: FundSyncReport["updated"] = []; const failed: FundSyncReport["failed"] = []; const writes = new Map<string, FundDoc>();
  // Companies one at a time (a few in parallel) so per-minute limits are respected.
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(3, batch.length) }, async () => {
    while (i < batch.length) {
      const tk = batch[i++]; const id = `EQ.${tk}`; const errs: string[] = [];
      for (const p of configured) {
        if (p === "alphavantage" && avLeft <= 0) continue;
        if (p === "alphavantage") avLeft--;
        try {
          const doc = await FETCH[p](id, tk);
          if (doc) { writes.set(id, doc); updated.push({ tk, src: p }); break; }
          errs.push(`${LABEL[p]}: no annual statements`);
        } catch (e) { errs.push(scrub(String((e as Error)?.message ?? e)).slice(0, 200)); }
      }
      if (!writes.has(id)) failed.push({ tk, error: errs.join("; ") || "no provider configured" });
    }
  }));

  // Next earnings dates for every company from one calendar call.
  const earnings: FundSyncReport["earnings"] = { updated: 0 };
  const from = iso(nowMs), to = iso(nowMs + 120 * DAY);
  for (const p of (["eodhd", "fmp"] as const).filter((x) => configured.includes(x))) {
    try {
      const cal = p === "eodhd" ? await eodhdEarningsCalendar(tks, from, to) : await fmpEarningsCalendar(tks, from, to);
      if (!cal.size) continue;
      earnings.source = p;
      for (const tk of tks) {
        const id = `EQ.${tk}`; const c = cal.get(tk); const d = writes.get(id) ?? docs.get(id);
        if (!c || !d) continue;
        if (d.nextEarn === c.date && (d.earnTime === c.time || !c.time)) continue;
        writes.set(id, { ...d, nextEarn: c.date, earnTime: c.time ?? d.earnTime }); earnings.updated++;
      }
      break;
    } catch (e) { earnings.error = scrub(String((e as Error)?.message ?? e)).slice(0, 200); }
  }

  const total = new Set([...docs.keys(), ...writes.keys()].filter((k) => k.startsWith("EQ."))).size;
  const bySrc: Record<string, number> = {}; for (const u of updated) bySrc[u.src] = (bySrc[u.src] ?? 0) + 1;
  const note = `Fundamentals sync ${iso(nowMs)}: ${updated.length} companies refreshed${updated.length ? ` (${Object.entries(bySrc).map(([p, n]) => `${LABEL[p as FundProvider]} ${n}`).join(", ")})` : ""}` +
    `; ${total} of ${US_EQUITIES.split(" ").length} have reported figures` + (due.length > batch.length ? `; ${due.length - batch.length} queued for later runs` : "") +
    (earnings.updated ? `; ${earnings.updated} earnings dates updated` : "") + (failed.length ? `; failed: ${failed.map((f) => f.tk).join(", ")}` : "") + ".";
  const report: FundSyncReport = { dryRun: !!opts.dryRun, configured, updated, failed, pending: Math.max(0, due.length - batch.length), earnings, total, note };
  if (opts.dryRun || !configured.length) return report;

  const out: Doc[] = [...writes].map(([id, d]) => ({ id, data: d as unknown as Record<string, unknown> }));
  if (out.length) await store.upsert(COL, out);
  await store.upsert(COL, [{ id: "_meta", data: { type: "meta", checked: now.toISOString(), n: total, note } }]);
  return report;
}
