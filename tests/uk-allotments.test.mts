// Test of src/lib/ukstream: SH01 events from the Companies House filing stream,
// timepoint resume, company names, day grouping, clean-up, dry runs.
// Run: npm test
import { readEvent, readStream, runUkAllotments } from "../src/lib/ukstream/sync";
import { memoryStore } from "../src/lib/market/store";

process.env.COMPANIES_HOUSE_STREAM_KEY = "stream-key"; process.env.COMPANIES_HOUSE_API_KEY = "rest-key";
let fails = 0;
const t = (label: string, ok: boolean, info?: unknown) => { if (!ok) fails++; console.log((ok ? "PASS " : "FAIL ") + label, ok ? "" : JSON.stringify(info)); };
const ev = (num: string, tx: string, type: string, tp: number, filed = "2026-10-29") => ({ resource_kind: "filing-history", resource_uri: `/company/${num}/filing-history/${tx}`, data: { type, description: type === "SH01" ? "capital-allotment-shares" : "accounts", date: filed, description_values: { date: "2026-10-20", capital: [{ figure: "12,500", currency: "GBP" }] } }, event: { timepoint: tp, published_at: `${filed}T10:00:00`, type: "changed" } });

t("SH01 event read: company number, transaction, capital", JSON.stringify(readEvent(ev("12345678", "MzQ", "SH01", 1))) === JSON.stringify({ num: "12345678", name: "", allotted: "2026-10-20", filed: "2026-10-29", capital: [{ ccy: "GBP", figure: 12500 }], tx: "MzQ" }));
t("other filings and deletions skipped", readEvent(ev("12345678", "x", "AA", 2)) === null && readEvent({ ...ev("12345678", "y", "SH01", 3), event: { type: "deleted" } }) === null);

// The stream reader against a fake endless stream: heartbeats, partial lines, then the time limit.
const auths: string[] = []; let asked = "";
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname === "stream.companieshouse.gov.uk") {
    asked = url.search; auths.push(new Headers(init?.headers).get("authorization") ?? "");
    const lines = [JSON.stringify(ev("12345678", "A1", "SH01", 101)), "", JSON.stringify(ev("87654321", "B1", "AA", 102)), JSON.stringify(ev("SC000123", "C1", "SH01", 103, "2026-10-30"))].join("\n") + "\n";
    const signal = init?.signal;
    const body = new ReadableStream({ start(c) { const enc = new TextEncoder(); c.enqueue(enc.encode(lines.slice(0, 40))); c.enqueue(enc.encode(lines.slice(40))); signal?.addEventListener("abort", () => c.error(Object.assign(new Error("aborted"), { name: "AbortError" }))); } });
    return new Response(body, { status: 200 });
  }
  if (url.hostname === "api.company-information.service.gov.uk") return new Response(JSON.stringify({ company_name: url.pathname.endsWith("12345678") ? "ACME ROBOTICS LTD" : "SCOTCO LTD" }), { status: 200, headers: { "content-type": "application/json" } });
  return new Response("{}", { status: 404 });
}) as typeof fetch;
const rs = await readStream("stream-key", 100, 200);
t("stream: SH01 lines kept across chunk boundaries, last timepoint, resume parameter, key as Basic user", rs.items.length === 2 && rs.timepoint === 103 && rs.events === 3 && asked === "?timepoint=100" && auths[0] === "Basic " + Buffer.from("stream-key:").toString("base64"), { rs, asked });

const store = memoryStore({ ukalloc: [{ id: "d-2026-07-01", data: { type: "allot-day", date: "2026-07-01", items: [{ num: "1", tx: "old" }] } }, { id: "_meta", data: { type: "meta", state: { timepoint: 100 } } }] });
const r = await runUkAllotments({ store, now: new Date("2026-10-30T02:00:00Z"), readMs: 200 });
const db = Object.fromEntries(store.dump().ukalloc.map((d) => [d.id, d.data as Record<string, any>])); // eslint-disable-line @typescript-eslint/no-explicit-any
t("allotments grouped by filing date, names looked up", db["d-2026-10-29"]?.items[0].name === "ACME ROBOTICS LTD" && db["d-2026-10-30"]?.items[0].num === "SC000123" && r.found === 2 && r.named === 2, db);
t("resume point saved; days older than 60 days removed", db._meta.state.timepoint === 103 && !db["d-2026-07-01"] && /2 SH01 filings/.test(db._meta.note), db._meta);
await runUkAllotments({ store, now: new Date("2026-10-30T03:00:00Z"), readMs: 200 });
const again = Object.fromEntries(store.dump().ukalloc.map((d) => [d.id, d.data as Record<string, any>])); // eslint-disable-line @typescript-eslint/no-explicit-any
t("re-reading the same events does not duplicate them", again["d-2026-10-29"].items.length === 1, again["d-2026-10-29"]);
const dry = memoryStore(); await runUkAllotments({ store: dry, readMs: 100, dryRun: true });
t("dry run writes nothing", JSON.stringify(dry.dump()) === "{}");
delete process.env.COMPANIES_HOUSE_STREAM_KEY;
let msg = ""; try { await runUkAllotments({ store: memoryStore() }); } catch (e) { msg = (e as Error).message; }
t("needs a stream key", /COMPANIES_HOUSE_STREAM_KEY/.test(msg), msg);

console.log(fails ? `\n${fails} uk-allotments test(s) failed` : "\nAll uk-allotments tests passed");
process.exit(fails ? 1 : 0);
