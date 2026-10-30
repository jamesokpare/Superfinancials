/**
 * Every new UK share allotment (form SH01), from the Companies House streaming API.
 *
 * The filing-history stream (https://stream.companieshouse.gov.uk/filings) sends one JSON
 * event per line for every filing accepted at Companies House. A scheduled run connects,
 * resumes from the last timepoint it saw, reads for a fixed time (a serverless function
 * can't hold the connection open for good), keeps the SH01 events and stops.
 *
 *   ukalloc/d-<date>  { type: "allot-day", date, items: [{ num, name, allotted, filed, capital, tx }] }
 *   ukalloc/_meta     { type: "meta", checked, n, note, state: { timepoint } }
 *
 * Needs COMPANIES_HOUSE_STREAM_KEY: a separate "Streaming API" key from the Companies House
 * Developer Hub (REST keys don't work on the stream). Company names are looked up with the
 * REST key (COMPANIES_HOUSE_API_KEY), a few per run. Contains public sector information
 * licensed under the Open Government Licence v3.0.
 */
import "server-only";
import { envKey, ProviderError } from "@/lib/providers/http";
import { scrub } from "@/lib/providers";
import { createCompaniesHouse } from "@/lib/providers/companies-house";
import { openStore, type Doc, type DocStore } from "@/lib/market/store";

export type Allot = { num: string; name: string; allotted: string | null; filed: string; capital: { ccy: string; figure: number | null }[]; tx: string };
const COL = "ukalloc";
const STREAM = "https://stream.companieshouse.gov.uk/filings";

type Event = { resource_kind?: string; resource_uri?: string; resource_id?: string; data?: { type?: string; description?: string; date?: string; category?: string; description_values?: { date?: string; capital?: { figure?: string; currency?: string }[] } }; event?: { timepoint?: number; published_at?: string; type?: string } };

/** An SH01 event as an allotment, or null. */
export function readEvent(e: Event): Allot | null {
  const d = e.data ?? {}; if (String(d.type ?? "").toUpperCase() !== "SH01" && d.description !== "capital-allotment-shares") return null;
  if (e.event?.type === "deleted") return null;
  const m = /^\/company\/([A-Z0-9]{8})\/filing-history\/([^/]+)/i.exec(String(e.resource_uri ?? "")); if (!m) return null;
  const capital = (d.description_values?.capital ?? []).map((c) => { const f = Number(String(c.figure ?? "").replace(/,/g, "")); return { ccy: String(c.currency ?? ""), figure: Number.isFinite(f) ? f : null }; }).filter((c) => c.ccy);
  return { num: m[1].toUpperCase(), name: "", allotted: d.description_values?.date ?? null, filed: String(d.date ?? e.event?.published_at ?? "").slice(0, 10), capital, tx: m[2] };
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

export type UkStreamReport = { dryRun: boolean; events: number; found: number; named: number; timepoint: number | null; note: string };

export async function runUkAllotments(opts: { store?: DocStore; dryRun?: boolean; now?: Date; readMs?: number; nameBudget?: number; read?: typeof readStream } = {}): Promise<UkStreamReport> {
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
  const writes: Doc[] = [];
  for (const [d, list] of byDay) {
    const old = ((docs.get(`d-${d}`)?.items as Allot[] | undefined) ?? []); const seen = new Set(old.map((x) => x.tx));
    const items = [...old, ...list.filter((x) => !seen.has(x.tx))];
    writes.push({ id: `d-${d}`, data: { type: "allot-day", date: d, items } });
  }
  const cutoff = new Date(now.getTime() - 60 * 864e5).toISOString().slice(0, 10);
  const remove = [...docs.keys()].filter((id) => /^d-\d{4}-\d{2}-\d{2}$/.test(id) && id.slice(2) < cutoff);
  const total = [...docs].filter(([id]) => id.startsWith("d-") && !remove.includes(id)).reduce((s, [id, x]) => s + (writes.some((w) => w.id === id) ? 0 : ((x.items as unknown[] | undefined)?.length ?? 0)), 0) + writes.reduce((s, w) => s + (w.data.items as unknown[]).length, 0);
  const note = `UK share allotments ${checked.slice(0, 16).replace("T", " ")} UTC: ${r.items.length} SH01 filings in ${r.events} stream events${named ? `, ${named} company names looked up` : ""}; ${total} kept over 60 days.`;
  const report: UkStreamReport = { dryRun: !!opts.dryRun, events: r.events, found: r.items.length, named, timepoint: r.timepoint, note: scrub(note) };
  if (!opts.dryRun) {
    if (writes.length) await store.upsert(COL, writes);
    if (remove.length) await store.remove(COL, remove);
    await store.upsert(COL, [{ id: "_meta", data: { type: "meta", checked, n: total, note, state: { timepoint: r.timepoint } } }]);
  }
  return report;
}
