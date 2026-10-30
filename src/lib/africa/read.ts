/**
 * Readers for the African market APIs (Mansa, NGX Pulse, MyStocks Africa,
 * Africa API). Their responses are not all documented and name the same field
 * differently, so values are found by trying the common names.
 */

export type Obj = Record<string, unknown>;

/** A number from a number or a string such as "1,234.5", "₦12.40", "3.2%" or "NGN 5". */
export function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const s = v.replace(/[,\s%₦]|NGN/gi, ""); if (!s || !/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return null;
  const n = Number(s); return Number.isFinite(n) ? n : null;
}

/** First non-empty primitive among `keys` (objects and arrays are skipped). */
export function pick(r: Obj | null | undefined, keys: string[]): string | number | boolean | undefined {
  if (!r) return undefined;
  for (const k of keys) { const v = r[k]; if (v !== undefined && v !== null && v !== "" && typeof v !== "object") return v as string | number | boolean; }
  return undefined;
}
export const text = (r: Obj | null | undefined, keys: string[]) => { const v = pick(r, keys); return v === undefined ? "" : String(v).replace(/\s+/g, " ").trim(); };
export const number = (r: Obj | null | undefined, keys: string[]) => num(pick(r, keys));

/** A name that may be a plain string or an object ({ name } / { title }). */
export function nameOf(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (v && typeof v === "object" && !Array.isArray(v)) return text(v as Obj, ["name", "title", "label"]);
  return "";
}

/** ISO date (YYYY-MM-DD) from a date string, "DD/MM/YYYY", or an epoch in seconds or milliseconds. */
export function isoDate(v: unknown): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) { const t = v < 1e11 ? v * 1000 : v; return new Date(t).toISOString().slice(0, 10); }
  const s = String(v).trim(); let m;
  if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s))) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const t = Date.parse(s); return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
}

/** The first array of objects found in a response, breadth-first ({ data: [...] }, { data: { disclosures: [...] } }, [...]). */
export function firstRows(body: unknown): Obj[] {
  let level: unknown[] = [body];
  for (let depth = 0; depth <= 3 && level.length; depth++) {
    const next: unknown[] = [];
    for (const o of level) {
      if (Array.isArray(o)) { const rows = o.filter((x) => x && typeof x === "object" && !Array.isArray(x)) as Obj[]; if (rows.length) return rows; continue; }
      if (o && typeof o === "object") next.push(...Object.values(o as Obj));
    }
    level = next;
  }
  return [];
}

/** Every array of objects in a response, with the key it sits under (depth ≤ 4). */
export function allRows(body: unknown, key = "", depth = 0, out: { key: string; rows: Obj[] }[] = []): { key: string; rows: Obj[] }[] {
  if (depth > 4 || !body || typeof body !== "object") return out;
  if (Array.isArray(body)) { const rows = body.filter((x) => x && typeof x === "object" && !Array.isArray(x)) as Obj[]; if (rows.length) out.push({ key, rows }); return out; }
  for (const [k, v] of Object.entries(body as Obj)) allRows(v, k, depth + 1, out);
  return out;
}

const K = {
  sym: ["symbol", "ticker", "code", "stock_code", "security", "company_symbol", "stock_symbol", "sym"],
  name: ["name", "company_name", "company", "security_name", "long_name", "issuer", "stock_name", "fund_name", "short_name"],
  price: ["current_price", "price", "close", "close_price", "closing_price", "last_price", "last", "lastPrice", "nav"],
  chp: ["change_percent", "percent_change", "pct_change", "change_pct", "changePercent", "percentage_change", "change_percentage", "pchange", "percent", "daily_change_percent", "changesPercentage"],
  ch: ["change", "price_change", "change_amount"],
  vol: ["volume", "traded_volume", "total_volume", "vol", "quantity"],
  val: ["traded_value", "value_traded", "turnover", "deal_value", "trade_value"],
  ex: ["exchange", "exchange_code", "market", "exchange_name", "country"],
};

export type Mover = { tk: string; name: string; c: number | null; chp: number | null; vol: number | null; val: number | null; ex?: string };

/** One security row (a mover, an ETF, a NASD listing). Needs a symbol or a name. */
export function readMover(r: Obj): Mover | null {
  const tk = text(r, K.sym).toUpperCase(); const name = text(r, K.name) || nameOf(r.company);
  if (!tk && !name) return null;
  const c = number(r, K.price); let chp = number(r, K.chp); const ch = number(r, K.ch);
  if (chp === null && ch !== null && c !== null && c - ch !== 0) chp = (ch / (c - ch)) * 100;
  const ex = text(r, K.ex) || nameOf(r.exchange);
  return { tk, name, c, chp: chp === null ? null : Math.round(chp * 100) / 100, vol: number(r, K.vol), val: number(r, K.val), ...(ex ? { ex } : {}) };
}
export const readMovers = (body: unknown, max = 50) => firstRows(body).map(readMover).filter((x): x is Mover => !!x).slice(0, max);

/** A short stable hash for document ids (FNV-1a, hex). */
export function hash(s: string): string {
  let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, "0");
}
export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
export const httpUrl = (v: string) => (/^https?:\/\//i.test(v) ? v : "");

/** African countries: ISO 3166 alpha-2, alpha-3 and English name. */
export const AFRICA: [string, string, string][] = [
  ["DZ", "DZA", "Algeria"], ["AO", "AGO", "Angola"], ["BJ", "BEN", "Benin"], ["BW", "BWA", "Botswana"], ["BF", "BFA", "Burkina Faso"], ["BI", "BDI", "Burundi"],
  ["CV", "CPV", "Cabo Verde"], ["CM", "CMR", "Cameroon"], ["CF", "CAF", "Central African Republic"], ["TD", "TCD", "Chad"], ["KM", "COM", "Comoros"],
  ["CD", "COD", "DR Congo"], ["CG", "COG", "Congo"], ["CI", "CIV", "Côte d'Ivoire"], ["DJ", "DJI", "Djibouti"], ["EG", "EGY", "Egypt"], ["GQ", "GNQ", "Equatorial Guinea"],
  ["ER", "ERI", "Eritrea"], ["SZ", "SWZ", "Eswatini"], ["ET", "ETH", "Ethiopia"], ["GA", "GAB", "Gabon"], ["GM", "GMB", "Gambia"], ["GH", "GHA", "Ghana"], ["GN", "GIN", "Guinea"],
  ["GW", "GNB", "Guinea-Bissau"], ["KE", "KEN", "Kenya"], ["LS", "LSO", "Lesotho"], ["LR", "LBR", "Liberia"], ["LY", "LBY", "Libya"], ["MG", "MDG", "Madagascar"], ["MW", "MWI", "Malawi"],
  ["ML", "MLI", "Mali"], ["MR", "MRT", "Mauritania"], ["MU", "MUS", "Mauritius"], ["MA", "MAR", "Morocco"], ["MZ", "MOZ", "Mozambique"], ["NA", "NAM", "Namibia"], ["NE", "NER", "Niger"],
  ["NG", "NGA", "Nigeria"], ["RW", "RWA", "Rwanda"], ["ST", "STP", "São Tomé and Príncipe"], ["SN", "SEN", "Senegal"], ["SC", "SYC", "Seychelles"], ["SL", "SLE", "Sierra Leone"],
  ["SO", "SOM", "Somalia"], ["ZA", "ZAF", "South Africa"], ["SS", "SSD", "South Sudan"], ["SD", "SDN", "Sudan"], ["TZ", "TZA", "Tanzania"], ["TG", "TGO", "Togo"], ["TN", "TUN", "Tunisia"],
  ["UG", "UGA", "Uganda"], ["ZM", "ZMB", "Zambia"], ["ZW", "ZWE", "Zimbabwe"],
];
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
/** Alpha-2 code from an alpha-2 or alpha-3 code or a country name; null when not an African country. */
export function africanCode(v: string): string | null {
  const s = v.trim(); if (!s) return null; const u = s.toUpperCase();
  const row = AFRICA.find(([a2, a3, n]) => a2 === u || a3 === u || norm(n) === norm(s)) ?? AFRICA.find(([, , n]) => norm(s).length > 4 && (norm(n).includes(norm(s)) || norm(s).includes(norm(n))));
  return row ? row[0] : null;
}
export const africanName = (cc: string) => AFRICA.find(([a2]) => a2 === cc)?.[2] ?? cc;
