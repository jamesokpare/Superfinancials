// Test of src/lib/sec with a fake SEC: XBRL frames merged per company (concept
// preference, quarters and years, shares), sharded by ticker, request budget and
// resume; Reg CF / Reg A quarterly zips read into adm_priv offerings; owner
// entries kept; retirement; dry runs.
// Run: npm test
import { deflateRawSync } from "node:zlib";
import { framePlan, lastQuarters } from "../src/lib/sec/frames";
import { isoDate, pastQuarters, readDataset } from "../src/lib/sec/datasets";
import { runSecSync } from "../src/lib/sec/sync";
import { memoryStore } from "../src/lib/market/store";

process.env.SEC_USER_AGENT = "Superfinancials test ops@example.com"; process.env.SEC_GAP_MS = "0";
const NOW = new Date("2026-10-30T07:10:00Z");

/** A minimal zip (deflate) built in memory. */
function zip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = []; const centrals: Buffer[] = []; let off = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text); const data = deflateRawSync(raw); const nm = Buffer.from(name);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nm.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(off, 42);
    locals.push(lh, nm, data); centrals.push(ch, nm); off += 30 + nm.length + data.length;
  }
  const cd = Buffer.concat(centrals); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(centrals.length / 2, 8); end.writeUInt16LE(centrals.length / 2, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, end]);
}
const tsv = (rows: string[][]) => rows.map((r) => r.join("\t")).join("\r\n") + "\r\n";
const CF = zip({
  "FORM_C_SUBMISSION.tsv": tsv([["ACCESSION_NUMBER", "SUBMISSION_TYPE", "FILING_DATE", "CIK"], ["0001-26-000001", "C", "15-AUG-2026", "1900001"], ["0001-26-000002", "C-U", "20-AUG-2026", "1900001"], ["0001-26-000003", "C", "01-SEP-2026", "1900002"], ["0001-26-000004", "C", "02-SEP-2026", "1900003"]]),
  "FORM_C_ISSUER_INFORMATION.tsv": tsv([["ACCESSION_NUMBER", "IS_PRIMARYISSUER_FLAG", "NAMEOFISSUER", "LEGALSTATUSFORM", "DATEINCORPORATION", "CITY", "STATEORCOUNTRY", "ISSUERWEBSITE", "COMPANYNAME"], ["0001-26-000001", "Y", "Acme Robotics Inc.", "Corporation", "03-MAR-2021", "Austin", "TX", "https://acme.example", "Wefunder Portal LLC"], ["0001-26-000003", "Y", "Brewco LLC", "LLC", "2019-01-01", "Portland", "OR", "", "StartEngine Capital"], ["0001-26-000004", "Y", "Owner Co", "LLC", "", "Reno", "NV", "", "Republic"]]),
  "FORM_C_DISCLOSURE.tsv": tsv([["ACCESSION_NUMBER", "SECURITYOFFEREDTYPE", "PRICE", "OFFERINGAMOUNT", "MAXIMUMOFFERINGAMOUNT", "DEADLINEDATE", "CURRENTEMPLOYEES", "REVENUEMOSTRECENTFISCALYEAR"], ["0001-26-000001", "Preferred Stock", "1.25", "50000", "1235000", "31-DEC-2026", "12", "420000"], ["0001-26-000003", "Debt", "", "25000", "500000", "", "4", "0"]]),
});
const REGA = zip({
  "FORM_1A_SUBMISSION.tsv": tsv([["ACCESSION_NUMBER", "SUBMISSION_TYPE", "FILING_DATE", "CIK"], ["0002-26-000001", "1-A", "2026-07-10", "1800001"], ["0002-26-000002", "1-K", "2026-07-11", "1800002"]]),
  "FORM_1A_ISSUER_INFORMATION.tsv": tsv([["ACCESSION_NUMBER", "ISSUER_NAME", "CITY", "STATE_OR_COUNTRY", "YEAR_OF_INCORPORATION"], ["0002-26-000001", "Solar Homes REIT Inc.", "Denver", "CO", "2020"]]),
  "FORM_1A_OFFERING.tsv": tsv([["ACCESSION_NUMBER", "SECURITIES_OFFERED", "PRICE_PER_SECURITY", "TOTAL_AGGREGATE_OFFERING"], ["0002-26-000001", "Common Stock", "10", "75000000"]]),
});

const calls: string[] = []; let deny403 = false;
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = new URL(input instanceof Request ? input.url : String(input)); calls.push(url.pathname);
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
  if (deny403) return json({ message: "Request rate threshold exceeded" }, 403);
  if (url.pathname === "/files/company_tickers.json") return json({ "0": { cik_str: 320193, ticker: "AAPL", title: "Apple Inc." }, "1": { cik_str: 1652044, ticker: "GOOGL", title: "Alphabet" }, "2": { cik_str: 1652044, ticker: "GOOG", title: "Alphabet" }, "3": { cik_str: 1, ticker: "1ABC", title: "Numeric" } });
  const m = url.pathname.match(/^\/api\/xbrl\/frames\/([\w-]+)\/(\w+)\/([\w-]+)\/(CY\d{4}(?:Q\dI?)?)\.json$/);
  if (m) {
    const [, , concept, , period] = m; const data: unknown[] = [];
    const q = /Q\d$/.test(period); const yr = Number(period.slice(2, 6));
    if (period.endsWith("I")) { if (concept === "EntityCommonStockSharesOutstanding") data.push({ accn: "a", cik: 320193, entityName: "Apple Inc.", end: "2026-09-27", val: 14.8e9 }); }
    else if (concept === "Revenues" && q) data.push({ accn: "a1", cik: 1652044, entityName: "Alphabet Inc.", start: "2026-04-01", end: "2026-06-30", val: 96e9 });
    else if (concept === "RevenueFromContractWithCustomerExcludingAssessedTax" && q) data.push({ accn: "a2", cik: 320193, entityName: "Apple Inc.", start: `${yr}-03-29`, end: `${yr}-06-28`, val: 94e9 }, { accn: "a3", cik: 1652044, entityName: "Alphabet Inc.", start: "2026-04-01", end: "2026-06-30", val: 1 });
    else if (concept === "EarningsPerShareDiluted" && q) data.push({ accn: "a4", cik: 320193, entityName: "Apple Inc.", start: `${yr}-03-29`, end: `${yr}-06-28`, val: 1.57 });
    else if (concept === "EarningsPerShareBasic" && q) data.push({ accn: "a5", cik: 320193, entityName: "Apple Inc.", start: `${yr}-03-29`, end: `${yr}-06-28`, val: 1.58 }, { accn: "a6", cik: 1, entityName: "Numeric", start: `${yr}-03-29`, end: `${yr}-06-28`, val: -0.1 });
    else if (concept === "EarningsPerShareDiluted" && !q) data.push({ accn: "a7", cik: 320193, entityName: "Apple Inc.", start: `${yr - 1}-09-29`, end: `${yr}-09-27`, val: 6.1 });
    else return json({ error: "no frame" }, 404);
    return json({ taxonomy: "us-gaap", tag: concept, pts: data.length, data });
  }
  if (url.pathname.endsWith("/2026q3_cf.zip")) return new Response(new Uint8Array(CF));
  if (url.pathname.endsWith("/2026q3_rega.zip")) return new Response(new Uint8Array(REGA));
  if (url.pathname.endsWith(".zip")) return new Response("<Error>NoSuchKey</Error>", { status: 404 });
  return json({ error: "not mocked " + url.pathname }, 404);
}) as typeof fetch;

let fails = 0;
const t = (label: string, ok: boolean, info?: unknown) => { if (!ok) fails++; console.log((ok ? "PASS " : "FAIL ") + label, ok ? "" : JSON.stringify(info)); };

t("quarters: last complete calendar quarters, newest first", lastQuarters(NOW, 3).map((q) => q.p).join() === "CY2026Q3,CY2026Q2,CY2026Q1" && lastQuarters(NOW, 1)[0].end === "2026-09-30" && pastQuarters(new Date("2026-02-01"), 2).join() === "2025q4,2025q3", lastQuarters(NOW, 3));
t("plan: 5 concepts × (8 quarters + 3 years) + 2 share frames", framePlan(NOW).length === 57, framePlan(NOW).length);
t("dates: SEC data-set formats", isoDate("05-JAN-2026") === "2026-01-05" && isoDate("2026-01-05 00:00:00") === "2026-01-05" && isoDate("1/5/2026") === "2026-01-05" && isoDate("") === null);
const offs = readDataset("cf", CF);
t("Form C: original offerings only (progress updates skipped), issuer and offering joined", offs.length === 3 && offs[0].name === "Acme Robotics Inc." && offs[0].platform === "Wefunder Portal LLC" && offs[0].target === 50000 && offs[0].offered === 1235000 && offs[0].founded === 2021 && offs[0].deadline === "2026-12-31" && offs[0].url.endsWith("/1900001/000126000001/0001-26-000001-index.htm"), offs[0]);
const ra = readDataset("rega", REGA);
t("Reg A: Form 1-A offerings with total offering size (1-K reports skipped)", ra.length === 1 && ra[0].name === "Solar Homes REIT Inc." && ra[0].offered === 75e6 && ra[0].price === 10 && ra[0].founded === 2020 && ra[0].state === "CO", ra);

const store = memoryStore({ adm_priv: [
  { id: "secc-1900003", data: { kind: "raise", name: "Owner Co (edited)", srcName: "Data desk" } },
  { id: "secc-1700000", data: { kind: "raise", name: "Old Offering", gen: "sec-datasets", last: "2025-06-01", filed: "2025-06-01" } },
] });
const r = await runSecSync({ store, now: NOW, budget: 40 });
const dump = store.dump();
const shard = (id: string) => dump.secframes.find((d) => d.id === id)?.data as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const A = shard("t-A")?.items.AAPL; const G = shard("t-G")?.items.GOOGL;
t("frames: Apple quarters with diluted EPS preferred and contract revenue as fallback", A?.q[0].p === "CY2026Q3" && A.q[0].eps === 1.57 && A.q[0].er === 0 && A.q[0].rev === 94e9 && A.cik === 320193, A?.q?.[0]);
t("frames: Revenues wins over contract revenue whatever the order", G?.q.find((x: { p: string }) => x.p === "CY2026Q2")?.rev === 96e9, G?.q);
t("frames: one ticker per company (the first listed), numeric tickers in shard 0", !shard("t-G").items.GOOG && !!shard("t-0")?.items["1ABC"], Object.keys(shard("t-G").items));
t("frames: newest periods first within the budget; shares outstanding", A?.fy.length === 1 && A.fy[0].p === "CY2025" && A.fy[0].eps === 6.1 && A.fy[0].e === "2025-09-27" && A.sh?.[1] === 14.8e9, { fy: A?.fy, sh: A?.sh });
t("frames: shard carries source credit", shard("t-A").src === "SEC EDGAR XBRL (public domain)" && shard("t-A").n === 1, shard("t-A"));
t("frames: the budget limits requests; the rest are due next run", r.frames.fetched === 40 && r.frames.due === 57, r.frames);
const priv = Object.fromEntries(dump.adm_priv.map((d) => [d.id, d.data as Record<string, any>])); // eslint-disable-line @typescript-eslint/no-explicit-any
const c1 = priv["secc-1900001"];
t("Form C → adm_priv raise doc with amounts, portal, credit", c1?.kind === "raise" && c1.fundType === "Reg CF offering" && c1.offered === 1235000 && c1.target === 50000 && c1.platform === "Wefunder Portal LLC" && c1.gen === "sec-datasets" && /Regulation Crowdfunding offering \(SEC Form C, filed 2026-08-15\), target US\$0\.05m, up to US\$1\.2m via Wefunder/.test(c1.desc) && c1.srcName === "SEC Regulation Crowdfunding data sets", c1);
t("Reg A → adm_priv secr- doc", priv["secr-1800001"]?.fundType === "Reg A offering" && priv["secr-1800001"].offered === 75e6, priv["secr-1800001"]);
t("owner entries untouched; offerings filed over a year ago retired", priv["secc-1900003"].name === "Owner Co (edited)" && !priv["secc-1700000"] && r.datasets.kept === 1 && r.datasets.removed === 1, r.datasets);
const meta = (dump.secsync.find((d) => d.id === "_meta")?.data ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
t("meta: note, sources, resume state", /XBRL frames 40 fetched \(57 due\)/.test(meta.note) && Object.keys(meta.state.frameAt).length === 40 && meta.state.ds.includes("2026q3_cf") && !meta.state.ds.includes("2026q2_cf") && meta.sources.frames.series === 3, meta);

const n0 = calls.length;
const r2 = await runSecSync({ store, now: new Date("2026-10-30T09:00:00Z"), budget: 40 });
const again = calls.slice(n0);
t("next run: only the 17 frames not fetched yet; data sets already read are not downloaded again", r2.frames.fetched === 17 && !again.some((c) => c.endsWith("2026q3_cf.zip")) && again.some((c) => c.endsWith("2026q2_cf.zip")), { f: r2.frames, again: again.filter((c) => c.endsWith(".zip")) });
const A2 = (store.dump().secframes.find((d) => d.id === "t-A")?.data as Record<string, any>).items.AAPL; // eslint-disable-line @typescript-eslint/no-explicit-any
t("merged across runs: 8 quarters and 3 fiscal years, newest first", A2.q.length === 8 && A2.fy.map((x: { p: string }) => x.p).join() === "CY2025,CY2024,CY2023" && A2.q[0].eps === 1.57, { q: A2.q.length, fy: A2.fy });
const r3 = await runSecSync({ store, now: new Date("2026-10-30T10:00:00Z") });
t("nothing due an hour later: no frame requests", r3.frames.fetched === 0 && r3.frames.due === 0 && r3.frames.companies === 3, r3.frames);

deny403 = true; const s4 = memoryStore();
const r4 = await runSecSync({ store: s4, now: NOW });
t("403 stops the run after one request and is reported", r4.frames.failed.length === 1 && !!r4.sources.frames.error && !!r4.sources.datasets.error, r4);
deny403 = false;
const dry = memoryStore(); await runSecSync({ store: dry, now: NOW, dryRun: true, budget: 5 });
t("dry run writes nothing", JSON.stringify(dry.dump()) === "{}", dry.dump());
delete process.env.SEC_USER_AGENT;
let msg = ""; try { await runSecSync({ store: memoryStore(), now: NOW }); } catch (err) { msg = (err as Error).message; }
t("needs a contact User-Agent", /SEC_USER_AGENT/.test(msg), msg);

console.log(fails ? `\n${fails} sec-sync test(s) failed` : "\nAll sec-sync tests passed");
process.exit(fails ? 1 : 0);
