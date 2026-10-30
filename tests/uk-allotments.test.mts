// Test of src/lib/ukstream: SH01 events from the Companies House filing stream,
// timepoint resume, company names, day grouping, clean-up, dry runs.
// Run: npm test
import { docContentUrl, impliedValue, readEvent, readSh01, readSh01Total, readStream, runUkAllotments } from "../src/lib/ukstream/sync";
import { memoryStore } from "../src/lib/market/store";

process.env.COMPANIES_HOUSE_STREAM_KEY = "stream-key"; process.env.COMPANIES_HOUSE_API_KEY = "rest-key";
/** A one-page PDF with a text layer (Helvetica), one line per string; no lines = a page with no text, like a scan. */
function makePdf(lines: string[]): Buffer {
  const esc = (x: string) => x.replace(/[\\()]/g, (c) => "\\" + c);
  const content = lines.length ? "BT /F1 9 Tf 30 810 Td 11 TL " + lines.map((l) => `(${esc(l)}) Tj T*`).join(" ") + " ET" : "0 0 m 10 10 l S";
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>", `<< /Length ${content.length} >>\nstream\n${content}\nendstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  let out = "%PDF-1.4\n"; const offs: number[] = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length; out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("") + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
  return Buffer.from(out, "latin1");
}
const SH01 = makePdf(["Return of Allotment of Shares", "Company Name: ACME ROBOTICS LTD", "Shares Allotted (including bonus shares)", "Date or period during which shares are allotted From 20/10/2026",
  "Class of Shares: ORDINARY Number allotted 2,000", "Currency: GBP Nominal value of each share 0.001", "Amount paid: 1.25", "Amount unpaid: 0",
  "Class of Shares: SERIES A PREFERENCE Number allotted 400", "Currency: GBP Nominal value of each share 0.001", "Amount paid: 10", "Amount unpaid: 0",
  "Statement of Capital (Share Capital)", "Class of Shares: ORDINARY Number allotted 102000", "Currency: GBP Aggregate nominal value: 102", "Amount paid per share 1"]);
const SCAN = makePdf([]);
let fails = 0;
const t = (label: string, ok: boolean, info?: unknown) => { if (!ok) fails++; console.log((ok ? "PASS " : "FAIL ") + label, ok ? "" : JSON.stringify(info)); };
const ev = (num: string, tx: string, type: string, tp: number, filed = "2026-10-29", doc?: string) => ({ resource_kind: "filing-history", resource_uri: `/company/${num}/filing-history/${tx}`, data: { type, description: type === "SH01" ? "capital-allotment-shares" : "accounts", date: filed, ...(doc ? { links: { document_metadata: doc } } : {}), description_values: { date: "2026-10-20", capital: [{ figure: "12,500", currency: "GBP" }] } }, event: { timepoint: tp, published_at: `${filed}T10:00:00`, type: "changed" } });

t("SH01 event read: company number, transaction, capital", JSON.stringify(readEvent(ev("12345678", "MzQ", "SH01", 1))) === JSON.stringify({ num: "12345678", name: "", allotted: "2026-10-20", filed: "2026-10-29", capital: [{ ccy: "GBP", figure: 12500 }], tx: "MzQ" }));
t("SH01 text: amount raised per class (shares × paid incl. premium); statement of capital not counted", JSON.stringify(readSh01("Class of Shares: ORDINARY Number allotted 2,000\nCurrency: GBP Nominal value of each share 0.001\nAmount paid: 1.25\nAmount unpaid: 0\nStatement of Capital\nClass of Shares: ORDINARY Number allotted 9000\nAmount paid: 1")) === JSON.stringify([{ cls: "ORDINARY", ccy: "GBP", shares: 2000, nominal: 0.001, paid: 1.25, amount: 2500 }]));
t("SH01 text: paper form table row", readSh01("Class of shares Currency Number of shares allotted Nominal value Amount paid\nOrdinary GBP 1,000 0.01 1.50 0")[0]?.amount === 1500 && readSh01("nothing here").length === 0);
t("document content URL from metadata URL", docContentUrl("https://frontend-doc-api.company-information.service.gov.uk/document/AbC-123_x") === "https://document-api.company-information.service.gov.uk/document/AbC-123_x/content" && docContentUrl("") === null);
t("other filings and deletions skipped", readEvent(ev("12345678", "x", "AA", 2)) === null && readEvent({ ...ev("12345678", "y", "SH01", 3), event: { type: "deleted" } }) === null);

// The stream reader against a fake endless stream: heartbeats, partial lines, then the time limit.
const auths: string[] = []; const docAuth: string[] = []; let asked = "";
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname === "stream.companieshouse.gov.uk") {
    asked = url.search; auths.push(new Headers(init?.headers).get("authorization") ?? "");
    const lines = [JSON.stringify(ev("12345678", "A1", "SH01", 101, "2026-10-29", "https://document-api.company-information.service.gov.uk/document/DOC1")), "", JSON.stringify(ev("87654321", "B1", "AA", 102)), JSON.stringify(ev("SC000123", "C1", "SH01", 103, "2026-10-30"))].join("\n") + "\n";
    const signal = init?.signal;
    const body = new ReadableStream({ start(c) { const enc = new TextEncoder(); c.enqueue(enc.encode(lines.slice(0, 40))); c.enqueue(enc.encode(lines.slice(40))); signal?.addEventListener("abort", () => c.error(Object.assign(new Error("aborted"), { name: "AbortError" }))); } });
    return new Response(body, { status: 200 });
  }
  if (url.hostname === "document-api.company-information.service.gov.uk") { docAuth.push(new Headers(init?.headers).get("authorization") ?? ""); return new Response(new Uint8Array(url.pathname.includes("DOC1") ? SH01 : SCAN), { status: 200, headers: { "content-type": "application/pdf" } }); }
  if (url.hostname === "api.company-information.service.gov.uk" && url.pathname.includes("/filing-history/")) return new Response(JSON.stringify({ links: { document_metadata: "https://frontend-doc-api.company-information.service.gov.uk/document/SCAN2" } }), { status: 200 });
  if (url.hostname === "api.company-information.service.gov.uk") return new Response(JSON.stringify({ company_name: url.pathname.endsWith("12345678") ? "ACME ROBOTICS LTD" : "SCOTCO LTD" }), { status: 200, headers: { "content-type": "application/json" } });
  return new Response("{}", { status: 404 });
}) as typeof fetch;
const rs = await readStream("stream-key", 100, 200);
t("stream: SH01 lines kept across chunk boundaries, last timepoint, resume parameter, key as Basic user", rs.items.length === 2 && rs.timepoint === 103 && rs.events === 3 && asked === "?timepoint=100" && auths[0] === "Basic " + Buffer.from("stream-key:").toString("base64"), { rs, asked });

const store = memoryStore({ ukalloc: [{ id: "d-2026-07-01", data: { type: "allot-day", date: "2026-07-01", items: [{ num: "1", tx: "old" }] } }, { id: "_meta", data: { type: "meta", state: { timepoint: 100 } } }] });
const r = await runUkAllotments({ store, now: new Date("2026-10-30T02:00:00Z"), readMs: 200 });
const db = Object.fromEntries(store.dump().ukalloc.map((d) => [d.id, d.data as Record<string, any>])); // eslint-disable-line @typescript-eslint/no-explicit-any
t("allotments grouped by filing date, names looked up", db["d-2026-10-29"]?.items[0].name === "ACME ROBOTICS LTD" && db["d-2026-10-30"]?.items[0].num === "SC000123" && r.found === 2 && r.named === 2, db);
const acme = db["d-2026-10-29"]?.items[0], sco = db["d-2026-10-30"]?.items[0];
t("amount raised read from the SH01 PDF, by class", acme?.pdf === "ok" && acme.raised.length === 2 && acme.raised[0].amount === 2500 && acme.raised[1].cls === "SERIES A PREFERENCE" && acme.raised[1].amount === 4000 && docAuth[0] === "Basic " + Buffer.from("rest-key:").toString("base64"), acme);
t("document looked up from filing history; scanned PDF leaves the amount empty", sco?.doc?.includes("SCAN2") && sco.pdf === "no-text" && sco.raised === null && r.pdfs === 2 && r.amounts === 1 && /2 SH01 documents read \(1 with the amount raised\)/.test(r.note), { sco, r });
t("resume point saved; days older than 60 days removed", db._meta.state.timepoint === 103 && !db["d-2026-07-01"] && /2 SH01 filings/.test(db._meta.note), db._meta);
await runUkAllotments({ store, now: new Date("2026-10-30T03:00:00Z"), readMs: 200 });
const again = Object.fromEntries(store.dump().ukalloc.map((d) => [d.id, d.data as Record<string, any>])); // eslint-disable-line @typescript-eslint/no-explicit-any
t("re-reading the same events does not duplicate them, and documents already read are not fetched again", again["d-2026-10-29"].items.length === 1 && docAuth.length === 2 && again["d-2026-10-29"].items[0].raised.length === 2, { docAuth, a: again["d-2026-10-29"] });
const dry = memoryStore(); await runUkAllotments({ store: dry, readMs: 100, dryRun: true });
t("dry run writes nothing", JSON.stringify(dry.dump()) === "{}");
delete process.env.COMPANIES_HOUSE_STREAM_KEY;
let msg = ""; try { await runUkAllotments({ store: memoryStore() }); } catch (e) { msg = (e as Error).message; }
t("needs a stream key", /COMPANIES_HOUSE_STREAM_KEY/.test(msg), msg);

const SH = "Class of Shares: ORDINARY Number allotted 2,000\nCurrency: GBP Nominal value of each share 0.001\nAmount paid: 1.25\nAmount unpaid: 0\nStatement of Capital (Totals)\nCurrency: GBP Total number of shares: 1,002,000 Total aggregate nominal value: 1002";
t("SH01: total shares in issue from the statement of capital", readSh01Total(SH) === 1002000 && readSh01Total("Class of Shares: X") === null);
t("SH01: implied valuation = price paid × shares in issue; none for par issues or mixed currencies", impliedValue(readSh01(SH), readSh01Total(SH))?.value === 1252500
  && impliedValue([{ cls: "O", ccy: "GBP", shares: 10, nominal: 1, paid: 1, amount: 10 }], 100) === null
  && impliedValue([{ cls: "O", ccy: "GBP", shares: 10, nominal: 0.1, paid: 2, amount: 20 }, { cls: "P", ccy: "USD", shares: 1, nominal: 0.1, paid: 3, amount: 3 }], 100) === null, impliedValue(readSh01(SH), readSh01Total(SH)));
console.log(fails ? `\n${fails} uk-allotments test(s) failed` : "\nAll uk-allotments tests passed");
process.exit(fails ? 1 : 0);
