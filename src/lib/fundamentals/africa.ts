/**
 * Key figures for NGX listings from the African market APIs (Mansa, MyStocks
 * Africa, NGX Pulse, Africa API). Their response formats differ and are not
 * all documented, so fields are found by common names (market_cap, pe_ratio,
 * eps, dividend_yield, shares_outstanding, book_value ...) anywhere in the
 * response. The result is a "snapshot" FundDoc: key figures, no statements.
 */
import { createAfricaApi } from "@/lib/providers/africa-api";
import { createMansa } from "@/lib/providers/mansa";
import { createMyStocksAfrica } from "@/lib/providers/mystocks-africa";
import { createNgxPulse } from "@/lib/providers/ngx-pulse";
import { num, type FundDoc, type FundProvider } from "./sources";

type Obj = Record<string, unknown>;
const KEYS: Record<string, RegExp> = {
  price: /^(current_?price|price|close|close_?price|last_?price|last)$/i,
  mcap: /^(market_?cap(italization|italisation)?|mkt_?cap|mcap)$/i,
  shares: /^(shares_?outstanding|outstanding_?shares|shares_?issued|total_?shares|issued_?shares)$/i,
  pe: /^(pe|p_?e|pe_?ratio|p_?e_?ratio|price_?earnings(_?ratio)?|trailing_?pe)$/i,
  eps: /^(eps|eps_?ttm|earnings_?per_?share|basic_?eps|diluted_?eps)$/i,
  divYield: /^(dividend_?yield|div_?yield|yield)$/i,
  divPs: /^(dividend_?per_?share|dps|last_?dividend|dividend_?amount|dividend)$/i,
  bvps: /^(book_?value(_?per_?share)?|bvps|nav_?per_?share)$/i,
  rev: /^(revenue|turnover|total_?revenue|gross_?earnings|revenue_?ttm)$/i,
  ni: /^(net_?income|profit_?after_?tax|pat|net_?profit|profit_?for_?the_?year)$/i,
  equity: /^(total_?equity|shareholders?_?equity|stockholders?_?equity)$/i,
  ccy: /^(currency|ccy|currency_?code)$/i,
  name: /^(name|company_?name|long_?name|security_?name)$/i,
};

/** First value whose key matches `re`, searching nested objects breadth-first (depth ≤ 3). */
export function findField(body: unknown, re: RegExp): unknown {
  let level: unknown[] = [body];
  for (let depth = 0; depth <= 3 && level.length; depth++) {
    const next: unknown[] = [];
    for (const o of level) {
      if (!o || typeof o !== "object" || Array.isArray(o)) continue;
      for (const [k, v] of Object.entries(o as Obj)) { if (re.test(k) && v !== null && v !== "" && typeof v !== "object") return v; }
      for (const v of Object.values(o as Obj)) if (v && typeof v === "object" && !Array.isArray(v)) next.push(v);
    }
    level = next;
  }
  return undefined;
}

/** Builds a snapshot from one or more responses about the same stock. Returns null without enough figures. */
export function snapshotFrom(id: string, tk: string, src: FundProvider, ...bodies: unknown[]): FundDoc | null {
  const get = (k: string) => { for (const b of bodies) { const v = findField(b, KEYS[k]); if (v !== undefined) return v; } return undefined; };
  const n = (k: string) => { const v = num(get(k)); return v !== null && v > 0 ? v : null; };
  const price = n("price"); let mcap = n("mcap"); let shares = n("shares");
  if (!shares && mcap && price) shares = mcap / price;
  if (!mcap && shares && price) mcap = shares * price;
  const pe = n("pe"); let eps = num(get("eps"));
  if (eps === null && pe && price) eps = price / pe;
  // Dividend yield may be a percentage (5.2) or a fraction (0.052); NGX yields are well above 0.3 %.
  let dy = n("divYield"); if (dy !== null && dy < 0.3) dy *= 100;
  let divPs = n("divPs"); if (divPs === null && dy !== null && price) divPs = (dy / 100) * price;
  const bvps = n("bvps"); const eqRaw = num(get("equity"));
  const equity = eqRaw ?? (bvps && shares ? bvps * shares : null);
  const rev = num(get("rev")); const ni = num(get("ni")) ?? (eps !== null && shares ? eps * shares : null);
  if (!shares || (eps === null && divPs === null && equity === null && rev === null)) return null;
  const name = get("name");
  return {
    type: "fund", kind: "snapshot", id, tk, src, asOf: new Date().toISOString(), ccy: String(get("ccy") || "NGN").toUpperCase().slice(0, 3), name: name ? String(name) : undefined, shares,
    ttm: { basis: "snapshot", rev, gp: null, op: null, ni, ebitda: null, eps, fcf: null, divPs: divPs ?? 0 },
    bs: { date: null, equity, debt: null, cash: null }, fwdEps: null, growth: null, nextEarn: null, earnTime: null, fy: [],
  };
}

const soft = <T>(p: Promise<T>) => p.catch(() => null);
export const africanFundamentals: Partial<Record<FundProvider, (id: string, tk: string) => Promise<FundDoc | null>>> = {
  mansa: async (id, tk) => { const m = createMansa(); const [s, d] = await Promise.all([m.stock("nigeria", tk), soft(m.dividends("nigeria", tk))]); return snapshotFrom(id, tk, "mansa", s, d); },
  mystocks: async (id, tk) => { const m = createMyStocksAfrica(); const [s, c] = await Promise.all([m.stock(tk), soft(m.company(tk))]); return snapshotFrom(id, tk, "mystocks", s, c); },
  ngxpulse: async (id, tk) => snapshotFrom(id, tk, "ngxpulse", await createNgxPulse().price(tk)),
  africa: async (id, tk) => snapshotFrom(id, tk, "africa", await createAfricaApi().ticker("NGX", tk)),
};
