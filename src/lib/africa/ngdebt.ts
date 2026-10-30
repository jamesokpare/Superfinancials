/**
 * Nigerian money-market and government-bond data from the official publishers (no key):
 *
 *   Central Bank of Nigeria   money-market indicators, https://www.cbn.gov.ng/rates/mnymktind.asp?year=YYYY
 *                             (a table by date: interbank call, open buy back, NIBOR tenors, MPR, T-bill
 *                             rates; the page also offers an Excel export, read when the table is missing)
 *   Debt Management Office    FGN bond auction results, https://www.dmo.gov.ng/fgn-bonds/bonds-auction-results
 *                             (one PDF per auction: amount offered, subscribed and allotted, and the
 *                             marginal (stop) rate of each bond; read from the PDF's text layer)
 *
 * Both are public statistics; the app credits "Central Bank of Nigeria" and "Debt Management
 * Office Nigeria" with a link to the page. Column headings and the PDF layout are matched
 * loosely, because both publishers change them from time to time.
 */
import { ProviderError } from "@/lib/providers/http";
import { readXlsx } from "@/lib/macro/xlsx";
import { pdfText } from "@/lib/pdftext";

export type Pt = { t: string; v: number };
export type NgSeries = { code: string; name: string; unit: string; cat: string; freq: string; src: string; url: string; notes: string; points: Pt[] };

const UA = { "user-agent": "Mozilla/5.0 (compatible; Superfinancials data sync; +https://github.com/jamesokpare/Superfinancials)" };
async function get(name: string, url: string, accept = "text/html, */*", timeoutMs = 60_000): Promise<{ buf: Buffer; type: string; url: string }> {
  let res: Response;
  try { res = await fetch(url, { headers: { ...UA, accept }, signal: AbortSignal.timeout(timeoutMs) }); }
  catch (e) { throw new ProviderError(name, `request failed: ${(e as Error).message}`); }
  const buf = Buffer.from(await res.arrayBuffer());
  if (!res.ok) throw new ProviderError(name, `HTTP ${res.status}: ${buf.toString("utf8", 0, 120)}`, res.status);
  return { buf, type: res.headers.get("content-type") ?? "", url: res.url || url };
}

// --- shared parsing helpers ----------------------------------------------------------------
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad = (n: number) => String(n).padStart(2, "0");
const monthEnd = (y: number, m: number) => `${y}-${pad(m)}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
const valid = (y: number, m: number, d: number) => y > 1990 && y < 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31;
/** A date as written in CBN and DMO documents → yyyy-mm-dd (day/month order, Nigerian style); a month alone → its last day. */
export function ngDate(v: unknown): string | null {
  if (typeof v === "number") { if (v > 30000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + v * 864e5).toISOString().slice(0, 10); return null; } // Excel serial
  const s = String(v ?? "").trim().replace(/(\d)(st|nd|rd|th)\b/gi, "$1").replace(/\s+/g, " ");
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m && valid(+m[1], +m[2], +m[3])) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) { const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; let d = +m[1], mo = +m[2]; if (mo > 12 && d <= 12) [d, mo] = [mo, d]; return valid(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : null; }
  const mon = (w: string) => MONTHS.indexOf(w.slice(0, 3).toLowerCase()) + 1;
  m = s.match(/^(\d{1,2})[ -]([A-Za-z]{3,9})[ ,-]+(\d{2,4})$/); if (m && mon(m[2])) { const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; return valid(y, mon(m[2]), +m[1]) ? `${y}-${pad(mon(m[2]))}-${pad(+m[1])}` : null; }
  m = s.match(/^([A-Za-z]{3,9}) (\d{1,2}),? (\d{4})$/); if (m && mon(m[1]) && valid(+m[3], mon(m[1]), +m[2])) return `${m[3]}-${pad(mon(m[1]))}-${pad(+m[2])}`;
  m = s.match(/^([A-Za-z]{3,9})[ ,-]+(\d{2,4})$/); if (m && mon(m[1])) { const y = +m[2] < 100 ? 2000 + +m[2] : +m[2]; return y > 1990 ? monthEnd(y, mon(m[1])) : null; }
  return null;
}
const num = (v: unknown): number | null => { if (typeof v === "number") return Number.isFinite(v) ? v : null; const t = String(v ?? "").replace(/[,%\s]/g, ""); if (!/^-?\d+(\.\d+)?$/.test(t)) return null; return Number(t); };
const unhtml = (s: string) => s.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d)).replace(/\s+/g, " ").trim();

/** Every <table> in an HTML page as rows of cell texts; a cell spanning n columns is repeated n times. */
export function htmlTables(html: string): string[][][] {
  const out: string[][][] = [];
  for (const t of html.match(/<table[\s\S]*?<\/table>/gi) ?? []) {
    const rows: string[][] = [];
    for (const tr of t.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
      const cells: string[] = [];
      for (const m of tr.matchAll(/<t([dh])([^>]*)>([\s\S]*?)<\/t\1>/gi)) { const span = Math.min(20, Number(/colspan\s*=\s*["']?(\d+)/i.exec(m[2])?.[1] ?? 1) || 1); const v = unhtml(m[3]); for (let i = 0; i < span; i++) cells.push(v); }
      if (cells.length) rows.push(cells);
    }
    if (rows.length) out.push(rows);
  }
  return out;
}

// --- CBN money-market indicators -------------------------------------------------------------
export const CBN_URL = "https://www.cbn.gov.ng/rates/mnymktind.asp";
const CBN_NOTE = "Source: Central Bank of Nigeria, money market indicators (cbn.gov.ng). Rates in percent a year as published.";
/** A column heading → [series code, name], or null for columns that aren't kept. */
export function cbnColumn(h: string): [string, string] | null {
  const s = h.toLowerCase().replace(/\s+/g, " ");
  const tenor = (): string | null => {
    if (/over ?night|\bo\/n\b|\bon\b/.test(s)) return "ON";
    const d = s.match(/(\d{1,3}) ?-?(day|d\b)/); if (d) return `${+d[1]}D`;
    const m = s.match(/(\d{1,2}) ?-?(month|mth|m\b)/); if (m) return `${+m[1]}M`;
    return null;
  };
  if (/monetary policy rate|\bmpr\b/.test(s)) return ["MPR", "CBN monetary policy rate"];
  if (/nibor/.test(s)) { const t = tenor(); return t ? [`NIBOR${t}`, `NIBOR ${t === "ON" ? "overnight" : t.replace(/D$/, "-day").replace(/M$/, "-month")}`] : null; }
  if (/t(reasury)?[\s.-]*bills?|ntb/.test(s)) { const d = s.match(/(91|182|364)/); return d ? [`TB${d[1]}`, `Treasury bill rate, ${d[1]}-day`] : null; }
  if (/open buy ?back|\bobb\b/.test(s)) return ["OBB", "Open buy back (OBB) rate"];
  if (/inter-?bank call|\bcall\b/.test(s)) return ["IBCALL", "Interbank call rate"];
  if (/over ?night|\bo\/n\b/.test(s)) return ["ON", "Overnight interbank rate"];
  return null;
}
/** Rows of a money-market table (HTML or spreadsheet) → series points by code. */
export function readCbnRows(rows: (string | number)[][]): Map<string, { name: string; points: Pt[] }> {
  const out = new Map<string, { name: string; points: Pt[] }>();
  const first = rows.findIndex((r) => ngDate(r[0]) && r.slice(1).some((c) => num(c) !== null)); if (first < 0) return out;
  // Headings: up to two rows above the first data row (a group heading such as "NIBOR" over tenors).
  const heads = rows.slice(Math.max(0, first - 2), first).map((r) => r.map((c) => String(c ?? "")));
  const width = Math.max(...rows.slice(first, first + 5).map((r) => r.length));
  const cols: ([string, string] | null)[] = Array.from({ length: width }, (_, i) => (i === 0 ? null : cbnColumn(heads.map((r) => r[i] ?? "").join(" "))));
  const seen = new Set<string>(); cols.forEach((c, i) => { if (c && seen.has(c[0])) cols[i] = null; else if (c) seen.add(c[0]); });
  for (const r of rows.slice(first)) {
    const t = ngDate(r[0]); if (!t) continue;
    cols.forEach((c, i) => { if (!c) return; const v = num(r[i]); if (v === null || v < 0 || v > 100) return; (out.get(c[0]) ?? out.set(c[0], { name: c[1], points: [] }).get(c[0])!).points.push({ t, v }); });
  }
  return out;
}
const isZip = (b: Buffer) => b.length > 4 && b.readUInt32LE(0) === 0x04034b50;
function rowsOf(buf: Buffer, type: string): (string | number)[][][] {
  if (isZip(buf)) return [readXlsx(buf)];
  const text = buf.toString("utf8");
  if (/text\/csv/i.test(type) || (!/</.test(text.slice(0, 200)) && /,/.test(text.slice(0, 200)))) return [text.split(/\r?\n/).map((l) => l.split(",").map((c) => c.replace(/^"|"$/g, "").trim()))];
  return htmlTables(text);
}
export async function cbnMoneyMarket(now: Date, years = 2): Promise<NgSeries[]> {
  const merged = new Map<string, { name: string; pts: Map<string, number> }>(); const errs: string[] = [];
  for (let y = now.getUTCFullYear() - years + 1; y <= now.getUTCFullYear(); y++) {
    try {
      const page = await get("CBN", `${CBN_URL}?year=${y}`);
      let tables = rowsOf(page.buf, page.type);
      let found = tables.map(readCbnRows).filter((m) => m.size);
      if (!found.length && !isZip(page.buf)) {
        // No table on the page: follow its Excel / CSV export.
        const href = /href\s*=\s*["']([^"']+\.(?:xlsx?|csv)[^"']*)["']/i.exec(page.buf.toString("utf8"))?.[1];
        if (href) { const f = await get("CBN", new URL(href, page.url).toString(), "*/*"); tables = rowsOf(f.buf, f.type); found = tables.map(readCbnRows).filter((m) => m.size); }
      }
      for (const m of found) for (const [code, s] of m) { const cur = merged.get(code) ?? merged.set(code, { name: s.name, pts: new Map() }).get(code)!; for (const p of s.points) cur.pts.set(p.t, p.v); }
    } catch (e) { errs.push((e as Error).message); }
  }
  if (!merged.size) throw errs.length ? new ProviderError("CBN", errs[0]) : new ProviderError("CBN", "no money-market table found");
  return [...merged].map(([code, s]) => {
    const points = [...s.pts].sort(([a], [b]) => (a < b ? -1 : 1)).map(([t, v]) => ({ t, v }));
    const gap = points.length > 2 ? (Date.parse(points.at(-1)!.t) - Date.parse(points[0].t)) / 864e5 / (points.length - 1) : 1;
    return { code, name: s.name, unit: "%", cat: "mp", freq: gap > 20 ? "M" : "D", src: "Central Bank of Nigeria", url: CBN_URL, notes: CBN_NOTE, points };
  });
}

// --- DMO FGN bond auctions ---------------------------------------------------------------------
export const DMO_URL = "https://www.dmo.gov.ng/fgn-bonds/bonds-auction-results";
export type Bond = { name: string; coupon: number; maturity: string; years: number | null; offered: number | null; subscribed: number | null; allotted: number | null; marginal: number | null };
export type Auction = { date: string; url: string; bonds: Bond[] };

/** Auction result documents linked from the DMO listing page (newest first, as listed). */
export function dmoLinks(html: string, base: string): { url: string; title: string }[] {
  const out: { url: string; title: string }[] = []; const seen = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = m[1].replace(/&amp;/g, "&"); const title = unhtml(m[2]);
    if (!/auction/i.test(href + " " + title) || !/result/i.test(href + " " + title)) continue;
    if (!/\.pdf\b|download|\/file|docman/i.test(href)) continue;
    let url: string; try { url = new URL(href, base).toString(); } catch { continue; }
    if (!seen.has(url)) { seen.add(url); out.push({ url, title }); }
  }
  return out;
}
const MON3: Record<string, number> = Object.fromEntries(MONTHS.map((m, i) => [m, i + 1]));
const NUM_RE = /-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?/g;
/** Text of an FGN bond auction result PDF → auction date and per-bond results (amounts in ₦ billion). */
export function readDmoAuction(text: string, url: string, fallbackDate?: string | null): Auction | null {
  const flat = text.replace(/\s+/g, " ");
  // Bonds named like "19.30% FGN APR 2029", in column order.
  const bonds: Bond[] = []; const seen = new Set<string>();
  for (const m of flat.matchAll(/(\d{1,2}(?:\.\d{1,4})?)\s*%\s*FGN\s+([A-Z]{3})[A-Z]*\.?\s+(\d{4})/gi)) {
    const mon = MON3[m[2].toLowerCase()]; if (!mon) continue; const key = `${m[1]}|${m[2].toUpperCase()}|${m[3]}`; if (seen.has(key)) continue; seen.add(key);
    bonds.push({ name: `${m[1]}% FGN ${m[2].toUpperCase()} ${m[3]}`, coupon: +m[1], maturity: monthEnd(+m[3], mon), years: null, offered: null, subscribed: null, allotted: null, marginal: null });
  }
  if (!bonds.length) return null;
  const dm = flat.match(/auction(?:\s+(?:held|conducted))?(?:\s+on|\s+date)?\s*[:\-–]?\s*(?:[A-Za-z]+day,?\s+)?(\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9},?\s+\d{4}|[A-Za-z]{3,9}\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}|\d{1,2}[/.-]\d{1,2}[/.-]\d{4})/i)
    ?? flat.match(/(\d{1,2}(?:st|nd|rd|th)?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December),?\s+\d{4}|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})/i);
  const date = (dm && ngDate(dm[1].replace(",", ""))) || fallbackDate || null; if (!date) return null;
  for (const b of bonds) b.years = Math.max(1, Math.round((Date.parse(b.maturity) - Date.parse(date)) / (365.25 * 864e5)));
  // Each result row: a label followed by one figure per bond.
  const lines = text.split(/\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const LABELS: [keyof Bond, RegExp][] = [["offered", /amount offered|offer(ed)? ?(amount|size)|^offer\b/i], ["subscribed", /total subscription|subscription|subscribed|total bids/i], ["allotted", /allot|successful bids|amount sold|total sales/i], ["marginal", /marginal|stop rate|clearing rate/i]];
  const isLabel = (l: string) => LABELS.some(([, re]) => re.test(l));
  for (const [k, re] of LABELS) {
    const i = lines.findIndex((l) => re.test(l) && !/range|non-competitive|coupon/i.test(l.replace(re, ""))); if (i < 0) continue;
    const labelEnd = lines[i].search(re) + (lines[i].match(re)?.[0].length ?? 0);
    const vals: number[] = []; let s = lines[i].slice(labelEnd);
    for (let j = i; j < lines.length && vals.length < bonds.length; j++) {
      if (j > i) { if (isLabel(lines[j])) break; s = lines[j]; }
      for (const m of s.replace(/\(N\)|N'?bn|₦/gi, " ").matchAll(NUM_RE)) { const v = Number(m[0].replace(/,/g, "")); if (Number.isFinite(v)) vals.push(v); if (vals.length >= bonds.length) break; }
    }
    if (vals.length !== bonds.length) continue;
    vals.forEach((v, n) => { (bonds[n] as Record<string, unknown>)[k] = k === "marginal" ? (v > 0 && v < 60 ? v : null) : v > 1e6 ? Number((v / 1e9).toFixed(3)) : v; });
  }
  if (!bonds.some((b) => b.marginal !== null || b.allotted !== null)) return null;
  return { date, url, bonds };
}
const bn = (v: number | null) => (v === null ? "—" : `₦${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}bn`);
export function auctionEvent(a: Auction, upd: string, gen: string) {
  const parts = a.bonds.map((b) => `${b.name} (${b.years}-year): offered ${bn(b.offered)}, subscribed ${bn(b.subscribed)}, allotted ${bn(b.allotted)}, marginal rate ${b.marginal === null ? "—" : b.marginal.toFixed(2) + "%"}.`);
  const actual = a.bonds.filter((b) => b.marginal !== null).map((b) => `${b.years}y ${b.marginal!.toFixed(2)}%`).join(", ");
  return { id: `auto-dmo-${a.date}`, title: "Nigeria: FGN bond auction results", date: a.date, time: "", cc: "NG", cat: "auc", imp: 2 as const, unit: "%", cons: "", prior: "", actual, ids: [], srcName: "Debt Management Office Nigeria", url: a.url, notes: `${parts.join(" ")} Source: Debt Management Office Nigeria (dmo.gov.ng), FGN bond auction results.`, gen, upd };
}
/** Marginal rates by tenor (years to maturity at the auction) as series points. */
export function auctionSeries(as: Auction[]): NgSeries[] {
  const by = new Map<number, Map<string, number>>();
  for (const a of as) for (const b of a.bonds) if (b.marginal !== null && b.years) (by.get(b.years) ?? by.set(b.years, new Map()).get(b.years)!).set(a.date, b.marginal);
  return [...by].map(([y, m]) => ({ code: `DMO${y}Y`, name: `FGN bond auction marginal rate, ${y}-year`, unit: "%", cat: "mk", freq: "M", src: "Debt Management Office Nigeria", url: DMO_URL,
    notes: `Marginal (stop) rate at the monthly FGN bond auction for bonds with about ${y} years to maturity. Source: Debt Management Office Nigeria (dmo.gov.ng).`, points: [...m].sort(([a], [b]) => (a < b ? -1 : 1)).map(([t, v]) => ({ t, v })) }));
}
/** New auction result PDFs (not in `done`), up to `budget` per run. */
export async function dmoAuctions(done: Set<string>, budget = 3, read: (b: Buffer) => Promise<string> = pdfText): Promise<{ auctions: Auction[]; tried: string[]; listed: number }> {
  const page = await get("DMO", DMO_URL); const links = dmoLinks(page.buf.toString("utf8"), page.url);
  if (!links.length) throw new ProviderError("DMO", "no auction result documents found on the listing page");
  const auctions: Auction[] = []; const tried: string[] = []; const errs: string[] = [];
  for (const l of links.filter((x) => !done.has(x.url)).slice(0, budget)) {
    try {
      let f = await get("DMO", l.url, "application/pdf, */*", 90_000);
      if (f.buf.toString("latin1", 0, 5) !== "%PDF-") { const href = /href\s*=\s*["']([^"']+\.pdf[^"']*)["']/i.exec(f.buf.toString("utf8"))?.[1]; if (!href) throw new Error("not a PDF"); f = await get("DMO", new URL(href.replace(/&amp;/g, "&"), f.url).toString(), "application/pdf, */*", 90_000); }
      tried.push(l.url);
      const a = readDmoAuction(await read(f.buf), l.url, ngDate(l.title.match(/\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+,?\s+\d{4}|[A-Za-z]+\s+\d{1,2},?\s+\d{4}|[A-Za-z]+,?\s+\d{4}/)?.[0]?.replace(",", "") ?? ""));
      if (a) auctions.push(a);
    } catch (e) { errs.push(`${l.url}: ${(e as Error).message}`); }
  }
  if (!tried.length && errs.length) throw new ProviderError("DMO", errs[0]);
  return { auctions, tried, listed: links.length };
}
