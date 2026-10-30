/**
 * Every new UK share allotment (form SH01), from the Companies House streaming API.
 *
 * The filing-history stream (https://stream.companieshouse.gov.uk/filings) sends one JSON
 * event per line for every filing accepted at Companies House. A scheduled run connects,
 * resumes from the last timepoint it saw, reads for a fixed time (a serverless function
 * can't hold the connection open for good), keeps the SH01 events and stops.
 *
 *   ukalloc/d-<date>  { type: "allot-day", date, items: [{ num, name, allotted, filed, capital, tx, doc, raised, pdf }] }
 *   ukalloc/_meta     { type: "meta", checked, n, note, state: { timepoint } }
 *
 * Needs COMPANIES_HOUSE_STREAM_KEY: a separate "Streaming API" key from the Companies House
 * Developer Hub (REST keys don't work on the stream). Company names are looked up with the
 * REST key (COMPANIES_HOUSE_API_KEY), a few per run. Contains public sector information
 * licensed under the Open Government Licence v3.0.
 *
 * Amount raised: the register only holds the share capital after the allotment. The number
 * of shares and the price paid are in the SH01 document itself, so a budgeted number of SH01
 * PDFs a run (UK_SH01_PDF_BUDGET, default 40) is fetched from the Companies House Document API
 * (same REST key) and their text layer read: each class allotted gives shares × amount paid per
 * share (including premium). Paper filings are scanned images with no text: their amount stays
 * null (pdf: "no-text"). Older items without an amount are retried in later runs, up to 2 tries.
 */
import "server-only";
import { envKey, ProviderError } from "@/lib/providers/http";
import { scrub } from "@/lib/providers";
import { createCompaniesHouse } from "@/lib/providers/companies-house";
import { openStore, type Doc, type DocStore } from "@/lib/market/store";
import { pdfText } from "@/lib/pdftext";

/** One class of shares allotted, from the SH01 document: amount = shares × paid (per share, including premium). */
export type Raised = { cls: string; ccy: string; shares: number; nominal: number | null; paid: number; amount: number };
export type Allot = {
  num: string; name: string; allotted: string | null; filed: string; capital: { ccy: string; figure: number | null }[]; tx: string;
  /** Document API metadata URL of the SH01 (from the event, or looked up). */
  doc?: string | null;
  /** Amounts raised by class, read from the SH01 PDF (null: not read, scanned, or not understood). */
  raised?: Raised[] | null;
  /** State of the PDF read: ok, no-text (scanned), unparsed, error, none (no document). */
  pdf?: "ok" | "no-text" | "unparsed" | "error" | "none";
  tries?: number;
  /** Implied value of the company at this round's price: price paid per share × total shares in issue afterwards. */
  implied?: Implied | null;
};
export type Implied = { ccy: string; price: number; shares: number; value: number };
const COL = "ukalloc";
const STREAM = "https://stream.companieshouse.gov.uk/filings";

type Event = { resource_kind?: string; resource_uri?: string; resource_id?: string; data?: { type?: string; description?: string; date?: string; category?: string; links?: { document_metadata?: string }; description_values?: { date?: string; capital?: { figure?: string; currency?: string }[] } }; event?: { timepoint?: number; published_at?: string; type?: string } };

/** An SH01 event as an allotment, or null. */
export function readEvent(e: Event): Allot | null {
  const d = e.data ?? {}; if (String(d.type ?? "").toUpperCase() !== "SH01" && d.description !== "capital-allotment-shares") return null;
  if (e.event?.type === "deleted") return null;
  const m = /^\/company\/([A-Z0-9]{8})\/filing-history\/([^/]+)/i.exec(String(e.resource_uri ?? "")); if (!m) return null;
  const capital = (d.description_values?.capital ?? []).map((c) => { const f = Number(String(c.figure ?? "").replace(/,/g, "")); return { ccy: String(c.currency ?? ""), figure: Number.isFinite(f) ? f : null }; }).filter((c) => c.ccy);
  const a: Allot = { num: m[1].toUpperCase(), name: "", allotted: d.description_values?.date ?? null, filed: String(d.date ?? e.event?.published_at ?? "").slice(0, 10), capital, tx: m[2] };
  if (d.links?.document_metadata) a.doc = d.links.document_metadata;
  return a;
}

// --- amount raised, from the SH01 document ---------------------------------------------------------
const DOC_API = "https://document-api.company-information.service.gov.uk";
const n = (s: string | undefined) => { const v = Number(String(s ?? "").replace(/[,£$€\s]/g, "")); return s != null && Number.isFinite(v) ? v : null; };
const CCY: Record<string, string> = { "£": "GBP", $: "USD", "€": "EUR" };
/**
 * Text of an SH01 → amounts raised by class. Two layouts:
 *  - electronic filings: blocks "Class of Shares: ORDINARY … Currency: GBP … Number allotted 1000 …
 *    Nominal value of each share 0.001 … Amount paid: 1.5 … Amount unpaid: 0" (the statement of capital
 *    that follows uses "Aggregate nominal value" and no amount paid per share, so it is not counted);
 *  - the paper form's table row: "ORDINARY GBP 1,000 0.001 1.50 0".
 */
export function readSh01(text: string): Raised[] {
  const t = text.replace(/\r/g, "").replace(/[ \t]+/g, " ");
  const head = t.split(/statement of capital/i)[0] || t; // the allotment section comes first
  const out: Raised[] = [];
  for (const b of head.split(/(?=class of shares\s*:)/i).filter((x) => /^class of shares/i.test(x))) {
    const shares = n(/number allotted\s*:?\s*([\d,]+)/i.exec(b)?.[1]); const paid = n(/amount paid(?: \(including[^)]*\))?(?: on each share)?\s*:?\s*([£$€]?\s*[\d,]*\.?\d+)/i.exec(b)?.[1]);
    if (!shares || paid == null) continue;
    const cls = (/class of shares\s*:\s*([^\n]+?)(?=\s+(?:number allotted|currency|nominal|amount)\b|\n|$)/i.exec(b)?.[1] ?? "").trim().slice(0, 60);
    const ccy = (/currency\s*:?\s*([A-Z]{3})\b/.exec(b)?.[1] ?? "GBP").toUpperCase();
    const nominal = n(/nominal value of each share\s*:?\s*([£$€]?\s*[\d,]*\.?\d+)/i.exec(b)?.[1]);
    out.push({ cls: cls || "Shares", ccy, shares, nominal, paid, amount: Number((shares * paid).toFixed(2)) });
  }
  if (out.length) return out;
  for (const m of head.matchAll(/^\s*([A-Za-z][A-Za-z0-9 '’\-]{1,40}?)\s+(GBP|USD|EUR|£|\$|€)\s+([\d,]+)\s+([£$€]?[\d,]*\.?\d+)\s+([£$€]?[\d,]*\.?\d+)(?:\s+([\d,]*\.?\d+))?\s*$/gim)) {
    const shares = n(m[3]), nominal = n(m[4]), paid = n(m[5]); if (!shares || paid == null) continue;
    out.push({ cls: m[1].trim(), ccy: CCY[m[2]] ?? m[2].toUpperCase(), shares, nominal, paid, amount: Number((shares * paid).toFixed(2)) });
  }
  return out;
}
/** Total shares in issue after the allotment, from the SH01's statement of capital ("Total number of shares: …"). */
export function readSh01Total(text: string): number | null {
  const parts = text.replace(/\r/g, "").split(/statement of capital/i); if (parts.length < 2) return null;
  const tail = parts.slice(1).join(" ");
  const all = [...tail.matchAll(/total number of shares(?: in issue)?\s*:?\s*([\d,]{1,20})/gi)].map((m) => Number(m[1].replace(/,/g, ""))).filter((v) => v > 0);
  return all.length ? Math.max(...all) : null;
}
/**
 * Implied valuation: the price paid per share in this allotment × all shares in issue afterwards. Only when the
 * allotment is in one currency (the highest price paid is used if classes differ). Labelled "implied" in the app:
 * it treats every class as worth this round's price, and an allotment at nominal value (no premium) says little.
 */
export function impliedValue(raised: Raised[] | null | undefined, total: number | null): Implied | null {
  if (!raised?.length || !total) return null; const ccys = new Set(raised.map((r) => r.ccy)); if (ccys.size !== 1) return null;
  const price = Math.max(...raised.map((r) => r.paid)); if (!(price > 0)) return null;
  if (raised.every((r) => r.nominal != null && r.paid <= r.nominal)) return null; // issued at par: no market price
  return { ccy: [...ccys][0], price, shares: total, value: Number((price * total).toFixed(0)) };
}

/** Document API content URL from a metadata URL (any of the API's host names) or a document id. */
export function docContentUrl(meta: string): string | null {
  const id = /\/document\/([A-Za-z0-9_\-]+)/.exec(meta)?.[1] ?? (/^[A-Za-z0-9_\-]{10,}$/.test(meta) ? meta : null);
  return id ? `${DOC_API}/document/${id}/content` : null;
}
/** Reads one SH01: looks up its document link if needed, fetches the PDF and parses it. Mutates `a`. */
export async function readAmount(a: Allot, key: string, read: (b: Buffer) => Promise<string> = pdfText): Promise<void> {
  const auth = { authorization: "Basic " + Buffer.from(`${key}:`).toString("base64") };
  a.tries = (a.tries ?? 0) + 1;
  try {
    if (!a.doc) {
      const r = await fetch(`https://api.company-information.service.gov.uk/company/${a.num}/filing-history/${encodeURIComponent(a.tx)}`, { headers: { ...auth, accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
      if (!r.ok) { a.pdf = r.status === 404 ? "none" : "error"; return; }
      a.doc = ((await r.json()) as { links?: { document_metadata?: string } }).links?.document_metadata ?? null;
      if (!a.doc) { a.pdf = "none"; return; } // paper filing not yet scanned, or no image
    }
    const url = docContentUrl(a.doc); if (!url) { a.pdf = "none"; return; }
    // The API answers with a redirect to a short-lived file URL; fetch drops the key on the cross-site hop.
    const res = await fetch(url, { headers: { ...auth, accept: "application/pdf" }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) { a.pdf = "error"; return; }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.toString("latin1", 0, 5) !== "%PDF-") { a.pdf = "error"; return; }
    const text = await read(buf);
    if (text.replace(/\s/g, "").length < 40) { a.pdf = "no-text"; a.raised = null; return; }
    const r = readSh01(text); a.raised = r.length ? r : null; a.pdf = r.length ? "ok" : "unparsed"; a.implied = impliedValue(a.raised, readSh01Total(text));
  } catch { a.pdf = "error"; }
}

/** Reads the stream for up to `ms` milliseconds from `timepoint`; returns the events' allotments and the last timepoint seen. */
export async function readStream(key: string, timepoint: number | null, ms: number): Promise<{ items: Allot[]; timepoint: number | null; events: number }> {
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), ms);
  const items: Allot[] = []; let tp = timepoint; let events = 0;
  try {
    const res = await fetch(`${STREAM}${timepoint ? `?timepoint=${timepoint}` : ""}`, { headers: { authorization: "Basic " + Buffer.from(`${key}:`).toString("base64") }, signal: ctl.signal });
    if (res.status === 416) throw new ProviderError("Companies House stream", "timepoint too old; starting from now next run", 416);
    if (!res.ok || !res.body) throw new ProviderError("Companies House stream", `HTTP ${res.status}`, res.status);
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true }); let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1); if (!line) continue; // blank lines are heartbeats
        let e: Event; try { e = JSON.parse(line); } catch { continue; }
        events++; if (typeof e.event?.timepoint === "number") tp = e.event.timepoint;
        const a = readEvent(e); if (a) items.push(a);
      }
    }
  } catch (e) {
    if ((e as Error).name !== "AbortError") throw e; // the time limit ends the read
  } finally { clearTimeout(timer); }
  return { items, timepoint: tp, events };
}

export type UkStreamReport = { dryRun: boolean; events: number; found: number; named: number; amounts: number; pdfs: number; timepoint: number | null; note: string };

export async function runUkAllotments(opts: { store?: DocStore; dryRun?: boolean; now?: Date; readMs?: number; nameBudget?: number; pdfBudget?: number; read?: typeof readStream; pdfText?: (b: Buffer) => Promise<string> } = {}): Promise<UkStreamReport> {
  const key = envKey("COMPANIES_HOUSE_STREAM_KEY"); if (!key) throw new ProviderError("Companies House stream", "Set COMPANIES_HOUSE_STREAM_KEY (a Streaming API key from the Companies House Developer Hub)");
  const now = opts.now ?? new Date(); const checked = now.toISOString(); const store = opts.store ?? openStore();
  const docs = new Map((await store.list(COL)).map((d) => [d.id, d.data]));
  const state = ((docs.get("_meta")?.state ?? {}) as { timepoint?: number | null });
  let r: Awaited<ReturnType<typeof readStream>>;
  try { r = await (opts.read ?? readStream)(key, state.timepoint ?? null, opts.readMs ?? Number(process.env.UK_STREAM_READ_MS ?? 240_000)); }
  catch (e) { if ((e as { status?: number }).status === 416) r = await (opts.read ?? readStream)(key, null, opts.readMs ?? 240_000); else throw e; }

  // Names from the REST API, a few per run (cached in the day docs once found).
  const known = new Map<string, string>(); for (const [, d] of docs) for (const x of ((d.items as Allot[] | undefined) ?? [])) if (x.name) known.set(x.num, x.name);
  let budget = opts.nameBudget ?? Number(process.env.UK_STREAM_NAME_BUDGET ?? 60); let named = 0;
  const ch = envKey("COMPANIES_HOUSE_API_KEY") ? createCompaniesHouse() : null;
  for (const a of r.items) {
    a.name = known.get(a.num) ?? "";
    if (!a.name && ch && budget > 0) { budget--; try { a.name = String((await ch.company(a.num)).company_name ?? ""); if (a.name) { known.set(a.num, a.name); named++; } } catch { /* left unnamed */ } }
  }
  // Group by filing date; keep 60 days.
  const byDay = new Map<string, Allot[]>();
  for (const a of r.items) { const d = a.filed || checked.slice(0, 10); if (!byDay.has(d)) byDay.set(d, []); byDay.get(d)!.push(a); }
  const dayItems = new Map<string, Allot[]>(); const touched = new Set<string>();
  for (const [d, list] of byDay) {
    const old = ((docs.get(`d-${d}`)?.items as Allot[] | undefined) ?? []).map((x) => ({ ...x })); const seen = new Set(old.map((x) => x.tx));
    dayItems.set(d, [...old, ...list.filter((x) => !seen.has(x.tx))]); touched.add(d);
  }
  // Amounts raised from the SH01 PDFs: this run's filings first, then earlier ones not read yet (newest days first).
  let pdfBudget = ch ? opts.pdfBudget ?? Number(process.env.UK_SH01_PDF_BUDGET ?? 40) : 0; let pdfs = 0, amounts = 0;
  const restKey = envKey("COMPANIES_HOUSE_API_KEY");
  const pending = (x: Allot) => !x.raised && (x.pdf === undefined || (x.pdf === "error" && (x.tries ?? 0) < 2));
  const keepFrom = new Date(now.getTime() - 60 * 864e5).toISOString().slice(0, 10);
  const days = [...new Set([...dayItems.keys(), ...[...docs.keys()].filter((id) => /^d-\d{4}-\d{2}-\d{2}$/.test(id)).map((id) => id.slice(2))])].filter((d) => d >= keepFrom).sort().reverse();
  for (const d of days) {
    if (pdfBudget <= 0 || !restKey) break;
    let list = dayItems.get(d);
    if (!list) { const stored = (docs.get(`d-${d}`)?.items as Allot[] | undefined) ?? []; if (!stored.some(pending)) continue; list = stored.map((x) => ({ ...x })); dayItems.set(d, list); }
    for (const a of list) {
      if (pdfBudget <= 0) break; if (!pending(a)) continue;
      pdfBudget--; pdfs++; await readAmount(a, restKey, opts.pdfText); touched.add(d); if (a.raised) amounts++;
    }
  }
  const writes: Doc[] = [...touched].map((d) => ({ id: `d-${d}`, data: { type: "allot-day", date: d, items: dayItems.get(d)! } }));
  const cutoff = new Date(now.getTime() - 60 * 864e5).toISOString().slice(0, 10);
  const remove = [...docs.keys()].filter((id) => /^d-\d{4}-\d{2}-\d{2}$/.test(id) && id.slice(2) < cutoff);
  const total = [...docs].filter(([id]) => id.startsWith("d-") && !remove.includes(id)).reduce((s, [id, x]) => s + (writes.some((w) => w.id === id) ? 0 : ((x.items as unknown[] | undefined)?.length ?? 0)), 0) + writes.reduce((s, w) => s + (w.data.items as unknown[]).length, 0);
  const note = `UK share allotments ${checked.slice(0, 16).replace("T", " ")} UTC: ${r.items.length} SH01 filings in ${r.events} stream events${named ? `, ${named} company names looked up` : ""}${pdfs ? `, ${pdfs} SH01 documents read (${amounts} with the amount raised)` : ""}; ${total} kept over 60 days.`;
  const report: UkStreamReport = { dryRun: !!opts.dryRun, events: r.events, found: r.items.length, named, amounts, pdfs, timepoint: r.timepoint, note: scrub(note) };
  if (!opts.dryRun) {
    if (writes.length) await store.upsert(COL, writes);
    if (remove.length) await store.remove(COL, remove);
    await store.upsert(COL, [{ id: "_meta", data: { type: "meta", checked, n: total, note, state: { timepoint: r.timepoint } } }]);
  }
  return report;
}
