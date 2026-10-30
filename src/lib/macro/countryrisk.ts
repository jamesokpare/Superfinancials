/**
 * Country risk from Aswath Damodaran's country default spreads and risk premiums (NYU Stern), updated
 * each January and July, free to use with credit. Per country: the rating-based (or CDS-based) sovereign
 * default spread, the country risk premium and the total equity risk premium. Each update adds a point,
 * so the series are kept and grow twice a year.
 */
import { ProviderError } from "@/lib/providers/http";
import { BROWSER_UA, type MacroSeries } from "./sources";
import { htmlTables } from "@/lib/africa/ngdebt";

export const DAMODARAN_URL = "https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/ctryprem.html";
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
/** Names Damodaran uses that differ from the English region names in Intl. */
const ALIASES: Record<string, string> = { "korea": "KR", "south korea": "KR", "korea, republic of": "KR", "congo (democratic republic of)": "CD", "congo (dem. rep.)": "CD", "democratic republic of congo": "CD", "congo (republic of)": "CG", "republic of congo": "CG", "congo": "CG",
  "ivory coast": "CI", "cote d'ivoire": "CI", "côte d'ivoire": "CI", "turkey": "TR", "türkiye": "TR", "russia": "RU", "vietnam": "VN", "viet nam": "VN", "united states": "US", "usa": "US", "united kingdom": "GB", "uk": "GB", "czech republic": "CZ", "czechia": "CZ",
  "hong kong": "HK", "taiwan": "TW", "macedonia": "MK", "north macedonia": "MK", "swaziland": "SZ", "eswatini": "SZ", "cape verde": "CV", "cabo verde": "CV", "bosnia and herzegovina": "BA", "bosnia": "BA", "the gambia": "GM", "gambia": "GM", "lao pdr": "LA", "laos": "LA", "kyrgyzstan": "KG", "moldova": "MD", "iran": "IR", "syria": "SY", "tanzania": "TZ", "bolivia": "BO", "venezuela": "VE", "palestine": "PS", "brunei": "BN", "myanmar": "MM", "burma": "MM", "st. vincent & the grenadines": "VC", "trinidad and tobago": "TT", "trinidad & tobago": "TT", "united arab emirates": "AE", "uae": "AE" };
let NAMES: Map<string, string> | null = null;
/** English country name → ISO alpha-2, from Intl region names plus Damodaran's own spellings. */
export function countryCode(name: string): string | null {
  if (!NAMES) {
    NAMES = new Map(); const dn = new Intl.DisplayNames(["en"], { type: "region" });
    for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) { const c = String.fromCharCode(a, b); try { const n = dn.of(c); if (n && n !== c) NAMES.set(n.toLowerCase(), c); } catch { /* not a region */ } }
  }
  const k = name.toLowerCase().replace(/\*+$/, "").replace(/\s+/g, " ").trim();
  return ALIASES[k] ?? NAMES.get(k) ?? null;
}
const pct = (s: string | undefined) => { const v = Number(String(s ?? "").replace(/[%\s,]/g, "")); return s != null && /\d/.test(s) && Number.isFinite(v) ? Number((/%/.test(s) || Math.abs(v) > 1 ? v : v * 100).toFixed(2)) : null; };

export type CountryRisk = { cc: string; spread: number | null; crp: number | null; erp: number | null; rating: string };
/** The country table and the page's "Last updated" date. Country codes are ISO (GB, not UK). */
export function readDamodaran(html: string): { t: string | null; rows: CountryRisk[] } {
  const up = html.replace(/<[^>]+>/g, " ").match(/last updated\s*:?\s*([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/i);
  const t = up && MONTHS.includes(up[1].toLowerCase()) ? `${up[3]}-${String(MONTHS.indexOf(up[1].toLowerCase()) + 1).padStart(2, "0")}-${up[2].padStart(2, "0")}` : null;
  for (const tbl of htmlTables(html)) {
    const h = tbl.findIndex((r) => r.some((c) => /country risk premium/i.test(c)) && r.some((c) => /^country$/i.test(c.trim()))); if (h < 0) continue;
    const head = tbl[h]; const col = (re: RegExp) => head.findIndex((c) => re.test(c));
    const cC = col(/^country$/i), cS = col(/default spread/i), cR = col(/country risk premium/i), cE = col(/equity risk premium/i), cM = col(/rating/i);
    const rows = tbl.slice(h + 1).flatMap((r) => { const cc = countryCode(r[cC] ?? ""); return cc ? [{ cc, spread: pct(r[cS]), crp: pct(r[cR]), erp: pct(r[cE]), rating: cM >= 0 ? String(r[cM] ?? "").trim() : "" }] : []; });
    if (rows.length) return { t, rows };
  }
  return { t, rows: [] };
}
export async function damodaranCountryRisk(countries?: Set<string>): Promise<MacroSeries[]> {
  let r: Response;
  try { r = await fetch(DAMODARAN_URL, { headers: { ...BROWSER_UA, accept: "text/html" }, signal: AbortSignal.timeout(60_000) }); } catch (e) { throw new ProviderError("Damodaran (NYU Stern)", `request failed: ${(e as Error).message}`); }
  if (!r.ok) throw new ProviderError("Damodaran (NYU Stern)", `HTTP ${r.status}`, r.status);
  const { t, rows } = readDamodaran(await r.text());
  if (!t || !rows.length) throw new ProviderError("Damodaran (NYU Stern)", t ? "country table not found" : "update date not found");
  const credit = `Source: Aswath Damodaran, NYU Stern, "Country Default Spreads and Risk Premiums" (updated ${t}), used with credit.`;
  const out: MacroSeries[] = [];
  for (const x of rows) {
    const cc = x.cc === "GB" ? "UK" : x.cc; if (countries && !countries.has(cc)) continue;
    const add = (code: string, name: string, v: number | null, notes: string) => { if (v != null) out.push({ cc, code, name, unit: "%", cat: "fs", freq: "A", src: "Aswath Damodaran, NYU Stern (country risk)", url: DAMODARAN_URL, notes: `${notes}${x.rating ? ` Moody's rating at the update: ${x.rating}.` : ""} ${credit}`, points: [{ t, v }] }); };
    add("DEFSPRD", "Sovereign default spread (Damodaran)", x.spread, "Default spread for the country's sovereign rating (or its CDS spread where Damodaran uses it), over a default-free rate.");
    add("CRP", "Country risk premium (Damodaran)", x.crp, "Extra equity risk premium for investing in the country: default spread scaled by relative equity market volatility.");
    add("ERP", "Total equity risk premium (Damodaran)", x.erp, "Mature-market equity risk premium plus the country risk premium.");
  }
  if (!out.length) throw new ProviderError("Damodaran (NYU Stern)", "no rows for the app's countries");
  return out;
}
