/**
 * Fund-level private-markets performance published by U.S. public pension funds.
 * These are public records; each figure is the pension's own (net IRR to that LP,
 * its commitment, paid-in, distributions and remaining value), credited to it.
 *
 *   CalPERS   Private Equity Program and Private Debt Program fund performance
 *             reviews: HTML tables on calpers.ca.gov (one row per fund).
 *   WSIB      Washington State Investment Board quarterly investment report (PDF,
 *             sib.wa.gov/docs/reports/quarterly/irMMDDYY.pdf): private equity
 *             partnerships with IRRs calculated by Hamilton Lane.
 *   Oregon    Oregon State Treasury, OPERF Private Equity and Real Assets portfolio
 *             reports (PDF, linked from the Performance & Holdings page).
 *
 * PDF tables are rebuilt from the PDF text layer (unpdf): text items on one
 * baseline make a line, and a line ending in a run of figures is a fund row.
 * Column order is checked against the reported multiple ((distributions +
 * value) ÷ paid-in), so a reordered table is still read correctly.
 */
import { ProviderError } from "@/lib/providers/http";

export type Pension = "calpers" | "wsib" | "oregon";
export const PENSIONS: Record<Pension, { lp: string; report: string; home: string }> = {
  calpers: { lp: "CalPERS", report: "Private Equity Program Fund Performance Review", home: "https://www.calpers.ca.gov/investments/about-investment-office/investment-organization/pep-fund-performance" },
  wsib: { lp: "Washington State Investment Board", report: "Quarterly Investment Report", home: "https://www.sib.wa.gov/reports/qtrly_reports.html" },
  oregon: { lp: "Oregon Public Employees Retirement Fund (OPERF)", report: "OPERF Private Equity Portfolio", home: "https://www.oregon.gov/treasury/invested-for-oregon/Pages/Performance-Holdings.aspx" },
};
export const STRATS = ["Buyout", "Venture", "Growth", "Private credit", "Infrastructure", "Real estate"] as const;
export type Strat = (typeof STRATS)[number];

/** One fund as one pension reports it. Amounts in U.S. dollars, IRR in %. */
export type LpRow = {
  pension: Pension; lp: string; name: string; vintage: number | null; strat: Strat;
  commit: number | null; paid: number | null; dist: number | null; nav: number | null;
  irr: number | null; tvpi: number | null; dpi: number | null;
  asof: string; src: string; url: string;
};

const UA = { "user-agent": "Mozilla/5.0 (compatible; Superfinancials data sync; +https://github.com/jamesokpare/Superfinancials)" };
async function get(name: string, url: string, kind: "text" | "pdf", timeoutMs = 60_000): Promise<string | Buffer | null> {
  let res: Response;
  try { res = await fetch(url, { headers: { ...UA, accept: kind === "pdf" ? "application/pdf, */*" : "text/html, */*" }, signal: AbortSignal.timeout(timeoutMs) }); }
  catch (e) { throw new ProviderError(name, `request failed: ${(e as Error).message}`); }
  if (res.status === 404) return null;
  if (!res.ok) throw new ProviderError(name, `HTTP ${res.status}`, res.status);
  if (kind === "text") return res.text();
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.subarray(0, 5).toString("latin1") === "%PDF-" ? buf : null; // an HTML "not found" page served with 200
}

// --- PDF text → lines ----------------------------------------------------------------------------------
/** Text lines of a PDF, page by page, rebuilt from positioned text items. Replaceable in tests. */
export type PdfLines = (buf: Buffer) => Promise<string[]>;
export const pdfLines: PdfLines = async (buf) => {
  const { extractTextItems } = await import("unpdf");
  const { items } = await extractTextItems(new Uint8Array(buf));
  const out: string[] = [];
  for (const page of items) {
    const rows: { y: number; h: number; parts: { x: number; w: number; s: string }[] }[] = [];
    for (const it of page) {
      if (!it.str.trim()) continue;
      const h = it.height || it.fontSize || 8;
      const row = rows.find((r) => Math.abs(r.y - it.y) <= Math.max(2, Math.min(r.h, h) * 0.4));
      if (row) row.parts.push({ x: it.x, w: it.width, s: it.str }); else rows.push({ y: it.y, h, parts: [{ x: it.x, w: it.width, s: it.str }] });
    }
    rows.sort((a, b) => b.y - a.y);
    for (const r of rows) {
      r.parts.sort((a, b) => a.x - b.x);
      out.push(r.parts.map((p) => p.s.trim()).join(" ").replace(/\s+/g, " ").trim());
    }
  }
  return out;
};

// --- rows ----------------------------------------------------------------------------------------------
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const isoOf = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
/** "as of March 31, 2026", "As of 12/31/2025" → ISO date. */
export function asOfDate(text: string): string | null {
  const a = /as of\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2}),?\s+(\d{4})/i.exec(text);
  if (a) return isoOf(+a[3], MONTHS.indexOf(a[1].toLowerCase()) + 1, +a[2]);
  const b = /as of\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/i.exec(text);
  return b ? isoOf(+b[3], +b[1], +b[2]) : null;
}
const quarterEnd = (y: number, q: number) => isoOf(y, q * 3, q === 1 || q === 4 ? 31 : 30);

const NA = /^(n\/?m|n\/?a|nm|na|\*+)$/i;
type Tok = { kind: "date" | "year" | "amt" | "mult" | "irr" | "na" | "dash"; v: number | null };
/** One table cell as a figure, or null when it is text. */
export function readToken(s: string): Tok | null {
  const t = s.trim().replace(/^\$(?=[-–—]$)/, "");
  if (NA.test(t)) return { kind: "na", v: null };
  if (/^[-–—]$/.test(t)) return { kind: "dash", v: null }; // a zero amount, or no IRR when it is the last figure
  let m = /^(\d{1,2})\/(\d{1,2})\/((?:19|20)\d{2})$/.exec(t); if (m) return { kind: "date", v: +m[3] };
  if (/^(19|20)\d{2}$/.test(t)) return { kind: "year", v: +t };
  m = /^\(?(-?\d+(?:\.\d+)?)\)?x$/i.exec(t); if (m) return { kind: "mult", v: +m[1] };
  m = /^(\()?(-?\d+(?:\.\d+)?)%\)?$/.exec(t); if (m) return { kind: "irr", v: m[1] ? -Math.abs(+m[2]) : +m[2] };
  m = /^\$?(\()?\$?(-?[\d,]+(?:\.\d+)?)\)?$/.exec(t);
  if (m && /\d/.test(m[2]) && (/,/.test(m[2]) || t.includes("$") || +m[2] >= 1000 || +m[2] === 0)) { const v = Number(m[2].replace(/,/g, "")); return Number.isFinite(v) ? { kind: "amt", v: m[1] ? -Math.abs(v) : v } : null; }
  return null;
}

/** A table line: the fund name and the figures after it ("$ 1,000" joined), or null. */
export function splitLine(line: string, yearFirst = false): { name: string; year: number | null; toks: Tok[] } | null {
  const words = line.replace(/\$\s+/g, "$").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")").replace(/\s+%/g, "%").trim().split(/\s+/);
  let lead: number | null = null;
  if (yearFirst && /^(19|20)\d{2}$/.test(words[0] ?? "")) lead = +words.shift()!;
  let i = words.length; while (i > 0 && readToken(words[i - 1])) i--;
  // A name ending in a small number ("Fund 2") gives it back when a year or date follows.
  while (i < words.length - 1 && /^\d{1,2}$/.test(words[i]) && ["year", "date"].includes(readToken(words[i + 1])?.kind ?? "")) i++;
  const name = words.slice(0, i).join(" ").replace(/[\s,]+$/, "").trim();
  const toks = words.slice(i).map((w) => readToken(w)!);
  if (!name || !/[a-z]/i.test(name) || toks.filter((t) => t.kind === "amt").length < 2) return null;
  const y = toks.find((t) => t.kind === "year" || t.kind === "date");
  return { name, year: lead ?? (y?.v ?? null), toks };
}

/**
 * Reads amounts as commitment, paid-in, distributions and value. Commitment and paid-in
 * are the first two amounts; distributions and value are the pair (or distributions and a
 * "distributions + value" total) that agrees with the reported multiple.
 */
export function assign(amts: number[], mult: number | null, fallback: [number, number]): { commit: number; paid: number; dist: number; nav: number } | null {
  if (amts.length < 3) return null;
  const [commit, paid] = amts; const rest = amts.slice(2).map((v, k) => [v, k + 2] as const);
  const ok = (d: number, n: number) => mult == null || paid <= 0 || Math.abs((d + n) / paid - mult) <= 0.055 + Math.abs(mult) * 0.002;
  const tryPair = (di: number, ni: number) => { const d = amts[di], n = amts[ni]; return d != null && n != null && di !== ni && d >= 0 && ok(d, n) ? { commit, paid, dist: d, nav: n } : null; };
  const pref = tryPair(...fallback); if (pref) return pref;
  for (const [, di] of rest) for (const [, ni] of rest) { const r = tryPair(di, ni); if (r) return r; }
  // distributions and "distributions + remaining value"
  for (const [d, di] of rest) for (const [tot, ti] of rest) if (ti !== di && tot >= d && ok(d, tot - d)) return { commit, paid, dist: d, nav: tot - d };
  return null;
}

const r2 = (v: number, k = 2) => Number(v.toFixed(k));
/** Strategy from a table section heading or the fund's name. */
export function stratOf(name: string, section = ""): Strat {
  const s = `${section} ${name}`.toLowerCase();
  if (/real estate|realty|property|properties|reit\b|housing/.test(s)) return "Real estate";
  if (/infrastructure|energy|natural resources|real assets|power|timber|agricultur/.test(s)) return "Infrastructure";
  if (/credit|debt|lending|loan|mezzanine|distressed|special situations|opportunistic credit|private debt/.test(s)) return "Private credit";
  if (/venture|\bseed\b|early stage|vc\b/.test(s)) return "Venture";
  if (/growth/.test(s)) return "Growth";
  return "Buyout";
}
const SECTION = /^(?:buyout|corporate finance(?:\/buyout)?|venture capital|venture|growth(?: equity)?|distressed(?: debt)?|mezzanine|special situations|private (?:credit|debt)|real estate|infrastructure|natural resources|real assets|co-?investments?|secondar(?:y|ies)|fund of funds|opportunistic|energy)\b/i;
const SKIP = /^(total|sub-?total|grand total|portfolio total|liquidated|fund name|partnership|investment name|vintage|page \d|\*)/i;

function rowFrom(p: Pension, s: NonNullable<ReturnType<typeof splitLine>>, section: string, asof: string, url: string, fallback: [number, number]): LpRow | null {
  if (SKIP.test(s.name)) return null;
  const last = s.toks.at(-1);
  const amts = s.toks.filter((t) => t.kind === "amt" || (t.kind === "dash" && t !== last)).map((t) => t.v ?? 0);
  const mult = s.toks.find((t) => t.kind === "mult")?.v ?? null;
  const irrTok = s.toks.filter((t) => t.kind === "irr" || t.kind === "na" || (t.kind === "dash" && t === last)).at(-1);
  const a = assign(amts, mult, fallback); if (!a || a.commit <= 0) return null;
  const tvpi = a.paid > 0 ? r2((a.dist + a.nav) / a.paid) : mult;
  const P = PENSIONS[p];
  return { pension: p, lp: P.lp, name: s.name.replace(/\s+/g, " "), vintage: s.year, strat: stratOf(s.name, section), commit: a.commit, paid: a.paid, dist: a.dist, nav: a.nav, irr: irrTok?.kind === "irr" ? irrTok.v : null, tvpi, dpi: a.paid > 0 ? r2(a.dist / a.paid) : null, asof, src: `${P.lp}, ${P.report}, as of ${asof}`, url };
}

/** Fund rows of a PDF's text lines. */
export function readPdfTable(p: Pension, lines: string[], asof: string, url: string, opts: { yearFirst?: boolean; fallback?: [number, number]; section?: string } = {}): LpRow[] {
  const out: LpRow[] = []; let section = opts.section ?? ""; const seen = new Set<string>();
  for (const line of lines) {
    const s = splitLine(line, opts.yearFirst);
    if (!s) { const h = line.trim(); if (h.length < 60 && SECTION.test(h) && !/\d{3}/.test(h)) section = h; continue; }
    const r = rowFrom(p, s, section, asof, url, opts.fallback ?? [2, 3]);
    if (r && !seen.has(r.name.toLowerCase())) { seen.add(r.name.toLowerCase()); out.push(r); }
  }
  return out;
}

// --- CalPERS (HTML) --------------------------------------------------------------------------------------
const unhtml = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d)).replace(/\s+/g, " ").trim();
/**
 * Rows of the CalPERS fund performance tables: Fund | Vintage Year | Capital Committed |
 * Cash In | Cash Out | Cash Out & Remaining Value | Net IRR | Investment Multiple.
 */
export function readCalpers(html: string, url: string, section = ""): LpRow[] {
  const asof = asOfDate(unhtml(html)); if (!asof) throw new ProviderError("CalPERS", "no 'as of' date on the page");
  const out: LpRow[] = [];
  for (const table of html.match(/<table[\s\S]*?<\/table>/gi) ?? []) {
    const rows = (table.match(/<tr[\s\S]*?<\/tr>/gi) ?? []).map((tr) => (tr.match(/<t[hd][\s\S]*?<\/t[hd]>/gi) ?? []).map(unhtml));
    const head = rows.find((r) => r.some((c) => /vintage/i.test(c))); if (!head) continue;
    const col = (re: RegExp) => head.findIndex((c) => re.test(c));
    const ix = { name: col(/fund|investment|partnership/i), vin: col(/vintage/i), com: col(/commit/i), cin: col(/cash in|contribut/i), cout: col(/^cash out$|distribut/i), tot: col(/remaining/i), irr: col(/irr/i), mult: col(/multiple/i) };
    if (ix.name < 0 || ix.com < 0 || ix.cin < 0 || ix.tot < 0) continue;
    if (ix.cout < 0) ix.cout = head.findIndex((c, k) => /cash out/i.test(c) && k !== ix.tot);
    for (const r of rows) {
      if (r === head || r.length < head.length - 1) continue;
      const name = r[ix.name]; if (!name || SKIP.test(name)) continue;
      const amt = (k: number) => { const t = k >= 0 ? readToken((r[k] ?? "").replace(/\s+/g, "")) : null; return t?.kind === "amt" ? t.v : null; };
      const commit = amt(ix.com), paid = amt(ix.cin), dist = amt(ix.cout), tot = amt(ix.tot);
      if (commit == null || paid == null || tot == null) continue;
      const irrT = readToken((r[ix.irr] ?? "").replace(/\s+/g, "")); const multT = readToken((r[ix.mult] ?? "").replace(/\s+/g, ""));
      const d = dist ?? 0; const nav = r2(tot - d, 0);
      out.push({ pension: "calpers", lp: "CalPERS", name, vintage: Number(r[ix.vin]) || null, strat: stratOf(name, section), commit, paid, dist: d, nav, irr: irrT?.kind === "irr" ? irrT.v : null, tvpi: paid > 0 ? r2(tot / paid) : multT?.kind === "mult" ? multT.v : null, dpi: paid > 0 ? r2(d / paid) : null, asof, src: `CalPERS, ${section === "Private credit" ? "Private Debt Program" : "Private Equity Program"} Fund Performance Review, as of ${asof}`, url });
    }
  }
  return out;
}
export const CALPERS_PAGES: [string, string][] = [
  ["https://www.calpers.ca.gov/investments/about-investment-office/investment-organization/pep-fund-performance", ""],
  ["https://www.calpers.ca.gov/investments/about-investment-office/investment-organization/private-debt-performance", "Private credit"],
];
export async function calpers(): Promise<LpRow[]> {
  const out: LpRow[] = []; const errs: string[] = [];
  for (const [url, section] of CALPERS_PAGES) {
    try {
      // The print view lists every fund on one page; the normal page may paginate.
      let html = (await get("CalPERS", `${url}/printfunds`, "text").catch(() => null)) as string | null;
      let rows = html ? readCalpers(html, url, section) : [];
      if (!rows.length) { html = (await get("CalPERS", url, "text")) as string | null; rows = html ? readCalpers(html, url, section) : []; }
      out.push(...rows);
    } catch (e) { errs.push((e as Error).message); }
  }
  if (!out.length) throw new ProviderError("CalPERS", errs[0] ?? "no fund rows found");
  return out;
}

// --- Washington State Investment Board (PDF) -------------------------------------------------------------
/** The latest WSIB quarterly report: tries quarter-ends going back from `now` (reports follow 4–7 months later). */
export async function wsib(now: Date, lines: PdfLines = pdfLines): Promise<LpRow[]> {
  let y = now.getUTCFullYear(), q = Math.floor(now.getUTCMonth() / 3); if (q === 0) { q = 4; y--; }
  for (let k = 0; k < 6; k++) {
    const end = quarterEnd(y, q); const url = `https://www.sib.wa.gov/docs/reports/quarterly/ir${end.slice(5, 7)}${end.slice(8, 10)}${end.slice(2, 4)}.pdf`;
    const buf = (await get("WSIB", url, "pdf", 90_000)) as Buffer | null;
    if (buf) {
      const ls = await lines(buf);
      const rows = readPdfTable("wsib", ls, asOfDate(ls.slice(0, 80).join(" ")) ?? end, url, { fallback: [4, 3] });
      if (!rows.length) throw new ProviderError("WSIB", `no fund rows read from ${url}`);
      return rows;
    }
    if (--q === 0) { q = 4; y--; }
  }
  throw new ProviderError("WSIB", "no quarterly report found for the last six quarters");
}

// --- Oregon Treasury (PDF) ------------------------------------------------------------------------------
/** Newest OPERF private equity and real assets portfolio PDFs linked from the Performance & Holdings page. */
export function oregonLinks(html: string, base = PENSIONS.oregon.home): { url: string; asof: string; section: string }[] {
  const found = new Map<string, { url: string; asof: string; section: string }>();
  for (const m of html.matchAll(/<a[^>]+href="([^"]+\.pdf)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = new URL(m[1].replace(/&amp;/g, "&"), base).toString(); const text = `${unhtml(m[2])} ${decodeURIComponent(href)}`;
    const kind = /private[\s_-]*equity[\s_-]*portfolio/i.test(text) ? "pe" : /real[\s_-]*assets[\s_-]*portfolio/i.test(text) ? "ra" : null; if (!kind) continue;
    const qy = /quarter[\s_-]*(\d)[\s_-]*(20\d{2})/i.exec(text) ?? /(20\d{2})[\s_-]*q(\d)/i.exec(text);
    if (!qy) continue;
    const [yy, qq] = /quarter/i.test(qy[0]) ? [+qy[2], +qy[1]] : [+qy[1], +qy[2]];
    const asof = quarterEnd(yy, qq); const cur = found.get(kind);
    if (!cur || asof > cur.asof) found.set(kind, { url: href, asof, section: kind === "pe" ? "" : "Real assets" });
  }
  return [...found.values()];
}
export async function oregon(lines: PdfLines = pdfLines): Promise<LpRow[]> {
  const page = (await get("Oregon Treasury", PENSIONS.oregon.home, "text")) as string | null;
  const links = page ? oregonLinks(page) : []; if (!links.length) throw new ProviderError("Oregon Treasury", "no portfolio reports linked from the Performance & Holdings page");
  const out: LpRow[] = []; const errs: string[] = [];
  for (const l of links) {
    try {
      const buf = (await get("Oregon Treasury", l.url, "pdf", 90_000)) as Buffer | null; if (!buf) { errs.push(`${l.url}: not a PDF`); continue; }
      const ls = await lines(buf);
      const rows = readPdfTable("oregon", ls, asOfDate(ls.slice(0, 40).join(" ")) ?? l.asof, l.url, { yearFirst: true, fallback: [2, 3], section: l.section });
      for (const r of rows) if (l.section) r.src = r.src.replace(PENSIONS.oregon.report, "OPERF Real Assets Portfolio");
      out.push(...rows);
    } catch (e) { errs.push((e as Error).message); }
  }
  if (!out.length) throw new ProviderError("Oregon Treasury", errs[0] ?? "no fund rows read");
  return out;
}
