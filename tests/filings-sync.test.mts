// Test of src/lib/filings with a fake SEC EDGAR: ticker → CIK, filings of
// interest, 8-K items, earnings press releases, re-runs, failures, dry runs.
// Run: npm test
import { describe, pickExhibit, runFilingsSync } from "../src/lib/filings/sync";
import { memoryStore } from "../src/lib/market/store";

process.env.SEC_USER_AGENT = "Superfinancials test ops@example.com"; process.env.SEC_GAP_MS = "0";
const NOW = new Date("2026-10-30T06:25:00Z");
const calls: string[] = []; const uas = new Set<string>();
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input)); calls.push(url.hostname + url.pathname);
  uas.add(new Headers(init?.headers).get("user-agent") ?? "");
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
  if (url.pathname === "/files/company_tickers.json") return json({ "0": { cik_str: 320193, ticker: "AAPL", title: "Apple Inc." }, "1": { cik_str: 789019, ticker: "MSFT", title: "MICROSOFT CORP" }, "2": { cik_str: 19617, ticker: "JPM", title: "JPMORGAN CHASE" } });
  if (url.pathname === "/submissions/CIK0000320193.json") return json({ name: "Apple Inc.", filings: { recent: {
    accessionNumber: ["0000320193-26-000101", "0000320193-26-000100", "0000320193-26-000090", "0000320193-26-000080", "0000320193-23-000001"],
    filingDate: ["2026-10-29", "2026-10-29", "2026-08-01", "2026-07-31", "2023-01-01"],
    reportDate: ["", "2026-09-27", "", "2026-06-28", ""],
    form: ["4", "8-K", "10-Q", "8-K", "10-K"],
    items: ["", "2.02,9.01", "", "5.02", ""],
    primaryDocument: ["xslF345X05/wk-form4.xml", "aapl-20261029.htm", "aapl-20260628.htm", "aapl-8k.htm", "old.htm"],
    primaryDocDescription: ["4", "8-K", "10-Q", "8-K", "10-K"],
  } } });
  if (url.pathname === "/submissions/CIK0000789019.json") return json({ error: "boom" }, 500);
  if (url.pathname === "/Archives/edgar/data/320193/000032019326000100/index.json") return json({ directory: { item: [{ name: "aapl-20261029.htm" }, { name: "a8-kex991q4fy26.htm" }, { name: "Financial_Report.xlsx" }] } });
  return json({ error: "not mocked " + url.pathname }, 404);
}) as typeof fetch;

let fails = 0;
const t = (label: string, ok: boolean, info?: unknown) => { if (!ok) fails++; console.log((ok ? "PASS " : "FAIL ") + label, ok ? "" : JSON.stringify(info)); };

t("descriptions name the form and the 8-K items", describe("8-K", ["2.02", "9.01"], "") === "Current report: Results of operations" && describe("10-K/A", [], "") === "Annual report (amendment)" && describe("XYZ", [], "Other") === "Other");
t("press-release exhibit: 99.1 first, else any 99", pickExhibit([{ name: "ex99-2.htm" }, { name: "dex991.htm" }]) === "dex991.htm" && pickExhibit([{ name: "a.htm" }, { name: "ex-99.htm" }]) === "ex-99.htm" && pickExhibit([{ name: "a.htm" }]) === null);

const store = memoryStore();
const r = await runFilingsSync({ store, now: NOW, only: ["AAPL", "MSFT", "JPM"] });
const docs = Object.fromEntries(store.dump().filings.map((d) => [d.id, d.data as Record<string, any>])); // eslint-disable-line @typescript-eslint/no-explicit-any
const a = docs["EQ.AAPL"];
t("filings of interest only (no Form 4), last two years, newest first", a?.items.length === 3 && a.items.map((f: { form: string }) => f.form).join() === "8-K,10-Q,8-K" && a.cik === 320193 && a.name === "Apple Inc.", a?.items);
const e = a?.items[0];
t("earnings release: item 2.02, primary document and press release links", e?.earn === true && e.desc === "Current report: Results of operations" && e.url === "https://www.sec.gov/Archives/edgar/data/320193/000032019326000100/aapl-20261029.htm" && e.ex === "https://www.sec.gov/Archives/edgar/data/320193/000032019326000100/a8-kex991q4fy26.htm" && e.period === "2026-09-27", e);
t("other 8-K items named; filing index link", a?.items[2].desc === "Current report: Director or officer change" && a.items[2].index.endsWith("/000032019326000080/0000320193-26-000080-index.htm") && !a.items[2].earn, a?.items[2]);
t("a failing company is reported; the rest still load", r.failed.some((f) => f.tk === "MSFT") && r.failed.some((f) => f.tk === "JPM") && r.updated.join() === "AAPL", r);
t("meta: count, note, CIK cache", docs._meta?.n === 1 && /1 with new filings, 1 earnings press releases found/.test(docs._meta.note) && docs._meta.state.cik.AAPL === 320193, docs._meta);
t("contact User-Agent sent on every request", uas.size === 1 && uas.has("Superfinancials test ops@example.com"), [...uas]);

const n0 = calls.length;
const r2 = await runFilingsSync({ store, now: new Date("2026-10-31T06:25:00Z"), only: ["AAPL"] });
const again = calls.slice(n0);
t("re-run: CIK map and known press releases are not fetched again; unchanged docs not rewritten", !again.some((c) => c.includes("company_tickers") || c.includes("index.json")) && r2.updated.length === 0, again);

const dry = memoryStore(); await runFilingsSync({ store: dry, now: NOW, only: ["AAPL"], dryRun: true });
t("dry run writes nothing", JSON.stringify(dry.dump()) === "{}", dry.dump());
delete process.env.SEC_USER_AGENT;
let msg = ""; try { await runFilingsSync({ store: memoryStore(), now: NOW }); } catch (err) { msg = (err as Error).message; }
t("needs a contact User-Agent", /SEC_USER_AGENT/.test(msg), msg);

console.log(fails ? `\n${fails} filings-sync test(s) failed` : "\nAll filings-sync tests passed");
process.exit(fails ? 1 : 0);
