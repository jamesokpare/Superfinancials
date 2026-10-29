/**
 * Macro sync: pulls free official data once a day and writes it in the data
 * desk's own format, so the app shows it with its source as DESK content:
 *
 *   adm_series/<CC>.<CODE>   economic series  { kind:'eco', cc, code, name, unit, cat, freq, mi?, d[], v[], src, url, notes, gen:'macro-sync' }
 *   adm_cal/auto-<id>        calendar events  { title, date, cc, cat, imp, srcName, url, notes, ids, gen:'macro-sync' }
 *   adm_priv/secd-<cik>      private companies from SEC Form D filings (U.S. private placements)
 *   macrosync/_meta          last-run summary { checked, n, note, sources }   (read by the sync-health check)
 *
 * It never touches documents the owner entered in the Data studio: a document
 * without gen:'macro-sync' is left alone, and a series only feeds the app's
 * macro panels (`mi`) when the owner hasn't already supplied that indicator
 * for that country.
 */
import "server-only";
import { scrub } from "@/lib/providers";
import { envKey } from "@/lib/providers/http";
import { openStore, type Doc, type DocStore } from "@/lib/market/store";
import { formDFiling, formDIndex, type FormD } from "./formd";
import { bisPolicyRates, dividendCalendar, ecb, econCalendar, fredReleaseCalendar, ipoCalendar, oecdCpi, treasuryAuctions, worldBank, type CalEvent, type MacroSeries } from "./sources";

export const GEN = "macro-sync";
/** Countries the app knows (Country data hub), app codes. */
export const MACRO_COUNTRIES = "AF AO AR AT AU BD BE BF BJ BR BW CA CD CG CH CI CL CM CN CO CV CZ DE DK DZ EG ES ET EU FI FR GA GH GM GN GR HK HU ID IE IL IN IQ IR IT JM JO JP KE KR KW KZ LB LK LR LY MA MG ML MU MW MX MY MZ NA NE NG NL NO NZ OM PE PH PK PL PT QA RO RU RW SA SD SE SG SL SN SS TG TH TN TR TW TZ UA AE UG UK US UY VE VN ZA ZM ZW".split(" ");

export type MacroSourceId = "worldbank" | "bis" | "ecb" | "oecd" | "fred-calendar" | "treasury" | "econ-calendar" | "dividends" | "ipos" | "sec-formd";
type State = Record<string, unknown>;
type Fetched = { series?: MacroSeries[]; events?: CalEvent[]; companies?: FormD[]; state?: State };
const intEnv = (k: string, d: number) => { const n = Number(process.env[k]); return process.env[k] && Number.isFinite(n) && n >= 0 ? n : d; };
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);

/** SEC Form D: works through the last week's EDGAR daily indexes within a request budget, resuming where the last run stopped. */
async function secFormD(now: Date, state: State): Promise<Fetched> {
  const st = (state.formd as { done?: string[]; partial?: Record<string, number> } | undefined) ?? {};
  const done = new Set(st.done ?? []); const partial = { ...(st.partial ?? {}) };
  const budget = intEnv("FORMD_BUDGET", 250), min = intEnv("FORMD_MIN_SOLD", 1_000_000);
  const out: FormD[] = []; let used = 0, errors = 0;
  for (let k = 7; k >= 1 && used < budget && errors < 5; k--) {
    const day = isoDay(now.getTime() - k * 864e5); const dow = new Date(day).getUTCDay();
    if (done.has(day)) continue; if (dow === 0 || dow === 6) { done.add(day); continue; }
    const idx = await formDIndex(day);
    if (!idx) { if (k >= 3) done.add(day); continue; } // not published yet: try again tomorrow
    let i = partial[day] ?? 0;
    for (; i < idx.length && used < budget && errors < 5; i++, used++) {
      try { const f = await formDFiling(idx[i]); errors = 0; if (f && f.name && f.sector && (f.sold ?? 0) >= min) out.push(f); }
      catch { errors++; }
    }
    if (i >= idx.length) { done.add(day); delete partial[day]; } else partial[day] = i;
  }
  if (errors >= 5 && !out.length) throw new Error("SEC EDGAR refused 5 requests in a row (check SEC_USER_AGENT)");
  return { companies: out, state: { formd: { done: [...done].sort().slice(-14), partial } } };
}

export const MACRO_SOURCES: { id: MacroSourceId; name: string; needs?: string; run: (now: Date, state: State) => Promise<Fetched> }[] = [
  { id: "worldbank", name: "World Bank", run: async (now) => ({ series: await worldBank(MACRO_COUNTRIES, now.getUTCFullYear() - 15, now) }) },
  { id: "bis", name: "BIS policy rates", run: async (now) => ({ series: await bisPolicyRates(`${now.getUTCFullYear() - 10}-01`) }) },
  { id: "ecb", name: "ECB", run: async (now) => ({ series: await ecb(`${now.getUTCFullYear() - 10}-01-01`) }) },
  { id: "oecd", name: "OECD CPI", run: async (now) => ({ series: await oecdCpi(`${now.getUTCFullYear() - 10}-01`) }) },
  { id: "fred-calendar", name: "FRED release calendar", needs: "FRED_API_KEY", run: async (now) => ({ events: await fredReleaseCalendar(now) }) },
  { id: "treasury", name: "U.S. Treasury auctions", run: async () => ({ events: await treasuryAuctions() }) },
  { id: "econ-calendar", name: "Economic calendar (FMP / EODHD)", needs: "FMP_API_KEY|EODHD_API_KEY", run: async (now) => ({ events: await econCalendar(now, new Set(MACRO_COUNTRIES)) }) },
  { id: "dividends", name: "Dividend calendar (FMP)", needs: "FMP_API_KEY", run: async (now) => ({ events: await dividendCalendar(now) }) },
  { id: "ipos", name: "IPO calendar (FMP / EODHD)", needs: "FMP_API_KEY|EODHD_API_KEY", run: async (now) => ({ events: await ipoCalendar(now) }) },
  { id: "sec-formd", name: "SEC Form D private placements", run: secFormD },
];
/** Which source writes each kind of calendar event (by id prefix), so a source that answered can retire its own stale events. */
const EVENT_SOURCE: [string, MacroSourceId][] = [["auto-fred-", "fred-calendar"], ["auto-ust-", "treasury"], ["auto-eco-", "econ-calendar"], ["auto-div-", "dividends"], ["auto-ipo-", "ipos"]];

export type MacroReport = {
  date: string; dryRun: boolean; store: string;
  sources: Record<string, { series: number; events: number; error?: string; skipped?: string }>;
  series: { written: number; unchanged: number; kept: string[] };
  events: { written: number; removed: number };
  companies: { written: number; removed: number; total: number };
  note: string;
};

const sameArr = (a: unknown, b: unknown[]) => Array.isArray(a) && a.length === b.length && a.every((x, i) => x === b[i]);

export async function runMacroSync(opts: { store?: DocStore; dryRun?: boolean; now?: Date; only?: MacroSourceId[] } = {}): Promise<MacroReport> {
  const now = opts.now ?? new Date(); const checked = now.toISOString(); const store = opts.store ?? openStore();
  const report: MacroReport = { date: checked.slice(0, 10), dryRun: !!opts.dryRun, store: store.kind, sources: {}, series: { written: 0, unchanged: 0, kept: [] }, events: { written: 0, removed: 0 }, companies: { written: 0, removed: 0, total: 0 }, note: "" };
  const prevMeta = (await store.list("macrosync")).find((d) => d.id === "_meta")?.data; const state: State = { ...((prevMeta?.state as State) ?? {}) };

  // 1. fetch every source; one failing source doesn't stop the others
  const series: MacroSeries[] = []; const events: CalEvent[] = []; const companies: FormD[] = []; const failed = new Set<MacroSourceId>();
  for (const s of MACRO_SOURCES) {
    if (opts.only && !opts.only.includes(s.id)) continue;
    if (s.needs && !s.needs.split("|").some((k) => envKey(k))) { report.sources[s.id] = { series: 0, events: 0, skipped: `${s.needs.replace("|", " or ")} not set` }; continue; }
    try { const r = await s.run(now, state); series.push(...(r.series ?? [])); events.push(...(r.events ?? [])); companies.push(...(r.companies ?? [])); Object.assign(state, r.state ?? {}); report.sources[s.id] = { series: r.series?.length ?? 0, events: (r.events?.length ?? 0) + (r.companies?.length ?? 0) }; }
    catch (e) { failed.add(s.id); report.sources[s.id] = { series: 0, events: 0, error: scrub(String((e as Error)?.message ?? e)).slice(0, 300) }; }
  }

  // 2. series → adm_series docs
  const existing = new Map((await store.list("adm_series")).map((d) => [d.id, d.data]));
  // Indicators the owner already feeds into the macro panels, per country: those stay the owner's.
  const ownerMi = new Set([...existing.values()].filter((x) => x.gen !== GEN && x.mi).map((x) => `${x.cc}|${x.mi}`));
  const writes: Doc[] = [];
  for (const s of series) {
    if (!s.points.length) continue;
    const id = `${s.cc}.${s.code}`; const cur = existing.get(id);
    if (cur && cur.gen !== GEN) { report.series.kept.push(id); continue; }
    const d = s.points.map((p) => p.t), v = s.points.map((p) => p.v);
    const mi = s.mi && !ownerMi.has(`${s.cc}|${s.mi}`) ? s.mi : "";
    if (cur && sameArr(cur.d, d) && sameArr(cur.v, v) && (cur.mi ?? "") === mi) { report.series.unchanged++; continue; }
    writes.push({ id, data: { kind: "eco", cc: s.cc, code: s.code, name: s.name, unit: s.unit, cat: s.cat, freq: s.freq, mi, src: s.src, url: s.url, notes: s.notes, arr: ["d", "v"], d, v, n: d.length, parts: 1, gen: GEN, upd: checked } });
  }
  report.series.written = writes.length;

  // 3. events → adm_cal docs (auto-<id>); past auto events older than 60 days are removed
  const cal = await store.list("adm_cal");
  const calWrites: Doc[] = events.map((e) => ({ id: `auto-${e.id}`, data: { title: e.title, date: e.date, time: e.time ?? "", cc: e.cc, cat: e.cat, imp: e.imp, unit: e.unit ?? "", cons: e.cons ?? "", prior: e.prior ?? "", actual: e.actual ?? "", ids: e.ids ?? [], srcName: e.srcName, url: e.url, notes: e.notes ?? "", gen: GEN, upd: checked } }));
  const fresh = new Set(calWrites.map((d) => d.id)); const cutoff = new Date(now.getTime() - 60 * 864e5).toISOString().slice(0, 10);
  // Upcoming auto events the source no longer lists (e.g. a rescheduled auction) are removed too, but only when that source answered.
  const answered = (id: string) => { const src = EVENT_SOURCE.find(([p]) => id.startsWith(p))?.[1]; const r = src ? report.sources[src] : undefined; return !!r && !r.error && !r.skipped; };
  const stale = cal.filter((d) => d.data.gen === GEN && !fresh.has(d.id) && (String(d.data.date) < cutoff || (String(d.data.date) >= report.date && answered(d.id)))).map((d) => d.id);
  report.events = { written: calWrites.length, removed: stale.length };

  // 4. Form D filings → adm_priv/secd-<cik>: one company per issuer, each new filing adds a round
  const priv = new Map((await store.list("adm_priv")).map((d) => [d.id, d.data]));
  const privWrites = new Map<string, Record<string, unknown>>();
  for (const f of companies) {
    const id = `secd-${f.cik}`; const cur = privWrites.get(id) ?? priv.get(id);
    if (cur && cur.gen !== GEN) continue; // the owner's own entry
    const old = Array.isArray(cur?.rounds) ? (cur!.rounds as { acc?: string }[]) : [];
    if (old.some((r) => r.acc === f.accession)) continue;
    const rounds = [...old, { date: f.firstSale ?? f.filed, type: "Private placement (Form D)", amt: f.sold, post: null, lead: "Undisclosed", acc: f.accession, offered: f.offered }]
      .sort((a, b) => String((a as { date?: string }).date).localeCompare(String((b as { date?: string }).date)));
    const raised = rounds.reduce((a, r) => a + (Number((r as { amt?: number }).amt) || 0), 0);
    privWrites.set(id, { kind: "co", name: f.name, sector: f.sector, industry: f.industry, cc: f.cc, city: f.city, founded: f.founded, stage: "Private placement", owner: "Private", rounds, raised,
      desc: `Raised US$${((f.sold ?? 0) / 1e6).toFixed(1)}m in a Regulation D private placement (SEC Form D filed ${f.filed}${f.offered ? `, offering US$${(f.offered / 1e6).toFixed(1)}m` : ""}). Issuer: ${f.entityType || "—"}, ${f.city ? `${f.city}, ` : ""}${f.state}.${f.people.length ? ` Related persons: ${f.people.join("; ")}.` : ""} Filing: ${f.url}`,
      web: "", srcName: "SEC Form D (EDGAR)", gen: GEN, upd: checked, last: rounds.at(-1) && (rounds.at(-1) as { date: string }).date });
  }
  // retire issuers with no filing in a year, and keep the newest 500
  const allGen = new Map([...priv].filter(([, x]) => x.gen === GEN)); for (const [id, x] of privWrites) allGen.set(id, x);
  const yearAgo = isoDay(now.getTime() - 365 * 864e5);
  const ranked = [...allGen].sort(([, a], [, b]) => String(b.last ?? "").localeCompare(String(a.last ?? "")));
  const privRemove = ranked.filter(([, x], i) => i >= 500 || String(x.last ?? "") < yearAgo).map(([id]) => id).filter((id) => priv.has(id));
  for (const id of privRemove) privWrites.delete(id);
  report.companies = { written: privWrites.size, removed: privRemove.length, total: ranked.length - privRemove.length };

  const ok = Object.values(report.sources).filter((s) => !s.error && !s.skipped).length; const tried = Object.keys(report.sources).length;
  report.note = `${ok} of ${tried} sources answered; ${report.series.written} series updated (${report.series.unchanged} unchanged), ${calWrites.length} calendar events, ${report.companies.written} private companies from Form D${report.series.kept.length ? `; ${report.series.kept.length} owner series left as they are` : ""}.${failed.size ? ` Failed: ${[...failed].join(", ")}.` : ""}`;
  if (!opts.dryRun) {
    if (writes.length) await store.upsert("adm_series", writes);
    if (calWrites.length) await store.upsert("adm_cal", calWrites);
    if (stale.length) await store.remove("adm_cal", stale);
    if (privWrites.size) await store.upsert("adm_priv", [...privWrites].map(([id, data]) => ({ id, data })));
    if (privRemove.length) await store.remove("adm_priv", privRemove);
    await store.upsert("macrosync", [{ id: "_meta", data: { type: "meta", checked, n: report.series.written + report.series.unchanged + calWrites.length + report.companies.total, note: report.note, sources: report.sources, state } }]);
  }
  return report;
}
