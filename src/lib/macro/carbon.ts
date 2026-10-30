/**
 * North American carbon allowance auctions (quarterly, official results, no key):
 *
 *   California–Québec   joint cap-and-trade auction settlement prices (current vintage), from the
 *                       California Air Resources Board's auction results summary
 *   RGGI                Regional Greenhouse Gas Initiative (U.S. Northeast power sector) clearing prices,
 *                       from RGGI's auction results table
 *
 * Both are government or program publications; credited with a link to the results page. Series are kept
 * and added to, since a page may list only recent auctions.
 */
import { ProviderError } from "@/lib/providers/http";
import { BROWSER_UA, periodEnd, type MacroSeries, type Point } from "./sources";
import { htmlTables } from "@/lib/africa/ngdebt";
import { pdfText } from "@/lib/pdftext";

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const strip = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
async function get(name: string, url: string): Promise<Response> {
  let r: Response;
  try { r = await fetch(url, { headers: { ...BROWSER_UA, accept: "text/html, application/pdf, */*" }, signal: AbortSignal.timeout(60_000) }); } catch (e) { throw new ProviderError(name, `request failed: ${(e as Error).message}`); }
  if (!r.ok) throw new ProviderError(name, `HTTP ${r.status} from ${url}`, r.status); return r;
}
/** "September 3, 2025", "3 September 2025", "09/03/2025" (US), "2025-09-03", "Sep 2025" → ISO date. */
export function anyDate(s: string): string | null {
  const t = s.trim(); let m: RegExpMatchArray | null;
  if ((m = t.match(/(\d{4})-(\d{2})-(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = t.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/))) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  if ((m = t.match(/\b([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/)) && MONTHS[m[1].toLowerCase()]) return `${m[3]}-${String(MONTHS[m[1].toLowerCase()]).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  if ((m = t.match(/\b(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?\s+(\d{4})/)) && MONTHS[m[2].toLowerCase()]) return `${m[3]}-${String(MONTHS[m[2].toLowerCase()]).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  if ((m = t.match(/\b([A-Za-z]{3})[a-z]*\.?\s+(\d{4})\b/)) && MONTHS[m[1].toLowerCase()]) return periodEnd(`${m[2]}-${String(MONTHS[m[1].toLowerCase()]).padStart(2, "0")}`);
  return null;
}
const sorted = (pts: Point[]) => [...new Map(pts.map((p) => [p.t, p.v]))].sort(([a], [b]) => (a < b ? -1 : 1)).map(([t, v]) => ({ t, v }));

// --- RGGI ----------------------------------------------------------------------------------------------------------
export const RGGI_URL = "https://www.rggi.org/auctions/auction-results/prices-volumes";
/** The prices-and-volumes table: one row per auction with its date and clearing price. */
export function readRggi(html: string): Point[] {
  for (const tbl of htmlTables(html)) {
    const h = tbl.findIndex((r) => r.some((c) => /clearing price/i.test(c))); if (h < 0) continue;
    const head = tbl[h]; const cP = head.findIndex((c) => /clearing price/i.test(c)); const cD = head.findIndex((c) => /date/i.test(c));
    const pts = tbl.slice(h + 1).flatMap((r) => {
      const t = anyDate(cD >= 0 ? r[cD] ?? "" : r.join(" ")); const v = Number(String(r[cP] ?? "").replace(/[$,\s]/g, ""));
      return t && Number.isFinite(v) && v > 0 ? [{ t, v }] : [];
    });
    if (pts.length) return sorted(pts);
  }
  return [];
}
export async function rggiAuctions(): Promise<MacroSeries[]> {
  const pts = readRggi(await (await get("RGGI", RGGI_URL)).text());
  if (!pts.length) throw new ProviderError("RGGI", "no clearing prices in the auction results table");
  return [{ cc: "US", code: "RGGIAUC", name: "RGGI CO2 allowance auction clearing price", unit: "USD/short ton", cat: "mk", freq: "Q", src: "Regional Greenhouse Gas Initiative (RGGI), auction results", url: RGGI_URL, notes: "Clearing price of the quarterly RGGI auctions of CO2 allowances for power plants in the participating U.S. Northeast and Mid-Atlantic states. Source: RGGI, Inc.", points: pts }];
}

// --- California–Québec ------------------------------------------------------------------------------------------------
export const CARB_URL = "https://ww2.arb.ca.gov/our-work/programs/cap-and-trade-program/auction-information";
/** Links to auction result summaries (PDF) on CARB's auction information page, newest-looking first. */
export function carbResultLinks(html: string, base = CARB_URL): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"']+\.pdf)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const text = `${m[1]} ${strip(m[2])}`; if (!/result|settlement/i.test(text) || /notice|guide|instruction|regulation|bidder|webinar/i.test(text)) continue;
    try { out.add(new URL(m[1], base).toString()); } catch { /* skip */ }
  }
  return [...out].sort((a, b) => /settlement|summary/i.test(b) ? 1 : /settlement|summary/i.test(a) ? -1 : 0).slice(0, 3);
}
/**
 * Settlement prices from a results summary's text: each auction is named by month and year ("February 2026",
 * "Feb 2026") and followed by its current-vintage settlement price ("$29.61"). A history table gives every auction.
 */
export function readCarb(text: string): Point[] {
  const t = text.replace(/\s+/g, " "); const pts: Point[] = [];
  for (const m of t.matchAll(/\b(February|Feb|May|August|Aug|November|Nov)\.?\s+(20\d{2})\b([^$]{0,160}?)\$\s?(\d{1,3}\.\d{2})/gi)) {
    if (/reserve|floor|minimum|tier/i.test(m[3])) continue; // an auction reserve price or price ceiling tier, not the settlement price
    const tt = periodEnd(`${m[2]}-${String(MONTHS[m[1].slice(0, 3).toLowerCase()]).padStart(2, "0")}`); const v = Number(m[4]);
    if (tt && v > 0 && v < 500) pts.push({ t: tt, v });
  }
  // the first price found for an auction is its current-vintage settlement price
  const first = new Map<string, number>(); for (const p of pts) if (!first.has(p.t)) first.set(p.t, p.v);
  return sorted([...first].map(([tt, v]) => ({ t: tt, v })));
}
export async function carbAuctions(read: (b: Buffer) => Promise<string> = pdfText): Promise<MacroSeries[]> {
  const links = carbResultLinks(await (await get("CARB", CARB_URL)).text());
  if (!links.length) throw new ProviderError("CARB", "no auction results summary linked on the auction information page");
  const pts: Point[] = []; const errs: string[] = [];
  for (const url of links) {
    try { pts.push(...readCarb(await read(Buffer.from(await (await get("CARB", url)).arrayBuffer())))); } catch (e) { errs.push((e as Error).message); }
  }
  if (!pts.length) throw new ProviderError("CARB", errs[0] ?? "no settlement prices found in the results summaries");
  return [{ cc: "US", code: "CCAAUC", name: "California–Québec carbon allowance auction settlement price", unit: "USD/metric ton", cat: "mk", freq: "Q", src: "California Air Resources Board, joint California–Québec auction results", url: CARB_URL, notes: "Current-vintage settlement price of the quarterly joint cap-and-trade allowance auctions of California and Québec. Source: California Air Resources Board.", points: sorted(pts) }];
}
