/**
 * Pension sync: fund-level private-markets performance reported by U.S. public
 * pension funds (CalPERS, Washington State Investment Board, Oregon Treasury),
 * written as private funds for the app's Fund performance pages:
 *
 *   adm_priv/lp-<fund slug>  { kind:'fund', name, mgr, strat, vintage, irr, tvpi, dpi, geo, asof, srcName,
 *                              lps: [{ pension, lp, commit, paid, dist, nav, irr, tvpi, dpi, asof, src, url }],
 *                              desc, gen:'pension-sync' }
 *   pensionsync/_meta        last-run summary { checked, n, note, sources }   (read by the sync-health check)
 *
 * One document per fund: a fund reported by several pensions keeps each LP's
 * figures in `lps`, and its headline IRR / TVPI / DPI are the most recent report's
 * (ties: the largest commitment). Each pension's figures are its own (net to that
 * LP) and credited to it. A pension whose report can't be read this run keeps its
 * previous figures. Owner documents (no gen:'pension-sync') are never touched.
 */
import "server-only";
import { scrub } from "@/lib/providers";
import { openStore, type Doc, type DocStore } from "@/lib/market/store";
import { calpers, oregon, wsib, PENSIONS, pdfLines, type LpRow, type Pension, type PdfLines } from "./index";

export const GEN = "pension-sync";
const COL = "adm_priv";

/** Fund name → matching key: case, punctuation and legal suffixes removed. */
export function fundKey(name: string): string {
  return name.toLowerCase().replace(/&/g, " and ").replace(/\b(l\.?\s?p\.?|llc|ltd|limited|inc|s\.?c\.?a\.?|scsp|sicav|the)\b/g, " ").replace(/\([^)]*\)/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
}
export const fundId = (name: string) => `lp-${fundKey(name).replace(/ /g, "-").slice(0, 80)}`;
/** Display name: the reported name without a trailing ", L.P." */
const cleanName = (n: string) => n.replace(/,?\s*(L\.?\s?P\.?|LLC|Ltd\.?)\s*$/i, "").trim();
const ROMAN = /^(?:[IVXL]+|[A-Z]?\d+[A-Z]?|fund|partners|capital|investors?|equity|ventures?|growth|opportunit(?:y|ies)|holdings|associates|offshore|parallel|co-?invest(?:ment)?)$/i;
/** Manager guessed from the fund name: the words before the first generic one ("Blackstone Capital Partners VII" → "Blackstone"). */
export function managerOf(name: string): string {
  const w = cleanName(name).replace(/,/g, "").split(/\s+/); const i = w.findIndex((x, k) => k > 0 && ROMAN.test(x));
  return (i > 0 ? w.slice(0, i) : w.slice(0, 1)).join(" ");
}
function geoOf(name: string): string {
  const s = name.toLowerCase();
  if (/africa/.test(s)) return "Africa"; if (/asia|china|india|japan|korea/.test(s)) return "Asia"; if (/europe|euro|nordic|uk\b|german|france/.test(s)) return "Europe";
  if (/latin|brazil|mexico/.test(s)) return "Latin America"; if (/emerging/.test(s)) return "Emerging markets"; if (/north america|\bus\b|u\.s\.|america/.test(s)) return "North America";
  return "Global";
}

type LpEntry = Omit<LpRow, "name" | "strat" | "vintage"> & { name: string };
export const PENSION_SOURCES: { id: Pension; run: (now: Date, lines: PdfLines) => Promise<LpRow[]> }[] = [
  { id: "calpers", run: () => calpers() },
  { id: "wsib", run: (now, lines) => wsib(now, lines) },
  { id: "oregon", run: (_now, lines) => oregon(lines) },
];

export type PensionReport = { date: string; dryRun: boolean; sources: Record<string, { rows: number; asof?: string; error?: string }>; funds: { written: number; unchanged: number; removed: number; total: number; kept: string[] }; note: string };

export async function runPensionSync(opts: { store?: DocStore; dryRun?: boolean; now?: Date; only?: Pension[]; lines?: PdfLines } = {}): Promise<PensionReport> {
  const now = opts.now ?? new Date(); const checked = now.toISOString(); const store = opts.store ?? openStore();
  const report: PensionReport = { date: checked.slice(0, 10), dryRun: !!opts.dryRun, sources: {}, funds: { written: 0, unchanged: 0, removed: 0, total: 0, kept: [] }, note: "" };
  const rows: LpRow[] = []; const answered = new Set<Pension>();
  for (const s of PENSION_SOURCES) {
    if (opts.only && !opts.only.includes(s.id)) continue;
    try { const r = await s.run(now, opts.lines ?? pdfLines); rows.push(...r); answered.add(s.id); report.sources[s.id] = { rows: r.length, asof: r.map((x) => x.asof).sort().at(-1) }; }
    catch (e) { report.sources[s.id] = { rows: 0, error: scrub(String((e as Error)?.message ?? e)).slice(0, 300) }; }
  }

  const priv = new Map((await store.list(COL)).map((d) => [d.id, d.data]));
  // Start from each stored pension fund's LP entries; pensions that answered replace theirs.
  const byId = new Map<string, { lps: LpEntry[]; rows: LpRow[] }>();
  for (const [id, x] of priv) if (x.gen === GEN && id.startsWith("lp-")) byId.set(id, { lps: ((x.lps as LpEntry[] | undefined) ?? []).filter((l) => !answered.has(l.pension)), rows: [] });
  for (const r of rows) {
    const id = fundId(r.name); if (id === "lp-") continue;
    const cur = priv.get(id); if (cur && cur.gen !== GEN) { if (!report.funds.kept.includes(id)) report.funds.kept.push(id); continue; }
    const e = byId.get(id) ?? byId.set(id, { lps: [], rows: [] }).get(id)!;
    if (e.lps.some((l) => l.pension === r.pension)) continue; // the same fund twice in one report (e.g. two tables): first wins
    e.rows.push(r);
    e.lps.push({ pension: r.pension, lp: r.lp, name: r.name, commit: r.commit, paid: r.paid, dist: r.dist, nav: r.nav, irr: r.irr, tvpi: r.tvpi, dpi: r.dpi, asof: r.asof, src: r.src, url: r.url });
  }

  const writes: Doc[] = []; const remove: string[] = [];
  for (const [id, e] of byId) {
    if (!e.lps.length) { if (priv.has(id)) remove.push(id); continue; }
    const lps = [...e.lps].sort((a, b) => b.asof.localeCompare(a.asof) || (b.commit ?? 0) - (a.commit ?? 0));
    const head = lps[0]; const prev = priv.get(id);
    const name = cleanName(head.name);
    const strat = e.rows[0]?.strat ?? (prev?.strat as string) ?? "Buyout";
    const vintage = e.rows.map((r) => r.vintage).find((v) => v != null) ?? (prev?.vintage as number | undefined) ?? null;
    const data: Record<string, unknown> = {
      kind: "fund", name, mgr: managerOf(name), strat, vintage, irr: head.irr, tvpi: head.tvpi, dpi: head.dpi, geo: geoOf(name), asof: head.asof,
      srcName: lps.length > 1 ? `Public pension reports (${lps.map((l) => PENSIONS[l.pension].lp.split(" (")[0]).join(", ")})` : head.src,
      lps, desc: `Net performance as reported by ${lps.map((l) => `${l.lp} (as of ${l.asof})`).join("; ")}. Figures are each pension's own: net IRR and multiples on its commitment. Manager inferred from the fund name.`,
      gen: GEN,
    };
    const sig = (x: Record<string, unknown> | undefined) => (x ? JSON.stringify([x.name, x.strat, x.vintage, x.irr, x.tvpi, x.dpi, x.asof, x.lps]) : "");
    if (prev && sig(prev) === sig(data)) { report.funds.unchanged++; continue; }
    writes.push({ id, data: { ...data, upd: checked } });
  }
  report.funds.written = writes.length; report.funds.removed = remove.length;
  report.funds.total = [...byId.values()].filter((e) => e.lps.length).length;
  const ok = Object.values(report.sources).filter((s) => !s.error); const failed = Object.entries(report.sources).filter(([, s]) => s.error).map(([k]) => k);
  report.note = `${ok.length} of ${Object.keys(report.sources).length} pension reports read (${Object.entries(report.sources).map(([k, s]) => `${PENSIONS[k as Pension].lp.split(" (")[0]} ${s.rows}${s.asof ? ` as of ${s.asof}` : ""}`).join(", ")}); ${report.funds.total} funds, ${writes.length} updated${remove.length ? `, ${remove.length} no longer reported removed` : ""}${report.funds.kept.length ? `; ${report.funds.kept.length} owner entries left as they are` : ""}.${failed.length ? ` Failed: ${failed.join(", ")}.` : ""}`;
  if (!opts.dryRun) {
    if (writes.length) await store.upsert(COL, writes);
    if (remove.length) await store.remove(COL, remove);
    const prevMeta = (await store.list("pensionsync")).find((d) => d.id === "_meta")?.data;
    await store.upsert("pensionsync", [{ id: "_meta", data: { type: "meta", checked, n: report.funds.total, note: report.note, sources: { ...(opts.only ? (prevMeta?.sources as PensionReport["sources"] | undefined) ?? {} : {}), ...report.sources } } }]);
  }
  return report;
}
