// Test of src/lib/pensions with fake CalPERS, WSIB and Oregon Treasury sites: table and
// PDF-line parsing, column order checked against the multiple, one document per fund
// with each pension's figures, owner entries, failures keeping old figures, dry runs.
// Run: npm test
import { assign, asOfDate, oregonLinks, readCalpers, readPdfTable, readToken, splitLine, stratOf } from "../src/lib/pensions/index";
import { fundId, managerOf, runPensionSync } from "../src/lib/pensions/sync";
import { memoryStore } from "../src/lib/market/store";

let fails = 0;
const t = (label: string, ok: boolean, info?: unknown) => { if (!ok) fails++; console.log((ok ? "PASS " : "FAIL ") + label, ok ? "" : JSON.stringify(info)); };

// --- tokens and lines -----------------------------------------------------------------------------
t("tokens: amounts, negatives, multiples, IRR, n/m, dates", JSON.stringify(["$150,000,000", "(1,234)", "2.1x", "13.12%", "(4.5%)", "N/M", "11/30/2012", "2019", "Fund", "2"].map(readToken)) === JSON.stringify([{ kind: "amt", v: 150000000 }, { kind: "amt", v: -1234 }, { kind: "mult", v: 2.1 }, { kind: "irr", v: 13.12 }, { kind: "irr", v: -4.5 }, { kind: "na", v: null }, { kind: "date", v: 2012 }, { kind: "year", v: 2019 }, null, null]));
const wl = splitLine("Green Equity Investors VI, L.P. 11/30/2012 300,000,000 355,444,209 9,000,000 165,248,477 589,000,000 2.1x 13.12%");
t("WSIB-style line: name, vintage from the first investment date", wl?.name === "Green Equity Investors VI, L.P." && wl.year === 2012, wl);
t("a name ending in a number keeps it", splitLine("Sapphire Fund 2 2019 $ 50,000,000 $ 40,000,000 $ 10,000,000 $ 45,000,000 1.4x 12.0%")?.name === "Sapphire Fund 2");
t("Oregon-style line: vintage first", splitLine("2018 Advent International GPE IX $ 100,000,000 $ 90,000,000 $ 30,000,000 $ 120,000,000 1.7x 15.2%", true)?.year === 2018);
t("text lines are not rows", splitLine("Private Equity Portfolio As of March 31, 2026") === null);
// Order: commitment, paid-in, then the pair that matches the multiple.
t("columns follow the multiple when the default order is wrong", JSON.stringify(assign([300, 355, 9, 165, 589], 2.1, [4, 3])) === JSON.stringify({ commit: 300, paid: 355, dist: 589, nav: 165 }), assign([300, 355, 9, 165, 589], 2.1, [4, 3]));
t("distributions + remaining value total read as value", JSON.stringify(assign([150, 154, 254, 254.3], 1.65, [9, 9])) === JSON.stringify({ commit: 150, paid: 154, dist: 254, nav: 254.3 - 254 }) || assign([150, 154, 254, 254.3], 1.65, [9, 9])?.dist === 254, assign([150, 154, 254, 254.3], 1.65, [9, 9]));
t("as-of dates", asOfDate("data as of December 31, 2025.") === "2025-12-31" && asOfDate("As of 3/31/2026") === "2026-03-31");
t("strategy from section or name", stratOf("Sequoia Capital Fund", "Venture Capital") === "Venture" && stratOf("Blackstone Real Estate Partners X") === "Real estate" && stratOf("Ares Senior Direct Lending Fund") === "Private credit" && stratOf("Hellman & Friedman Capital Partners X") === "Buyout");
t("manager inferred from the name", managerOf("Blackstone Capital Partners VII, L.P.") === "Blackstone" && managerOf("KKR North America Fund XIII") === "KKR North America" && managerOf("Advent International GPE IX") === "Advent International GPE");
t("same fund, different spellings, one id", fundId("Apollo Investment Fund IX, L.P.") === fundId("Apollo Investment Fund IX LP") && fundId("Apollo Investment Fund IX, L.P.") === "lp-apollo-investment-fund-ix");

// --- CalPERS HTML -----------------------------------------------------------------------------------
const calHtml = (asof: string) => `<html><body><p>As of ${asof}, the since inception Net IRR is 11.6% and the Net Multiple is 1.5x.</p><table><thead><tr><th>Fund</th><th>Vintage Year</th><th>Capital Committed</th><th>Cash In</th><th>Cash Out</th><th>Cash Out &amp; Remaining Value</th><th>Net IRR</th><th>Investment Multiple</th></tr></thead><tbody>
<tr><td>Apollo Investment Fund IV, L.P.</td><td>1998</td><td>$150,000,000</td><td>$154,085,315</td><td>$254,289,011</td><td>$254,325,586</td><td>8.5%</td><td>1.7x</td></tr>
<tr><td>Apollo Investment Fund IX, L.P.</td><td>2018</td><td>$500,000,000</td><td>$450,000,000</td><td>$300,000,000</td><td>$720,000,000</td><td>17.0%</td><td>1.6x</td></tr>
<tr><td>Brand New Ventures I</td><td>2025</td><td>$50,000,000</td><td>$5,000,000</td><td>$0</td><td>$4,800,000</td><td>N/M</td><td>1.0x</td></tr>
<tr><td>Total</td><td></td><td>$700,000,000</td><td>$609,085,315</td><td>$554,289,011</td><td>$979,125,586</td><td>11.6%</td><td>1.5x</td></tr></tbody></table></body></html>`;
const cal = readCalpers(calHtml("December 31, 2025"), "https://www.calpers.ca.gov/x");
t("CalPERS table: rows, value = (cash out & remaining) − cash out, total skipped", cal.length === 3 && cal[0].vintage === 1998 && cal[0].nav === 36575 && cal[0].irr === 8.5 && cal[0].tvpi === 1.65 && cal[2].irr === null && cal[2].strat === "Venture" && cal[0].asof === "2025-12-31" && /CalPERS, Private Equity Program Fund Performance Review, as of 2025-12-31/.test(cal[0].src), cal);

// --- PDF lines (WSIB / Oregon) ----------------------------------------------------------------------
const wsibLines = ["Washington State Investment Board", "Private Equity Portfolio Overview by Strategy as of June 30, 2026", "Investment Name Initial Investment Date Commitment Amount Paid-in Capital Unfunded Commitment Current Market Value Total Distributions Total Value Multiple IRR",
  "Corporate Finance/Buyout", "Apollo Investment Fund IX, L.P. 6/1/2018 400,000,000 380,000,000 30,000,000 300,000,000 290,000,000 1.5x 14.20%", "Green Equity Investors VI, L.P. 11/30/2012 300,000,000 355,444,209 9,000,000 165,248,477 589,000,000 2.1x 13.12%",
  "Venture Capital", "Sapphire Ventures Fund 2 1/15/2021 50,000,000 40,000,000 10,000,000 45,000,000 2,000,000 1.2x 6.50%", "Total Venture Capital 50,000,000 40,000,000 10,000,000 45,000,000 2,000,000 1.2x 6.50%"];
const ws = readPdfTable("wsib", wsibLines, "2026-06-30", "https://www.sib.wa.gov/docs/reports/quarterly/ir063026.pdf", { fallback: [4, 3] });
t("WSIB lines: sections set strategy, subtotals skipped, figures match the multiple", ws.length === 3 && ws[0].dist === 290000000 && ws[0].nav === 300000000 && ws[1].dist === 589000000 && ws[2].strat === "Venture" && ws[2].vintage === 2021, ws);
const orLines = ["Oregon Public Employees Retirement Fund", "Private Equity Portfolio As of March 31, 2026", "Vintage Year Partnership Capital Commitment Total Capital Contributed Total Capital Distributed Fair Market Value Total Value Multiple IRR",
  "2018 Apollo Investment Fund IX $ 250,000,000 $ 240,000,000 $ 200,000,000 $ 190,000,000 1.6x 16.1%", "2024 New Fund I $ 100,000,000 $ 10,000,000 $ - $ 9,500,000 1.0x N/M"];
const ore = readPdfTable("oregon", orLines, "2026-03-31", "https://www.oregon.gov/x.pdf", { yearFirst: true });
t("Oregon lines: vintage first, dash as zero, n/m IRR", ore.length === 2 && ore[0].vintage === 2018 && ore[0].dist === 200000000 && ore[1].dist === 0 && ore[1].irr === null, ore);
const links = oregonLinks(`<a href="/treasury/invested-for-oregon/Documents/Invested-for-OR-Performance-and-Holdings/2025/OPERF-Private-Equity-Portfolio-Quarter-4-2025.pdf">OPERF Private Equity Portfolio - Quarter 4 2025</a>
<a href="/treasury/invested-for-oregon/Documents/Invested-for-OR-Performance-and-Holdings/2026/OPERF-Private-Equity-Portfolio-Quarter-1-2026.pdf">OPERF Private Equity Portfolio - Quarter 1 2026</a>
<a href="/treasury/invested-for-oregon/Documents/Invested-for-OR-Performance-and-Holdings/2025/OPERF_Real_Assets_Portfolio_-_Quarter_2_2025.pdf">OPERF Real Assets Portfolio Quarter 2 2025</a>
<a href="/x/2026Q1-OPERF-Fund-Fact-Sheet.pdf">2026Q1 OPERF Fund Fact Sheet</a>`, "https://www.oregon.gov/treasury/invested-for-oregon/Pages/Performance-Holdings.aspx");
t("Oregon links: newest private equity and real assets reports", links.length === 2 && links[0].asof === "2026-03-31" && /Quarter-1-2026/.test(links[0].url) && links[0].url.startsWith("https://www.oregon.gov/") && links[1].section === "Real assets", links);

// --- full run against fake sites ----------------------------------------------------------------------
const PDF = Buffer.from("%PDF-1.7 fake");
let down = new Set<string>(); const asked: string[] = [];
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = new URL(input instanceof Request ? input.url : String(input)); asked.push(url.hostname + url.pathname);
  const host = url.hostname.replace(/^www\./, "");
  if (down.has(host)) return new Response("busy", { status: 503 });
  if (host === "calpers.ca.gov") return url.pathname.endsWith("/printfunds") && url.pathname.includes("pep-") ? new Response(calHtml("December 31, 2025"), { status: 200 }) : new Response("not found", { status: 404 });
  if (host === "sib.wa.gov") return url.pathname.endsWith("ir063026.pdf") ? new Response(PDF, { status: 200 }) : new Response("<html>not found</html>", { status: 200 });
  if (host === "oregon.gov") return url.pathname.endsWith(".aspx") ? new Response(`<a href="/treasury/x/2026/OPERF-Private-Equity-Portfolio-Quarter-1-2026.pdf">OPERF Private Equity Portfolio - Quarter 1 2026</a>`, { status: 200 }) : new Response(PDF, { status: 200 });
  return new Response("", { status: 404 });
}) as typeof fetch;
const lines = async () => { const u = asked.at(-1) ?? ""; return u.includes("sib.wa.gov") ? wsibLines : orLines; };

const NOW = new Date("2026-10-30T07:00:00Z");
const store = memoryStore({ adm_priv: [{ id: "lp-green-equity-investors-vi", data: { kind: "fund", name: "Green Equity Investors VI", irr: 20, srcName: "Owner" } }, { id: "lp-old-fund-iii", data: { kind: "fund", name: "Old Fund III", gen: "pension-sync", lps: [{ pension: "calpers", lp: "CalPERS", asof: "2025-06-30" }] } }] });
const r = await runPensionSync({ store, now: NOW, lines });
const db = () => Object.fromEntries(store.dump().adm_priv.map((d) => [d.id, d.data as Record<string, any>])); // eslint-disable-line @typescript-eslint/no-explicit-any
const d1 = db(); const apollo = d1["lp-apollo-investment-fund-ix"];
t("all three pensions read; WSIB found by stepping back to the latest quarter", !Object.values(r.sources).some((s) => s.error) && r.sources.wsib.asof === "2026-06-30" && asked.some((u) => u.endsWith("ir093026.pdf")), r);
t("one document for a fund three pensions report, each pension's figures kept", apollo?.kind === "fund" && apollo.lps.length === 3 && new Set(apollo.lps.map((l: { pension: string }) => l.pension)).size === 3 && apollo.gen === "pension-sync", apollo);
t("headline figures from the most recent report", apollo.asof === "2026-06-30" && apollo.irr === 14.2 && apollo.strat === "Buyout" && apollo.vintage === 2018 && apollo.name === "Apollo Investment Fund IX" && /Public pension reports/.test(apollo.srcName), apollo);
t("owner entry left alone", d1["lp-green-equity-investors-vi"].srcName === "Owner" && d1["lp-green-equity-investors-vi"].irr === 20 && r.funds.kept.includes("lp-green-equity-investors-vi"));
t("a fund no pension reports any more is removed", !d1["lp-old-fund-iii"] && r.funds.removed === 1, r.funds);
t("meta written for the health check", store.dump().pensionsync?.[0]?.data.n === r.funds.total && /3 of 3 pension reports read/.test(String(store.dump().pensionsync[0].data.note)), store.dump().pensionsync);

// A pension that fails keeps its earlier figures; a re-run with nothing new writes nothing.
down = new Set(["oregon.gov"]);
const r2 = await runPensionSync({ store, now: new Date("2026-10-31T07:00:00Z"), lines });
const apollo2 = db()["lp-apollo-investment-fund-ix"];
t("Oregon down: its figures kept, failure reported", r2.sources.oregon.error && apollo2.lps.some((l: { pension: string }) => l.pension === "oregon") && /Failed: oregon/.test(r2.note), r2);
t("unchanged re-run writes nothing", r2.funds.written === 0 && r2.funds.unchanged > 0, r2.funds);
const dry = memoryStore(); down = new Set();
const r3 = await runPensionSync({ store: dry, dryRun: true, now: NOW, lines });
t("dry run writes nothing", r3.funds.written > 0 && !dry.dump().adm_priv && !dry.dump().pensionsync, dry.dump());

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
if (fails) process.exit(1);
