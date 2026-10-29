// End-to-end test of src/lib/macro with fake World Bank, BIS, ECB, OECD, FRED
// and U.S. Treasury APIs and an in-memory docs table: parsing, country codes,
// owner documents left alone, macro-panel mapping, calendar upkeep, failures,
// re-runs and dry runs.
// Run: npm test
import { runMacroSync, GEN } from "../src/lib/macro/sync";
import { parseCsv, periodEnd } from "../src/lib/macro/sources";
import { memoryStore } from "../src/lib/market/store";

process.env.FRED_API_KEY = "test-fred"; process.env.FMP_API_KEY = "test-fmp"; process.env.EODHD_API_KEY = "test-eod";
const NOW = new Date("2026-10-29T05:20:00Z");
let oecdDown = false; let fmpPremium = false;
const IDX = `Description:           Daily Index of EDGAR Dissemination Feed by Form Type
Last Data Received:    October 27, 2026

Form Type   Company Name                                                  CIK         Date Filed  File Name
---------------------------------------------------------------------------------------------------------------------------------------------
10-Q        BIG PUBLIC CO                                                 320193      20261027    edgar/data/320193/0000320193-26-000101.txt
D           Lumen Grid Robotics, Inc.                                     1987654     20261027    edgar/data/1987654/0001987654-26-000002.txt
D           Atlas Growth Partners Fund III, L.P.                          1876543     20261027    edgar/data/1876543/0001876543-26-000001.txt
D           Tiny Seed LLC                                                 1765432     20261027    edgar/data/1765432/0001765432-26-000001.txt
D/A         Lumen Grid Robotics, Inc.                                     1987654     20261027    edgar/data/1987654/0001987654-26-000003.txt
`;
const formD = (name: string, industry: string, sold: string, extra = "") => `<?xml version="1.0"?><edgarSubmission><primaryIssuer><cik>0001987654</cik><entityName>${name}</entityName><issuerAddress><street1>1 Main St</street1><city>Austin</city><stateOrCountry>TX</stateOrCountry></issuerAddress><entityType>Corporation</entityType><yearOfInc><value>2021</value></yearOfInc></primaryIssuer><relatedPersonsList><relatedPersonInfo><relatedPersonName><firstName>Ada</firstName><lastName>Lovelace</lastName></relatedPersonName><relatedPersonRelationshipList><relationship>Executive Officer</relationship><relationship>Director</relationship></relatedPersonRelationshipList></relatedPersonInfo></relatedPersonsList><offeringData><industryGroup><industryGroupType>${industry}</industryGroupType></industryGroup><typesOfSecuritiesOffered><isEquityType>true</isEquityType></typesOfSecuritiesOffered><dateOfFirstSale><value>2026-10-15</value></dateOfFirstSale><offeringSalesAmounts><totalOfferingAmount>25000000</totalOfferingAmount><totalAmountSold>${sold}</totalAmountSold></offeringSalesAmounts>${extra}</offeringData></edgarSubmission>`;
const secUA: string[] = []; const seen: string[] = [];

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input)); seen.push(url.hostname + url.pathname + url.search);
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
  const csv = (s: string, status = 200) => new Response(s, { status, headers: { "content-type": "text/csv" } });
  if (url.hostname === "api.worldbank.org") {
    const ind = url.pathname.split("/").pop();
    if (ind === "NY.GDP.MKTP.KD.ZG") return json([{ page: 1, pages: 1, per_page: 5000, total: 4 }, [
      { indicator: { id: ind }, country: { id: "NG", value: "Nigeria" }, countryiso3code: "NGA", date: "2025", value: 3.4 },
      { indicator: { id: ind }, country: { id: "NG", value: "Nigeria" }, countryiso3code: "NGA", date: "2024", value: 3.1 },
      { indicator: { id: ind }, country: { id: "GB", value: "United Kingdom" }, countryiso3code: "GBR", date: "2025", value: 1.1 },
      { indicator: { id: ind }, country: { id: "EU", value: "European Union" }, countryiso3code: "EUU", date: "2025", value: null },
    ]]);
    if (ind === "NY.GDP.MKTP.CD") return json([{ page: 1, pages: 1 }, [{ indicator: { id: ind }, country: { id: "NG" }, date: "2025", value: 252_738_000_000 }]]);
    return json([{ page: 1, pages: 0, total: 0 }, null]);
  }
  if (url.hostname === "stats.bis.org") return csv("FREQ:Frequency,REF_AREA:Reference area,TIME_PERIOD:Time period or range,OBS_VALUE:Observation Value\nM,NG,2026-08,27.0\nM,NG,2026-09,27.0\nM,GB,2026-09,3.75\nM,XM,2026-09,2.0\nM,US,2026-09,\n");
  if (url.hostname === "data-api.ecb.europa.eu") {
    if (url.pathname.includes("/ICP/")) return csv('KEY,FREQ,REF_AREA,TIME_PERIOD,OBS_VALUE,TITLE\nICP.M.U2.N.000000.4.ANR,M,U2,2026-08,2.1,"HICP - Overall index, euro area"\nICP.M.U2.N.000000.4.ANR,M,U2,2026-09,2.2,"HICP - Overall index, euro area"\n');
    return csv("KEY,FREQ,TIME_PERIOD,OBS_VALUE\nFM.D.U2.EUR.4F.KR.DFR.LEV,D,2026-09-29,2.0\nFM.D.U2.EUR.4F.KR.DFR.LEV,D,2026-09-30,2.0\nFM.D.U2.EUR.4F.KR.DFR.LEV,D,2026-10-28,1.75\n");
  }
  if (url.hostname === "sdmx.oecd.org") return oecdDown ? csv("Service unavailable", 503) : csv("STRUCTURE,STRUCTURE_ID,ACTION,REF_AREA,FREQ,MEASURE,TIME_PERIOD,OBS_VALUE\ndataflow,X,I,USA,M,CPI,2026-08,2.9\ndataflow,X,I,USA,M,CPI,2026-09,3.0\ndataflow,X,I,GBR,M,CPI,2026-09,3.6\ndataflow,X,I,XXX,M,CPI,2026-09,9\n");
  if (url.hostname === "api.stlouisfed.org") return json({ release_dates: [
    { release_id: 10, release_name: "Consumer Price Index", date: "2026-11-12" }, { release_id: 50, release_name: "Employment Situation", date: "2026-11-06" },
    { release_id: 999, release_name: "Something minor", date: "2026-11-02" }, { release_id: 10, date: "2027-03-01" },
  ] });
  if (url.hostname === "api.fiscaldata.treasury.gov") return json({ data: [
    { security_type: "Note", security_term: "10-Year", reopening: "Yes", cusip: "91282CNX5", offering_amt: "42000000000", announcemt_date: "2026-11-05", auction_date: "2026-11-10", issue_date: "2026-11-15" },
    { security_type: "Bill", security_term: "13-Week", reopening: "No", cusip: "912797QZ1", offering_amt: "null", auction_date: "2026-11-02", issue_date: "2026-11-05" },
  ] });
  if (url.hostname === "www.sec.gov") {
    secUA.push(new Headers((input instanceof Request ? input.headers : undefined) ?? init?.headers).get("user-agent") ?? "");
    if (url.pathname === "/Archives/edgar/daily-index/2026/QTR4/form.20261027.idx") return new Response(IDX);
    if (url.pathname.includes("/daily-index/")) return new Response("<Error><Code>NoSuchKey</Code></Error>", { status: 404 });
    if (url.pathname === "/Archives/edgar/data/1987654/000198765426000002/primary_doc.xml") return new Response(formD("Lumen Grid Robotics, Inc.", "Other Technology", "12500000"));
    if (url.pathname === "/Archives/edgar/data/1876543/000187654326000001/primary_doc.xml") return new Response(formD("Atlas Growth Partners Fund III, L.P.", "Pooled Investment Fund", "90000000"));
    if (url.pathname === "/Archives/edgar/data/1765432/000176543226000001/primary_doc.xml") return new Response(formD("Tiny Seed LLC", "Business Services", "250000"));
    return new Response("not found", { status: 404 });
  }
  if (url.hostname === "financialmodelingprep.com") {
    if (fmpPremium && url.pathname !== "/stable/dividends-calendar") return json({ "Error Message": "Premium Query Parameter: special endpoint" });
    if (url.pathname === "/stable/economic-calendar") return json([
      { date: "2026-11-12 13:30:00", country: "US", event: "CPI YoY (Oct)", currency: "USD", previous: 3.0, estimate: 3.1, actual: null, impact: "High", unit: "%" },
      { date: "2026-10-28 18:00:00", country: "US", event: "Fed Interest Rate Decision", previous: 4.25, estimate: 4.0, actual: 4.0, impact: "High", unit: "%" },
      { date: "2026-11-03 09:00:00", country: "XX", event: "Unknown place", impact: "High" }, { date: "2026-11-04 10:00:00", country: "DE", event: "Minor survey", impact: "Low" },
      { date: "2026-11-05 12:00:00", country: "GB", event: "BoE Interest Rate Decision", previous: 3.75, estimate: 3.5, impact: "High" },
    ]);
    if (url.pathname === "/stable/dividends-calendar") return json([{ symbol: "AAPL", date: "2026-11-09", recordDate: "2026-11-10", paymentDate: "2026-11-13", dividend: 0.27, yield: 0.41, frequency: "Quarterly" }, { symbol: "ZZZZ", date: "2026-11-09", dividend: 1 }, { symbol: "XLE", date: "2026-12-20", dividend: 0.8 }]);
    if (url.pathname === "/stable/ipos-calendar") return json([{ symbol: "ACME", date: "2026-11-06", company: "Acme Robotics Inc.", exchange: "NASDAQ", actions: "Expected", shares: 25000000, priceRange: "18-20", marketCap: 2.1e9 }]);
  }
  if (url.hostname === "eodhd.com") {
    if (url.pathname === "/api/economic-events") return json([{ type: "Unemployment Rate", period: "Oct", country: "US", date: "2026-11-06 13:30:00", previous: 4.3, estimate: 4.3, actual: null }, { type: "No consensus", country: "US", date: "2026-11-06 13:30:00", estimate: null }]);
    if (url.pathname === "/api/calendar/ipos") return json({ ipos: [{ code: "BETA.US", name: "Beta Health", exchange: "NYSE", start_date: "2026-11-07", price_from: 10, price_to: 12, shares: 5000000, deal_type: "Expected" }] });
  }
  return json({ error: "unexpected host " + url.hostname }, 500);
}) as typeof fetch;

let fails = 0;
const t = (label: string, ok: boolean, info?: unknown) => { if (!ok) fails++; console.log((ok ? "PASS " : "FAIL ") + label, ok ? "" : JSON.stringify(info)); };

t("CSV: quoted fields, doubled quotes, labelled headers", JSON.stringify(parseCsv('A:Label,B\n"x, ""y""",2\r\n')) === JSON.stringify([{ A: 'x, "y"', B: "2" }]));
t("period ends", periodEnd("2026-09") === "2026-09-30" && periodEnd("2026-Q1") === "2026-03-31" && periodEnd("2025") === "2025-12-31" && periodEnd("2026-M02") === "2026-02-28" && periodEnd("x") === null);

const store = memoryStore({
  // The owner's own Nigeria policy-rate series (data studio) and a hand-made event: both must survive.
  adm_series: [{ id: "NG.POL", data: { kind: "eco", cc: "NG", code: "POL", mi: "POL", d: ["2026-09-30"], v: [27], src: "Desk" } }, { id: "NG.GDPA", data: { kind: "eco", cc: "NG", code: "GDPA", d: ["2025-12-31"], v: [3.3], src: "Desk" } }],
  adm_cal: [{ id: "desk-1", data: { title: "CBN MPC", date: "2026-11-24", cc: "NG" } }, { id: "auto-ust-2026-11-03-OLD", data: { title: "Moved auction", date: "2026-11-03", gen: GEN } }, { id: "auto-fred-10-2026-01-01", data: { title: "Old CPI", date: "2026-01-01", gen: GEN } }],
});
const dry = await runMacroSync({ store, now: NOW, dryRun: true });
t("dry run writes nothing", (await store.list("macrosync")).length === 0 && (await store.list("adm_series")).length === 2, dry);

const r = await runMacroSync({ store, now: NOW });
const S = new Map((await store.list("adm_series")).map((d) => [d.id, d.data]));
t("every source answered", Object.values(r.sources).every((s) => !s.error && !s.skipped), r.sources);
t("World Bank: annual series per country, dated year-end, sorted", JSON.stringify(S.get("UK.GDPA")?.d) === '["2025-12-31"]' && S.get("UK.GDPA")?.freq === "A" && S.get("UK.GDPA")?.gen === GEN, S.get("UK.GDPA"));
t("World Bank: US$ values scaled to billions", JSON.stringify(S.get("NG.GDPUSD")?.v) === "[252.7]", S.get("NG.GDPUSD"));
t("World Bank: null values skipped (no empty EU series)", !S.has("EU.GDPA"));
t("owner series with the same id is left alone", S.get("NG.GDPA")?.src === "Desk" && r.series.kept.includes("NG.GDPA"), S.get("NG.GDPA"));
t("BIS: policy rates, GB→UK, XM→EU, blanks skipped", JSON.stringify(S.get("NG.POLR")?.v) === "[27,27]" && (S.get("UK.POLR")?.d as string[] | undefined)?.[0] === "2026-09-30" && S.has("EU.POLR") && !S.has("US.POLR"), [...S.keys()]);
t("BIS: feeds the macro panel only where the owner hasn't", S.get("UK.POLR")?.mi === "POL" && S.get("NG.POLR")?.mi === "", [S.get("UK.POLR")?.mi, S.get("NG.POLR")?.mi]);
t("ECB: HICP monthly, feeds euro-area CPI", JSON.stringify(S.get("EU.HICP")?.d) === '["2026-08-31","2026-09-30"]' && S.get("EU.HICP")?.mi === "CPI", S.get("EU.HICP"));
t("ECB: deposit rate, daily → month-end", JSON.stringify(S.get("EU.DFR")?.v) === "[2,1.75]" && JSON.stringify(S.get("EU.DFR")?.d) === '["2026-09-30","2026-10-31"]', S.get("EU.DFR"));
t("OECD: monthly CPI by ISO3, unknown areas ignored", JSON.stringify(S.get("US.CPIM")?.v) === "[2.9,3]" && S.has("UK.CPIM") && ![...S.keys()].some((k) => k.startsWith("XXX")), [...S.keys()]);
const C = new Map((await store.list("adm_cal")).map((d) => [d.id, d.data]));
t("FRED: major releases in the next 45 days only", C.has("auto-fred-10-2026-11-12") && C.has("auto-fred-50-2026-11-06") && !C.has("auto-fred-999-2026-11-02") && !C.has("auto-fred-10-2027-03-01"), [...C.keys()]);
t("FRED event fields", C.get("auto-fred-10-2026-11-12")?.title === "U.S. CPI" && C.get("auto-fred-10-2026-11-12")?.imp === 3 && C.get("auto-fred-10-2026-11-12")?.cat === "eco", C.get("auto-fred-10-2026-11-12"));
const ten = C.get("auto-ust-2026-11-10-91282CNX5");
t("Treasury auctions: title, amount, category", ten?.title === "U.S. Treasury 10-Year Note auction (reopening)" && /US\$42\.0 bn/.test(String(ten?.notes)) && ten?.cat === "auc" && ten?.imp === 2, ten);
t("calendar: owner events kept; stale and rescheduled auto events removed", C.has("desk-1") && !C.has("auto-ust-2026-11-03-OLD") && !C.has("auto-fred-10-2026-01-01") && r.events.removed === 2, [...C.keys()]);
const meta = (await store.list("macrosync"))[0]?.data;
t("run summary for the health check", meta?.n === r.series.written + r.series.unchanged + r.events.written + r.companies.total && /10 of 10 sources/.test(String(meta?.note)), meta);

const cpi = C.get("auto-eco-2026-11-12-us-cpi-yoy-oct");
t("economic calendar: consensus, prior, time; low-importance and unknown countries dropped", cpi?.cons === "3.1" && cpi?.prior === "3" && cpi?.actual === "" && cpi?.time === "13:30" && cpi?.imp === 3 && ![...C.keys()].some((k) => /minor-survey|unknown-place/.test(k)), cpi);
t("economic calendar: actuals and GB→UK", C.get("auto-eco-2026-10-28-us-fed-interest-rate-decision")?.actual === "4" && C.has("auto-eco-2026-11-05-uk-boe-interest-rate-decision"), [...C.keys()]);
const div = C.get("auto-div-2026-11-09-aapl");
t("dividends: tracked names only, linked to the instrument", div?.title === "AAPL ex-dividend ($0.27)" && JSON.stringify(div?.ids) === '["EQ.AAPL"]' && /payment 2026-11-13/.test(String(div?.notes)) && C.has("auto-div-2026-12-20-xle") && ![...C.keys()].some((k) => k.includes("zzzz")), div);
const ipo = C.get("auto-ipo-2026-11-06-acme");
t("IPOs: title, importance by size", ipo?.title === "Acme Robotics Inc. (ACME) IPO on NASDAQ" && ipo?.imp === 2 && ipo?.cat === "ipo", ipo);
const P = new Map((await store.list("adm_priv")).map((d) => [d.id, d.data]));
const lg = P.get("secd-1987654") as Record<string, unknown> & { rounds: { date: string; amt: number; acc: string }[] } | undefined;
t("Form D: new filings only (not D/A), funds and small raises skipped", P.size === 1 && !!lg, [...P.keys()]);
t("Form D: company fields and sector mapping", lg?.name === "Lumen Grid Robotics, Inc." && lg?.sector === "Technology" && lg?.cc === "US" && lg?.city === "Austin" && lg?.founded === 2021 && lg?.rounds[0].amt === 12500000 && lg?.rounds[0].date === "2026-10-15", lg);
t("Form D: related persons and filing link in the description", /Ada Lovelace \(Executive Officer, Director\)/.test(String(lg?.desc)) && /edgar\/data\/1987654\/000198765426000002/.test(String(lg?.desc)), lg?.desc);
t("SEC requests carry a descriptive User-Agent", secUA.length > 0 && secUA.every((u) => /Superfinancials/.test(u)), secUA.slice(0, 2));
const fdState = ((await store.list("macrosync"))[0]?.data.state as { formd?: { done?: string[] } })?.formd;
t("Form D: processed days remembered (weekend skipped, today's index not final)", !!fdState?.done?.includes("2026-10-27") && !!fdState?.done?.includes("2026-10-25"), fdState);
const before = S.get("UK.GDPA")?.upd;
oecdDown = true;
const r2 = await runMacroSync({ store, now: new Date("2026-10-30T05:20:00Z") });
const S2 = new Map((await store.list("adm_series")).map((d) => [d.id, d.data]));
t("re-run: unchanged series are not rewritten, filings not refetched", r2.companies.written === 0 && r2.series.written === 0 && S2.get("UK.GDPA")?.upd === before, r2.series);
t("a failing source is reported; its old data stays", !!r2.sources.oecd.error && S2.has("US.CPIM") && /Failed: oecd/.test(r2.note), r2);

fmpPremium = true;
const fb = await runMacroSync({ store: memoryStore(), now: NOW, only: ["econ-calendar", "ipos", "dividends"] });
t("FMP plan error → EODHD answers the economic and IPO calendars", fb.sources["econ-calendar"].events === 1 && fb.sources.ipos.events === 1 && fb.sources.dividends.events === 2, fb.sources);
fmpPremium = false;
const only = await runMacroSync({ store: memoryStore(), now: NOW, only: ["bis"] });
t("--only limits the sources", Object.keys(only.sources).join() === "bis", only.sources);
delete process.env.FRED_API_KEY;
const nokey = await runMacroSync({ store: memoryStore(), now: NOW, only: ["fred-calendar"] });
t("FRED calendar skipped without a key", /FRED_API_KEY/.test(nokey.sources["fred-calendar"].skipped ?? ""), nokey.sources);

console.log(fails ? `\n${fails} macro-sync test(s) failed` : "\nAll macro-sync tests passed");
process.exit(fails ? 1 : 0);
