/**
 * SEC XBRL "frames": one figure for every U.S. filer for one period, from the
 * financial statements companies tag in their 10-K and 10-Q filings
 * (public domain, no key; SEC asks for a contact User-Agent and ≤ 10 requests a second).
 *
 *   https://data.sec.gov/api/xbrl/frames/<taxonomy>/<concept>/<unit>/<period>.json
 *     period CY2026Q2 = calendar quarter (durations of about 91 days),
 *            CY2025   = annual (durations of about 365 days, matched to the calendar year they mostly cover),
 *            CY2026Q2I = instant (balance-sheet values at the quarter's end)
 *
 * Kept per company: EPS (diluted, else basic) and revenue (Revenues, else
 * RevenueFromContractWithCustomerExcludingAssessedTax, else SalesRevenueNet)
 * for the last 8 quarters and 3 years, and shares outstanding (dei). One frame
 * answers for ~6,000 companies, so ~57 requests cover the whole U.S. market.
 */
import { ProviderError } from "@/lib/providers/http";

export type FrameSpec = { key: string; tax: "us-gaap" | "dei"; concept: string; unit: string; field: "eps" | "rev" | "sh"; rank: number };
/** Concepts in order of preference within each field (rank 0 wins). */
export const FRAME_CONCEPTS: Omit<FrameSpec, "key">[] = [
  { tax: "us-gaap", concept: "Revenues", unit: "USD", field: "rev", rank: 0 },
  { tax: "us-gaap", concept: "RevenueFromContractWithCustomerExcludingAssessedTax", unit: "USD", field: "rev", rank: 1 },
  { tax: "us-gaap", concept: "SalesRevenueNet", unit: "USD", field: "rev", rank: 2 },
  { tax: "us-gaap", concept: "EarningsPerShareDiluted", unit: "USD-per-shares", field: "eps", rank: 0 },
  { tax: "us-gaap", concept: "EarningsPerShareBasic", unit: "USD-per-shares", field: "eps", rank: 1 },
];
const SHARES: Omit<FrameSpec, "key"> = { tax: "dei", concept: "EntityCommonStockSharesOutstanding", unit: "shares", field: "sh", rank: 0 };

/** Last `n` complete calendar quarters before `now`, newest first: ["CY2026Q3", …]. */
export function lastQuarters(now: Date, n: number): { p: string; end: string }[] {
  let y = now.getUTCFullYear(), q = Math.floor(now.getUTCMonth() / 3); // quarter in progress is q+1; last complete is q
  const out: { p: string; end: string }[] = [];
  while (out.length < n) {
    if (q === 0) { y--; q = 4; }
    const end = new Date(Date.UTC(y, q * 3, 0)).toISOString().slice(0, 10);
    out.push({ p: `CY${y}Q${q}`, end }); q--;
  }
  return out;
}

/** Every frame wanted for this date: 8 quarters and 3 years of each concept, and shares at the last 2 quarter ends. */
export function framePlan(now: Date): (FrameSpec & { period: string; end: string; kind: "q" | "fy" | "i" })[] {
  const qs = lastQuarters(now, 8); const y = now.getUTCFullYear();
  const ys = [y - 1, y - 2, y - 3].map((yy) => ({ p: `CY${yy}`, end: `${yy}-12-31` }));
  const out: (FrameSpec & { period: string; end: string; kind: "q" | "fy" | "i" })[] = [];
  for (const c of FRAME_CONCEPTS) {
    for (const q of qs) out.push({ ...c, key: `${c.concept}/${q.p}`, period: q.p, end: q.end, kind: "q" });
    for (const a of ys) out.push({ ...c, key: `${c.concept}/${a.p}`, period: a.p, end: a.end, kind: "fy" });
  }
  for (const q of qs.slice(0, 2)) out.push({ ...SHARES, key: `${SHARES.concept}/${q.p}I`, period: `${q.p}I`, end: q.end, kind: "i" });
  return out;
}

export const frameUrl = (f: { tax: string; concept: string; unit: string; period: string }) => `https://data.sec.gov/api/xbrl/frames/${f.tax}/${f.concept}/${f.unit}/${f.period}.json`;

export type FramePoint = { cik: number; name: string; start?: string; end: string; val: number; accn: string };
export async function fetchFrame(f: { tax: string; concept: string; unit: string; period: string }, ua: string): Promise<FramePoint[]> {
  const url = frameUrl(f); let res: Response;
  try { res = await fetch(url, { headers: { "user-agent": ua, accept: "application/json" }, signal: AbortSignal.timeout(60_000) }); }
  catch (e) { throw new ProviderError("SEC EDGAR", `request failed: ${(e as Error).message}`); }
  if (res.status === 404) return []; // no filer has tagged this concept for the period (yet)
  if (!res.ok) throw new ProviderError("SEC EDGAR", `HTTP ${res.status} from ${url}`, res.status);
  const j = (await res.json()) as { data?: { cik?: number; entityName?: string; start?: string; end?: string; val?: number; accn?: string }[] };
  return (j.data ?? []).flatMap((d) => (Number.isFinite(Number(d.cik)) && Number.isFinite(Number(d.val)) && d.end ? [{ cik: Number(d.cik), name: String(d.entityName ?? ""), start: d.start, end: String(d.end), val: Number(d.val), accn: String(d.accn ?? "") }] : []));
}

/** One company's stored figures. Rows: period label, start, end, EPS (+ rank), revenue (+ rank). */
export type FrameRow = { p: string; s?: string; e: string; eps?: number | null; er?: number; rev?: number | null; rr?: number; acc?: string };
export type FrameCo = { cik: number; name: string; q: FrameRow[]; fy: FrameRow[]; sh?: [string, number] | null };

/** Merges one frame into the per-CIK map: a concept only replaces a value from a lower-preference concept (or its own). */
export function applyFrame(by: Map<number, FrameCo>, f: FrameSpec & { period: string; kind: "q" | "fy" | "i" }, pts: FramePoint[]): number {
  let n = 0;
  for (const p of pts) {
    const co = by.get(p.cik) ?? by.set(p.cik, { cik: p.cik, name: p.name, q: [], fy: [] }).get(p.cik)!;
    if (p.name) co.name = p.name;
    if (f.kind === "i") { if (!co.sh || co.sh[0] <= p.end) co.sh = [p.end, p.val]; n++; continue; }
    const rows = f.kind === "q" ? co.q : co.fy;
    let r = rows.find((x) => x.p === f.period); if (!r) { r = { p: f.period, e: p.end }; rows.push(r); }
    r.e = p.end; if (p.start) r.s = p.start;
    if (f.field === "eps") { if (r.er == null || f.rank <= r.er) { r.eps = p.val; r.er = f.rank; } }
    else if (f.field === "rev") { if (r.rr == null || f.rank <= r.rr) { r.rev = p.val; r.rr = f.rank; r.acc = p.accn; } }
    n++;
  }
  return n;
}

/** Keeps the periods in the plan window, newest first. */
export function trimCo(co: FrameCo, keepQ: Set<string>, keepY: Set<string>): FrameCo {
  const sort = (a: FrameRow, b: FrameRow) => (a.e < b.e ? 1 : a.e > b.e ? -1 : 0);
  return { ...co, q: co.q.filter((r) => keepQ.has(r.p)).sort(sort), fy: co.fy.filter((r) => keepY.has(r.p)).sort(sort) };
}
