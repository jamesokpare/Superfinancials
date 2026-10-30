// End-to-end test of src/lib/macro with fake World Bank, BIS, ECB, OECD, FRED
// and U.S. Treasury APIs and an in-memory docs table: parsing, country codes,
// owner documents left alone, macro-panel mapping, calendar upkeep, failures,
// re-runs and dry runs.
// Run: npm test
import { runMacroSync, GEN } from "../src/lib/macro/sync";
import { fredSeriesList, parseCsv, parsePinkSheet, periodEnd, parseIcs, recessionSpans } from "../src/lib/macro/sources";
import { readXlsx, writeXlsx } from "../src/lib/macro/xlsx";
import { memoryStore } from "../src/lib/market/store";

process.env.FRED_API_KEY = "test-fred"; process.env.FMP_API_KEY = "test-fmp"; process.env.EODHD_API_KEY = "test-eod"; process.env.EIA_API_KEY = "test-eia"; process.env.MACRO_RETRY_MS = "5"; process.env.MACRO_GAP_MS = "0";
process.env.SEC_USER_AGENT = "Superfinancials test ops@example.com";
const NOW = new Date("2026-10-29T05:20:00Z");
let oecdDown = false; let fmpPremium = false; let fmpDivDown = false; let oecdFlaky = 1; const oecdCalls: string[] = [];
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
const FUNDINFO = "<investmentFundInfo><investmentFundType>Venture Capital Fund</investmentFundType><is40Act>false</is40Act></investmentFundInfo>";
const formD = (name: string, industry: string, sold: string, extra = "") => `<?xml version="1.0"?><edgarSubmission><primaryIssuer><cik>0001987654</cik><entityName>${name}</entityName><issuerAddress><street1>1 Main St</street1><city>Austin</city><stateOrCountry>TX</stateOrCountry></issuerAddress><entityType>Corporation</entityType><yearOfInc><value>2021</value></yearOfInc></primaryIssuer><relatedPersonsList><relatedPersonInfo><relatedPersonName><firstName>Ada</firstName><lastName>Lovelace</lastName></relatedPersonName><relatedPersonRelationshipList><relationship>Executive Officer</relationship><relationship>Director</relationship></relatedPersonRelationshipList></relatedPersonInfo></relatedPersonsList><offeringData><industryGroup><industryGroupType>${industry}</industryGroupType>${industry === "Pooled Investment Fund" ? FUNDINFO : ""}</industryGroup><typesOfSecuritiesOffered><isEquityType>true</isEquityType></typesOfSecuritiesOffered><dateOfFirstSale><value>2026-10-15</value></dateOfFirstSale><offeringSalesAmounts><totalOfferingAmount>25000000</totalOfferingAmount><totalAmountSold>${sold}</totalAmountSold></offeringSalesAmounts><investors><hasNonAccreditedInvestors>false</hasNonAccreditedInvestors><totalNumberAlreadyInvested>42</totalNumberAlreadyInvested></investors><minimumInvestmentAccepted>250000</minimumInvestmentAccepted>${extra}</offeringData></edgarSubmission>`;
const secUA: string[] = []; const seen: string[] = []; const blsUA: string[] = []; let pinkPage = true; let sec403 = false;
// The World Bank Pink Sheet workbook: title rows, names, units, codes, then YYYYMmm rows ("…" = no value).
const PINK_XLSX = writeXlsx({ "Index": [["Contents"]], "Monthly Prices": [
  ["World Bank Commodity Price Data (The Pink Sheet)"], ["monthly prices in nominal US dollars"], ["Updated on October 02, 2026"], [],
  ["", "Crude oil, average", "Crude oil, Brent", "Natural gas, Europe", "Aluminum", "Nickel", "Zinc"], ["", "($/bbl)", "($/bbl)", "($/mmbtu)", "($/mt)", "($/mt)", "($/mt)"],
  ["", "CRUDE_PETRO", "CRUDE_BRENT", "NGAS_EUR", "ALUMINUM", "NICKEL", "Zinc"],
  ["2019M01", 56.6, 59.4, 7.6, 1854, 11500, 2700], ["2026M08", 66.1, 68.2, 10.8, 2580.25, 15050, "…"], ["2026M09", 65.0, 67.1, 11.0, 2612.5, 15100, 2990],
] });

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input)); seen.push(url.hostname + url.pathname + url.search);
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
  const csv = (s: string, status = 200) => new Response(s, { status, headers: { "content-type": "text/csv" } });
  if (url.hostname === "api.worldbank.org") {
    const ind = url.pathname.split("/").pop();
    if (url.searchParams.get("source") === "21") return json([{ message: [{ id: "120", key: "Invalid value" }] }]);
    if (ind === "NY.GDP.MKTP.KD.ZG") return json([{ page: 1, pages: 1, per_page: 5000, total: 4 }, [
      { indicator: { id: ind }, country: { id: "NG", value: "Nigeria" }, countryiso3code: "NGA", date: "2025", value: 3.4 },
      { indicator: { id: ind }, country: { id: "NG", value: "Nigeria" }, countryiso3code: "NGA", date: "2024", value: 3.1 },
      { indicator: { id: ind }, country: { id: "GB", value: "United Kingdom" }, countryiso3code: "GBR", date: "2025", value: 1.1 },
      { indicator: { id: ind }, country: { id: "EU", value: "European Union" }, countryiso3code: "EUU", date: "2025", value: null },
    ]]);
    if (ind === "NY.GDP.MKTP.CD") return json([{ page: 1, pages: 1 }, [{ indicator: { id: ind }, country: { id: "NG" }, date: "2025", value: 252_738_000_000 }]]);
    return json([{ page: 1, pages: 0, total: 0 }, null]);
  }
  if (url.hostname === "www.worldbank.org") return pinkPage ? new Response('<a href="https://thedocs.worldbank.org/en/doc/abc123-0050012027/related/CMO-Historical-Data-Monthly.xlsx">Monthly prices</a>') : new Response("busy", { status: 503 });
  if (url.hostname === "thedocs.worldbank.org") return url.pathname.endsWith(".xlsx") && (url.pathname.includes(pinkPage ? "abc123-0050012027" : "-0050012026/")) ? new Response(new Uint8Array(PINK_XLSX)) : new Response("not found", { status: 404 });
  if (url.hostname === "stats.bis.org" && url.pathname.includes("WS_LONG_CPI")) return csv("FREQ,REF_AREA,UNIT_MEASURE,TIME_PERIOD,OBS_VALUE\nM,NG,771,2026-08,20.1\nM,NG,771,2026-09,19.4\nM,US,771,2026-09,3.1\n");
  if (url.hostname === "stats.bis.org") return csv("FREQ:Frequency,REF_AREA:Reference area,TIME_PERIOD:Time period or range,OBS_VALUE:Observation Value\nM,NG,2026-08,27.0\nM,NG,2026-09,27.0\nM,GB,2026-09,3.75\nM,XM,2026-09,2.0\nM,US,2026-09,\n");
  if (url.hostname === "data-api.ecb.europa.eu") {
    if (url.pathname.includes("/EST/")) return csv("KEY,FREQ,TIME_PERIOD,OBS_VALUE\nEST.B.EU000A2X2A25.WT,B,2026-10-27,1.66\nEST.B.EU000A2X2A25.WT,B,2026-10-28,1.65\n");
    if (url.pathname.includes("/EXR/")) return csv("KEY,FREQ,TIME_PERIOD,OBS_VALUE\nEXR.M.USD.EUR.SP00.A,M,2026-09,1.1\n");
    if (url.pathname.includes("/ICP/")) return csv('KEY,FREQ,REF_AREA,TIME_PERIOD,OBS_VALUE,TITLE\nICP.M.U2.N.000000.4.ANR,M,U2,2026-08,2.1,"HICP - Overall index, euro area"\nICP.M.U2.N.000000.4.ANR,M,U2,2026-09,2.2,"HICP - Overall index, euro area"\n');
    return csv("KEY,FREQ,TIME_PERIOD,OBS_VALUE\nFM.D.U2.EUR.4F.KR.DFR.LEV,D,2026-09-29,2.0\nFM.D.U2.EUR.4F.KR.DFR.LEV,D,2026-09-30,2.0\nFM.D.U2.EUR.4F.KR.DFR.LEV,D,2026-10-28,1.75\n");
  }
  if (url.hostname === "sdmx.oecd.org") oecdCalls.push(url.pathname + "|" + new Headers(init?.headers).get("user-agent"));
  if (url.hostname === "sdmx.oecd.org" && oecdFlaky > 0) { oecdFlaky--; return csv("Internal server error", 500); }
  if (url.hostname === "sdmx.oecd.org") {
    if (oecdDown) return csv("Service unavailable", 503);
    const areas = url.pathname.split("/").pop()!.split(".")[0].split("+"); const c2018 = url.pathname.includes("COICOP2018");
    // COICOP-1999 EU series stop at 2025-12; the COICOP-2018 flow carries them on (and revises the overlap).
    const rows = c2018 ? [["DEU", "2025-12", "2.0"], ["DEU", "2026-09", "2.3"]] : [["USA", "2026-08", "2.9"], ["USA", "2026-09", "3.0"], ["GBR", "2026-09", "3.6"], ["DEU", "2025-12", "1.9"], ["XXX", "2026-09", "9"]];
    return csv("STRUCTURE,STRUCTURE_ID,ACTION,REF_AREA,FREQ,MEASURE,TIME_PERIOD,OBS_VALUE\n" + rows.filter(([a]) => areas.includes(a) || a === "XXX").map(([a, t, v]) => `dataflow,X,I,${a},M,CPI,${t},${v}`).join("\n") + "\n");
  }
  if (url.hostname === "api.stlouisfed.org" && url.pathname.endsWith("/fred/series")) return json({ seriess: [{ id: url.searchParams.get("series_id"), notes: url.searchParams.get("series_id") === "BAMLEMCBPIOAS" ? "Copyright, 2026, ICE Data Indices. Reproduction of this data is prohibited except with prior written permission." : "Source: Board of Governors." }] });
  if (url.hostname === "api.stlouisfed.org" && url.pathname.endsWith("/series/observations")) return json({ observations: [
    { date: "2007-11-01", value: "0" }, { date: "2007-12-01", value: "1" }, { date: "2008-01-01", value: "1" }, { date: "2009-06-01", value: "1" }, { date: "2009-07-01", value: "0" },
    { date: "2020-02-01", value: "0" }, { date: "2020-03-01", value: "1" }, { date: "2020-04-01", value: "1" }, { date: "2020-05-01", value: "0" }, { date: "2026-09-01", value: "." },
  ] });
  if (url.hostname === "www.imf.org" && url.pathname.startsWith("/external/datamapper/api/v1/")) {
    const id = url.pathname.split("/").pop()!;
    if (id === "LUR") return json({ error: "boom" }, 500);
    return json({ values: { [id]: { USA: { "2024": 2.8, "2025": 1.9, "2026": 2.0, "2027": "2.1", "2031": 2.0, "2032": 9 }, NGA: { "2026": 3.4, "2027": null }, XYZ: { "2026": 1 } } }, api: { version: "1" } });
  }
  if (url.hostname === "api.stlouisfed.org") return json({ release_dates: [
    { release_id: 10, release_name: "Consumer Price Index", date: "2026-11-12" }, { release_id: 50, release_name: "Employment Situation", date: "2026-11-06" },
    { release_id: 999, release_name: "Something minor", date: "2026-11-02" }, { release_id: 10, date: "2027-03-01" },
  ] });
  if (url.hostname === "api.fiscaldata.treasury.gov") return json({ data: [
    { security_type: "Note", security_term: "10-Year", reopening: "Yes", cusip: "91282CNX5", offering_amt: "42000000000", announcemt_date: "2026-11-05", auction_date: "2026-11-10", issue_date: "2026-11-15" },
    { security_type: "Bill", security_term: "13-Week", reopening: "No", cusip: "912797QZ1", offering_amt: "null", auction_date: "2026-11-02", issue_date: "2026-11-05" },
  ] });
  if (url.hostname === "ec.europa.eu") return url.pathname === "/eurostat/o/calendars/eventsIcal" ? new Response("BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:e1\r\nDTSTART:20261117T100000Z\r\nSUMMARY:HICP - Final data\\, October 2026\r\nX-CATEGORY:Data release\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:e2\r\nDTSTART;VALUE=DATE:20270301\r\nSUMMARY:GDP too far ahead\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:e3\r\nDTSTART;VALUE=DATE:20261105\r\nSUMMARY:Wine production statistics\r\nX-CATEGORY:Data release\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:e4\r\nDTSTART;VALUE=DATE:20261106\r\nSUMMARY:Unemployment webinar\r\nX-CATEGORY:Event\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n") : new Response("Not found", { status: 404 });
  if (url.hostname === "www.bls.gov") blsUA.push(new Headers(init?.headers).get("user-agent") ?? "");
  if (url.hostname === "www.bls.gov") return !/@/.test(blsUA.at(-1)!) ? new Response("Access Denied", { status: 403 }) : new Response("BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART:20261106T133000Z\nSUMMARY:The Employment Situation for Octo\n ber 2026\nEND:VEVENT\nEND:VCALENDAR\n");
  if (url.hostname === "home.treasury.gov") {
    if (url.pathname.endsWith("/2025/all")) return csv('Date,"1 Mo","3 Mo","1 Yr","2 Yr","5 Yr","10 Yr","30 Yr"\n12/31/2025,4.1,4.05,3.9,3.7,3.8,4.2,4.7\n');
    return csv('Date,"1 Mo","1.5 Month","3 Mo","1 Yr","2 Yr","5 Yr","10 Yr","30 Yr"\n10/28/2026,4.00,3.98,3.95,3.70,3.50,3.60,4.10,4.60\n10/27/2026,4.01,3.99,3.96,3.71,3.52,3.61,4.12,N/A\n');
  }
  if (url.hostname === "markets.newyorkfed.org") return json({ refRates: url.pathname.includes("/sofr/") ? [{ effectiveDate: "2026-10-28", type: "SOFR", percentRate: 3.92 }, { effectiveDate: "2026-10-27", type: "SOFR", percentRate: 3.95 }] : [{ effectiveDate: "2026-10-28", type: "EFFR", percentRate: 3.88 }] });
  if (url.hostname === "www.bankofengland.co.uk") return /Mozilla/.test(new Headers(init?.headers).get("user-agent") ?? "") ? csv("DATE,IUDSOIA,IUDSNPY,IUDMNPY\n27 Oct 2026,3.97,3.90,4.40\n28 Oct 2026,3.96,,4.42\n") : new Response("<html>error</html>");
  if (url.hostname === "www.bankofcanada.ca") return url.pathname.includes("/group/") ? json({ observations: [{ d: "2026-10-28", "BD.CDN.2YR.DQ.YLD": { v: "2.45" }, "BD.CDN.5YR.DQ.YLD": { v: "2.70" }, "BD.CDN.10YR.DQ.YLD": { v: "3.10" }, "BD.CDN.LONG.DQ.YLD": { v: "3.40" } }] }) : json({ observations: [{ d: "2026-10-28", "AVG.INTWO": { v: "2.2500" } }] });
  if (url.hostname === "publicreporting.cftc.gov") return /067651/.test(url.searchParams.get("$where") ?? "") ? json([{ report_date_as_yyyy_mm_dd: "2026-10-20T00:00:00.000", cftc_contract_market_code: "067651", noncomm_positions_long_all: "320000", noncomm_positions_short_all: "110000" }, { report_date_as_yyyy_mm_dd: "2026-10-20T00:00:00.000", cftc_contract_market_code: "999999", noncomm_positions_long_all: "1", noncomm_positions_short_all: "0" }]) : json([]);
  if (url.hostname === "www.smard.de") {
    if (url.pathname.endsWith("/index_day.json")) return json({ timestamps: [1790000000000, 1792000000000] });
    if (url.pathname.endsWith("_day_1792000000000.json")) return json({ series: [[1793055600000, 95.2], [1793142000000, 101.75], [1793228400000, null]] }); // 27, 28, 29 Oct 2026 00:00 Berlin
    return json({ series: [] });
  }
  if (url.hostname === "api.eia.gov") {
    if (url.pathname.endsWith("PET.WCSSTUS1.W")) return json({ error: "boom" }, 500);
    if (url.pathname.endsWith("ELEC.GEN.ALL-US-99.M")) return json({ response: { data: [{ period: "2026-08", value: 421337.5 }, { period: "2026-07", value: "" }] } });
    if (url.pathname.endsWith("NG.RNGWHHD.D")) return json({ response: { data: [{ period: "2026-10-28", value: "3.12" }] } });
    return json({ response: { data: url.pathname.endsWith("PET.WCESTUS1.W") ? [{ period: "2026-10-23", value: 420500 }, { period: "2026-10-16", value: 421800 }] : [] } });
  }
  if (url.hostname === "www.sec.gov") {
    secUA.push(new Headers((input instanceof Request ? input.headers : undefined) ?? init?.headers).get("user-agent") ?? "");
    if (sec403) return new Response("Your Request Originates from an Undeclared Automated Tool", { status: 403 });
    if (url.pathname === "/Archives/edgar/daily-index/2026/QTR4/form.20261027.idx") return new Response(IDX);
    if (url.pathname.includes("/daily-index/")) return new Response("<Error><Code>NoSuchKey</Code></Error>", { status: 404 });
    if (url.pathname === "/Archives/edgar/data/1987654/000198765426000002/primary_doc.xml") return new Response(formD("Lumen Grid Robotics, Inc.", "Other Technology", "12500000"));
    if (url.pathname === "/Archives/edgar/data/1876543/000187654326000001/primary_doc.xml") return new Response(formD("Atlas Growth Partners Fund III, L.P.", "Pooled Investment Fund", "90000000"));
    if (url.pathname === "/Archives/edgar/data/1765432/000176543226000001/primary_doc.xml") return new Response(formD("Tiny Seed LLC", "Business Services", "250000"));
    return new Response("not found", { status: 404 });
  }
  if (url.hostname === "financialmodelingprep.com") {
    if (fmpDivDown && url.pathname === "/stable/dividends-calendar") return json({ "Error Message": "Premium Query Parameter: special endpoint" });
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
    if (url.pathname.startsWith("/api/eod/")) { const sym = url.pathname.split("/").pop(); return sym === "GSG.US" ? json({ error: "boom" }, 500) : json([{ date: "2026-10-27", close: 21.5, adjusted_close: 21.4 }, { date: "2026-10-28", close: 21.9 }, { date: "2026-10-29", close: "NA" }]); }
    if (url.pathname === "/api/calendar/splits") return json({ type: "Splits", from: "x", to: "y", splits: [{ code: "NVDA.US", split: "4.000000/1.000000", date: "2026-11-20", optionable: "Y" }, { code: "TSLA.US", split: "1.000000/5.000000", date: "2026-11-21" }, { code: "ZZZZ.US", split: "2/1", date: "2026-11-20" }, { code: "VOD.LSE", split: "2/1", date: "2026-11-20" }] });
    if (url.pathname === "/api/calendar/dividends") return json({ data: [{ code: "MSFT.US", date: "2026-11-19", recordDate: "2026-11-20", paymentDate: "2026-12-11", value: 0.91, period: "Quarterly" }, { code: "ZZZZ.US", date: "2026-11-19", value: 1 }, { code: "SHEL.LSE", date: "2026-11-19", value: 1 }], meta: { total: 3, limit: 1000, offset: 0 } });
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
  adm_inst: [{ id: "CM.NI", data: { id: "CM.NI", kind: "inst", d: ["2026-09-30"], c: [15000], src: "Desk" } }, { id: "AD.NG.MTNN", data: { id: "AD.NG.MTNN", kind: "inst", d: ["2026-10-28"], c: [455] } }],
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
t("OECD: EU members continued from the COICOP-2018 flow, which wins month by month", JSON.stringify(S.get("DE.CPIM")?.d) === '["2025-12-31","2026-09-30"]' && JSON.stringify(S.get("DE.CPIM")?.v) === "[2,2.3]" && /COICOP 2018/.test(String(S.get("DE.CPIM")?.notes)) && !/COICOP 2018/.test(String(S.get("US.CPIM")?.notes)), S.get("DE.CPIM"));
const C = new Map((await store.list("adm_cal")).map((d) => [d.id, d.data]));
t("FRED: major releases in the next 45 days only", C.has("auto-fred-10-2026-11-12") && C.has("auto-fred-50-2026-11-06") && !C.has("auto-fred-999-2026-11-02") && !C.has("auto-fred-10-2027-03-01"), [...C.keys()]);
t("FRED event fields", C.get("auto-fred-10-2026-11-12")?.title === "U.S. CPI" && C.get("auto-fred-10-2026-11-12")?.imp === 3 && C.get("auto-fred-10-2026-11-12")?.cat === "eco", C.get("auto-fred-10-2026-11-12"));
const ten = C.get("auto-ust-2026-11-10-91282CNX5");
t("Treasury auctions: title, amount, category", ten?.title === "U.S. Treasury 10-Year Note auction (reopening)" && /US\$42\.0 bn/.test(String(ten?.notes)) && ten?.cat === "auc" && ten?.imp === 2, ten);
t("calendar: owner events kept; stale and rescheduled auto events removed", C.has("desk-1") && !C.has("auto-ust-2026-11-03-OLD") && !C.has("auto-fred-10-2026-01-01") && r.events.removed === 2, [...C.keys()]);
const meta = (await store.list("macrosync"))[0]?.data;
t("run summary for the health check", meta?.n === r.series.written + r.series.unchanged + r.events.written + r.companies.total + r.funds.total && /27 of 27 sources/.test(String(meta?.note)), meta);

const cpi = C.get("auto-eco-2026-11-12-us-cpi-yoy-oct");
t("economic calendar: consensus, prior, time; low-importance and unknown countries dropped", cpi?.cons === "3.1" && cpi?.prior === "3" && cpi?.actual === "" && cpi?.time === "13:30" && cpi?.imp === 3 && ![...C.keys()].some((k) => /minor-survey|unknown-place/.test(k)), cpi);
t("economic calendar: actuals and GB→UK", C.get("auto-eco-2026-10-28-us-fed-interest-rate-decision")?.actual === "4" && C.has("auto-eco-2026-11-05-uk-boe-interest-rate-decision"), [...C.keys()]);
const div = C.get("auto-div-2026-11-09-aapl");
t("dividends: tracked names only, linked to the instrument", div?.title === "AAPL ex-dividend ($0.27)" && JSON.stringify(div?.ids) === '["EQ.AAPL"]' && /payment 2026-11-13/.test(String(div?.notes)) && C.has("auto-div-2026-12-20-xle") && ![...C.keys()].some((k) => k.includes("zzzz")), div);
const ipo = C.get("auto-ipo-2026-11-06-acme");
t("IPOs: title, importance by size", ipo?.title === "Acme Robotics Inc. (ACME) IPO on NASDAQ" && ipo?.imp === 2 && ipo?.cat === "ipo", ipo);
const P = new Map((await store.list("adm_priv")).map((d) => [d.id, d.data]));
const lg = P.get("secd-1987654") as Record<string, unknown> & { rounds: { date: string; amt: number; acc: string }[] } | undefined;
t("Form D: new filings only (not D/A), small raises skipped; the pooled fund is listed as raising, not as a company", P.size === 2 && !!lg && P.get("secf-1876543")?.kind === "raise", [...P.keys()]);
const fd = P.get("secf-1876543");
t("Form D fund: type, amounts, investors, minimum, filing link", fd?.fundType === "Venture Capital Fund" && fd?.sold === 90000000 && fd?.offered === 25000000 && fd?.investors === 42 && fd?.minInvest === 250000 && /edgar\/data\/1876543\//.test(String(fd?.url)) && r.funds.written === 1, fd);
t("Form D: company fields and sector mapping", lg?.name === "Lumen Grid Robotics, Inc." && lg?.sector === "Technology" && lg?.cc === "US" && lg?.city === "Austin" && lg?.founded === 2021 && lg?.rounds[0].amt === 12500000 && lg?.rounds[0].date === "2026-10-15", lg);
t("Form D: related persons and filing link in the description", /Ada Lovelace \(Executive Officer, Director\)/.test(String(lg?.desc)) && /edgar\/data\/1987654\/000198765426000002/.test(String(lg?.desc)), lg?.desc);
t("SEC requests carry the contact User-Agent", secUA.length > 0 && secUA.every((u) => u === "Superfinancials test ops@example.com"), secUA.slice(0, 2));
const fdState = ((await store.list("macrosync"))[0]?.data.state as { formd?: { done?: string[] } })?.formd;
t("Form D: processed days remembered (weekend skipped, today's index not final)", !!fdState?.done?.includes("2026-10-27") && !!fdState?.done?.includes("2026-10-25"), fdState);
const I = new Map((await store.list("adm_inst")).map((d) => [d.id, d.data]));
t("World Bank commodity prices: workbook found on the landing page, last 5 years, month-end dates", JSON.stringify(I.get("CM.ALI")?.d) === '["2026-08-31","2026-09-30"]' && JSON.stringify(I.get("CM.ALI")?.c) === "[2580.25,2612.5]" && I.get("CM.ALI")?.gen === GEN && seen.some((x) => x.includes("abc123-0050012027")), I.get("CM.ALI"));
t("Pink Sheet: mixed-case codes and '…' blanks", JSON.stringify(I.get("CM.ZNC")?.c) === "[2990]" && !seen.some((x) => x.includes("source=21")), I.get("CM.ZNC"));
t("European gas converted from US$/mmBtu to EUR/MWh at the ECB rate", JSON.stringify(I.get("CM.TTF")?.c) === "[34.12]", I.get("CM.TTF"));
t("an instrument price series entered by the owner is left alone; NGX listings untouched", I.get("CM.NI")?.src === "Desk" && r.instruments.kept.includes("CM.NI") && JSON.stringify(I.get("AD.NG.MTNN")?.c) === "[455]", I.get("CM.NI"));
t("SMARD German power: daily, Berlin midnight → calendar day, blanks skipped", JSON.stringify(I.get("CM.PWDE")?.d) === '["2026-10-27","2026-10-28"]' && JSON.stringify(I.get("CM.PWDE")?.c) === "[95.2,101.75]", I.get("CM.PWDE"));
t("BIS CPI: monthly; feeds the panel only where OECD doesn't", S.get("NG.CPIB")?.mi === "CPI" && S.get("US.CPIB")?.mi === "" && JSON.stringify(S.get("NG.CPIB")?.v) === "[20.1,19.4]", [S.get("NG.CPIB")?.mi, S.get("US.CPIB")?.mi]);
t("OECD: batches of at most 8 areas, both flows, browser-like user agent, a 500 retried", oecdCalls.length === 15 /* dry run: 7 batches + 1 retry; real run: 7 */ && oecdCalls.every((c) => /\/[A-Z+]+\.M\.N\.CPI\.PA\._T\.N\.GY\|Mozilla\/5\.0/.test(c) && c.split("/").pop()!.split(".")[0].split("+").length <= 8) && oecdCalls.filter((c) => c.includes("COICOP2018")).length === 4, oecdCalls.length);
t("Eurostat ICS: escaped commas, UTC time, window; headline data releases only", C.get("auto-estat-2026-11-17-hicp-final-data-october-2026")?.title === "Euro area: HICP - Final data, October 2026" && C.get("auto-estat-2026-11-17-hicp-final-data-october-2026")?.time === "10:00" && [...C.keys()].filter((k) => k.includes("estat")).length === 1, [...C.keys()].filter((k) => k.includes("estat")));
t("BLS ICS: folded lines joined, major release important, contact User-Agent", C.get("auto-bls-2026-11-06-the-employment-situation-for-october-2026")?.imp === 3 && blsUA.every((u) => u === "Superfinancials test ops@example.com"), [...C.keys()].filter((k) => k.includes("bls")));
t("ICS categories read", parseIcs("BEGIN:VEVENT\nDTSTART:20261101\nSUMMARY:x\nX-CATEGORY:Data release\nEND:VEVENT\n")[0]?.cat === "Data release");
t("Treasury: par curve to the app's yields, two calendar years, N/A skipped", JSON.stringify(I.get("YD.US10")?.d) === '["2025-12-31","2026-10-27","2026-10-28"]' && JSON.stringify(I.get("YD.US10")?.c) === "[4.2,4.12,4.1]" && JSON.stringify(I.get("YD.US30")?.c) === "[4.7,4.6]" && I.has("YD.US3M") && /public domain/i.test(String(I.get("YD.US2")?.note)), I.get("YD.US10"));
t("NY Fed: SOFR instrument with the required credit, EFFR series", JSON.stringify(I.get("MM.SOFR")?.c) === "[3.95,3.92]" && /Content from the New York Fed/.test(String(I.get("MM.SOFR")?.note)) && JSON.stringify(S.get("US.EFFR")?.v) === "[3.88]", [I.get("MM.SOFR"), S.get("US.EFFR")]);
t("Bank of England: SONIA series and gilt yields, browser user agent", JSON.stringify(S.get("UK.SONIA")?.d) === '["2026-10-27","2026-10-28"]' && JSON.stringify(I.get("YD.UK5")?.c) === "[3.9]" && JSON.stringify(I.get("YD.UK10")?.c) === "[4.4,4.42]", [S.get("UK.SONIA"), I.get("YD.UK5")]);
t("Bank of Canada: benchmark yields 2/5/10/long, CORRA", JSON.stringify(I.get("YD.CA30")?.c) === "[3.4]" && JSON.stringify(I.get("YD.CA2")?.c) === "[2.45]" && JSON.stringify(S.get("CA.CORRA")?.v) === "[2.25]", [I.get("YD.CA30"), S.get("CA.CORRA")]);
t("ECB €STR daily series", JSON.stringify(S.get("EU.ESTR")?.v) === "[1.66,1.65]" && S.get("EU.ESTR")?.freq === "D", S.get("EU.ESTR"));
t("CFTC: net speculative positions, weekly, unknown markets ignored", JSON.stringify(S.get("US.COT.CL")?.v) === "[210000]" && JSON.stringify(S.get("US.COT.CL")?.d) === '["2026-10-20"]' && S.get("US.COT.CL")?.freq === "W" && ![...S.keys()].some((k) => k.includes("999999")), S.get("US.COT.CL"));
t("EIA inventories in million barrels, weekly", JSON.stringify(S.get("US.CRUDEINV")?.v) === "[421.8,420.5]" && S.get("US.CRUDEINV")?.freq === "W", S.get("US.CRUDEINV"));
const before = S.get("UK.GDPA")?.upd;
oecdDown = true;
const r2 = await runMacroSync({ store, now: new Date("2026-10-30T05:20:00Z") });
const S2 = new Map((await store.list("adm_series")).map((d) => [d.id, d.data]));
t("re-run: unchanged series and prices are not rewritten, filings not refetched", r2.instruments.written === 0 && r2.companies.written === 0 && r2.series.written === 0 && S2.get("UK.GDPA")?.upd === before, r2.series);
t("a failing source is reported; its old data stays", !!r2.sources.oecd.error && S2.has("US.CPIM") && /Failed: oecd/.test(r2.note), r2);

pinkPage = false;
const pk = await runMacroSync({ store: memoryStore(), now: NOW, only: ["commodities"] });
t("Pink Sheet: landing page down → last known workbook address", pk.sources.commodities.series >= 4, pk.sources);
pinkPage = true;
sec403 = true;
const s403 = await runMacroSync({ store: memoryStore(), now: NOW, only: ["sec-formd"] });
t("SEC 403: stops at once with a clear error", /403/.test(s403.sources["sec-formd"].error ?? "") && secUA.length > 0, s403.sources);
sec403 = false;
const xs = readXlsx(PINK_XLSX, "monthly prices");
t("XLSX reader: shared strings, numbers, gaps, sheet by name", xs[6][6] === "Zinc" && xs[7][0] === "2019M01" && xs[7][4] === 1854 && xs[3].length === 0, xs[6]);
const byName = parsePinkSheet(readXlsx(writeXlsx({ "Monthly Prices": [["Title"], [], ["", "Crude oil, Brent", "Natural gas, Europe", "Liquefied natural gas, Japan", "Iron ore, cfr spot", "Palm oil"], ["", "($/bbl)", "($/mmbtu)", "($/mmbtu)", "($/dmtu)", "($/mt)"], [46266, 67.1, 11.0, 12.5, 104.2, 1010]] }), "Monthly Prices"));
t("Pink Sheet without a code row: columns found by commodity name; Excel date serials", JSON.stringify(byName.get("NGAS_EUR")) === '[{"t":"2026-09-30","v":11}]' && byName.has("NGAS_JP") && byName.has("IRON_ORE") && byName.has("PALM_OIL"), [...byName]);
let msg = ""; try { parsePinkSheet([["Commodity price data"], ["something else", 1, 2]]); } catch (e) { msg = (e as Error).message; }
t("Pink Sheet with an unknown layout: the error shows the first rows", /First rows: Commodity price data \/\/ something else \| 1 \| 2/.test(msg), msg);
fmpPremium = true;
const fb = await runMacroSync({ store: memoryStore(), now: NOW, only: ["econ-calendar", "ipos", "dividends"] });
t("FMP plan error → EODHD answers the economic and IPO calendars", fb.sources["econ-calendar"].events === 1 && fb.sources.ipos.events === 1 && fb.sources.dividends.events === 2, fb.sources);
fmpPremium = false;
// Proxies for licensed benchmarks become data-desk instruments, clearly named
const pm = memoryStore(); const pr = await runMacroSync({ store: pm, now: NOW, only: ["proxies"] }); const PI = new Map((await pm.list("adm_inst")).map((d) => [d.id, d.data as Record<string, any>])); // eslint-disable-line @typescript-eslint/no-explicit-any
const ur = PI.get("AD.PX.SRUUF");
t("proxies: new desk instruments named as proxies, with what they stand for and who owns the benchmark; bad prices skipped; one failing symbol loses only that one", ur?.new === true && ur.meta.name === "Sprott Physical Uranium Trust (uranium proxy)" && ur.meta.type === "etf" && /Proxy, not the benchmark/.test(ur.note) && /UxC and TradeTech/.test(ur.note) && JSON.stringify(ur.c) === "[21.4,21.9]" && !PI.has("AD.PX.GSG") && PI.size === 7 && !pr.sources.proxies.error, { ur, n: PI.size, src: pr.sources.proxies });
// FRED series credited to their publishers; spreads; series whose owners restrict reuse are skipped
const fs2 = await fredSeriesList([{ id: "BAMLEMCBPIOAS", code: "X", name: "x", unit: "%", cat: "mk", freq: "D", src: "ICE", notes: "" }, { id: "DCPF3M", minus: "DTB3", bp: true, code: "CPBILL", name: "cp", unit: "bp", cat: "mp", freq: "D", src: "Fed", notes: "n" }], NOW);
t("FRED: restricted (ICE) series skipped; spread in basis points", fs2.length === 1 && fs2[0].code === "CPBILL" && fs2[0].points.every((p) => p.v === 0), fs2.map((x) => [x.code, x.points.length]));
// Central-bank calendar: official decision dates as events, credited to each bank
const cbs = memoryStore(); await runMacroSync({ store: cbs, now: NOW, only: ["cb-calendar"] }); const CB = new Map((await cbs.list("adm_cal")).map((d) => [d.id, d.data as Record<string, any>])); // eslint-disable-line @typescript-eslint/no-explicit-any
const fomc = CB.get("auto-cbcal-us-2026-12-09");
t("central-bank calendar: FOMC, ECB, BoE … with the bank's calendar as source; no past-year leftovers", fomc?.cat === "cb" && fomc.imp === 3 && /Federal Reserve/.test(fomc.srcName) && fomc.url.startsWith("https://www.federalreserve.gov/") && CB.has("auto-cbcal-eu-2027-02-04") && CB.has("auto-cbcal-za-2026-11-19") && [...CB.values()].every((e) => e.date >= "2026-08-30"), { fomc, n: CB.size });
// EIA: weekly, daily and monthly series; one failing series loses only that one
const em = memoryStore(); const er = await runMacroSync({ store: em, now: NOW, only: ["eia"] }); const ES = new Map((await em.list("adm_series")).map((d) => [d.id, d.data as { d?: string[]; v?: number[]; freq?: string; unit?: string }]));
t("EIA: crude stocks in million barrels, Henry Hub daily, power generation monthly in TWh at month end", JSON.stringify(ES.get("US.CRUDEINV")?.v) === "[421.8,420.5]" && ES.get("US.HENRYHUB")?.v?.[0] === 3.12 && ES.get("US.HENRYHUB")?.freq === "D" && JSON.stringify(ES.get("US.POWERGEN")?.d) === '["2026-08-31"]' && ES.get("US.POWERGEN")?.v?.[0] === 421.338 && ES.get("US.POWERGEN")?.unit === "TWh" && !ES.has("US.SPRINV") && !er.sources.eia.error, { keys: [...ES.keys()], src: er.sources.eia });
// IMF projections and NBER recession dates
const im = memoryStore(); const ir = await runMacroSync({ store: im, now: NOW, only: ["imf", "nber"] }); const IS = new Map((await im.list("adm_series")).map((d) => [d.id, d.data]));
const usg = IS.get("US.GDPF") as { d?: string[]; v?: number[]; src?: string; notes?: string } | undefined;
t("IMF: projections this year to five years ahead only, string values read, unknown areas skipped", JSON.stringify(usg?.d) === '["2026-12-31","2027-12-31","2031-12-31"]' && JSON.stringify(usg?.v) === "[2,2.1,2]" && /2026–2031/.test(String(usg?.notes)) && IS.has("NG.GDPF") && ![...IS.keys()].some((k) => k.startsWith("XYZ")), { usg, keys: [...IS.keys()] });
const bal = IS.get("US.GGBAL") as { d?: string[] } | undefined;
t("IMF: fiscal balance history kept as its own series; one failing indicator loses only that one", JSON.stringify(bal?.d) === '["2024-12-31","2025-12-31"]' && !IS.has("US.URF") && ir.sources.imf.series > 0 && !ir.sources.imf.error, { bal, src: ir.sources.imf });
const rec = IS.get("US.USREC") as { d?: string[]; v?: number[]; freq?: string } | undefined;
t("NBER: monthly 0/1 at month end, missing values skipped", rec?.freq === "M" && rec.d?.[1] === "2007-12-31" && rec.v?.[1] === 1 && rec.d?.length === 9, rec);
t("recession spans", JSON.stringify(recessionSpans([{ t: "a", v: 0 }, { t: "b", v: 1 }, { t: "c", v: 1 }, { t: "d", v: 0 }, { t: "e", v: 1 }])) === '[{"from":"b","to":"c"},{"from":"e","to":"e"}]');
fmpDivDown = true;
const dv = await runMacroSync({ store: memoryStore(), now: NOW, only: ["dividends", "splits"] });
const dvs = memoryStore(); await runMacroSync({ store: dvs, now: NOW, only: ["dividends", "splits"] }); const DV = new Map((await dvs.list("adm_cal")).map((d) => [d.id, d.data]));
t("FMP dividend error → EODHD dividend calendar, tracked U.S. names only", dv.sources.dividends.events === 1 && /Record date 2026-11-20, payment 2026-12-11, quarterly/.test(String(DV.get("auto-div-2026-11-19-msft")?.notes)) && JSON.stringify(DV.get("auto-div-2026-11-19-msft")?.ids) === '["EQ.MSFT"]', [...DV]);
const sp = DV.get("auto-spl-2026-11-20-nvda"), rs = DV.get("auto-spl-2026-11-21-tsla");
t("splits: ratio, reverse splits, tracked U.S. names only, linked", sp?.title === "NVDA 4-for-1 stock split" && sp.cat === "spl" && JSON.stringify(sp.ids) === '["EQ.NVDA"]' && rs?.title === "TSLA 1-for-5 reverse stock split" && dv.sources.splits.events === 2, { sp, rs, src: dv.sources.splits });
fmpDivDown = false;
const gs = memoryStore(); await runMacroSync({ store: gs, now: NOW, group: "core", only: undefined }); const gr = await runMacroSync({ store: gs, now: NOW, group: "rates" });
const gm = (await gs.list("macrosync"))[0]?.data as { sources?: Record<string, unknown> };
t("cron groups: the rates run covers only rate sources; the summary keeps the core run's results", Object.keys(gr.sources).sort().join() === "boc,boe,cftc,estr,nyfed,treasury-curve" && "oecd" in (gm.sources ?? {}) && "nyfed" in (gm.sources ?? {}), Object.keys(gm.sources ?? {}));
const only = await runMacroSync({ store: memoryStore(), now: NOW, only: ["bis"] });
t("--only limits the sources", Object.keys(only.sources).join() === "bis", only.sources);
const ua = process.env.SEC_USER_AGENT; delete process.env.SEC_USER_AGENT; const nBls = blsUA.length;
const noua = await runMacroSync({ store: memoryStore(), now: NOW, only: ["sec-formd", "release-calendars"] });
t("no contact User-Agent: Form D skipped, BLS not asked, Eurostat still read", /SEC_USER_AGENT/.test(noua.sources["sec-formd"].skipped ?? "") && noua.sources["release-calendars"].events === 1 && blsUA.length === nBls, [noua.sources, blsUA.length]);
process.env.SEC_USER_AGENT = ua;
delete process.env.FRED_API_KEY;
const nokey = await runMacroSync({ store: memoryStore(), now: NOW, only: ["fred-calendar"] });
t("FRED calendar skipped without a key", /FRED_API_KEY/.test(nokey.sources["fred-calendar"].skipped ?? ""), nokey.sources);

console.log(fails ? `\n${fails} macro-sync test(s) failed` : "\nAll macro-sync tests passed");
process.exit(fails ? 1 : 0);
