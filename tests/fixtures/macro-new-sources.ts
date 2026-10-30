// Fake answers for the macro survey and calculated-series sources (OECD CLI, Eurostat sentiment, ECB SPF and
// curve, BoE yield-curve zips, NBS PMI pages, Bank of Canada bills, Cboe history). Shared by the macro tests.
import { writeXlsx, writeZip } from "../../src/lib/macro/xlsx";
import { makePdf } from "./pdf";
export const JS = { id: ["indic", "geo", "time"], size: [2, 3, 2], dimension: { indic: { category: { index: { "BS-ESI-I": 0, "BS-CSMCI-BAL": 1 } } }, geo: { category: { index: { EL: 0, EA20: 1, DE: 2 } } }, time: { category: { index: { "2026-08": 0, "2026-09": 1 } } } }, value: { "0": 101.2, "3": 99.5, "5": 97.1, "9": -15.2, "7": null } };
export const boeRows: (string | number)[][] = [["UK implied inflation spot curve"], ["years:", 2.5, 3, 4, 5, 6, 7, 8, 10, 15, 20], [46300, 3.1, 3.2, 3.3, 3.4, 3.45, 3.5, 3.52, 3.6, 3.65, 3.7], ["", ""], [46301, 3.0, 3.1, 3.2, 3.3, 3.35, 3.4, 3.42, 3.5, 3.55, 3.6]];
export const LIST = `<ul><li><a href="./202610/t20261031_1960001.html" title="x">Purchasing Managers Index for October 2026</a></li><li><a href="./202610/t20261020_1960000.html">Industrial Production</a></li><li><a href="./202609/t20260930_1950000.html">Purchasing Managers Index for September 2026</a></li></ul>`;
export const REL = (m: string, a: string, b: string, c: string) => `<html><body><h1>Purchasing Managers Index for ${m}</h1><p>In ${m}, the manufacturing purchasing managers' index (PMI) was ${a} percent, up 0.2 percentage point from last month.</p><p>In ${m}, the non-manufacturing business activity index was ${b} percent.</p><p>The composite PMI output index was ${c} percent.</p></body></html>`;
export const EMB_HTML = `<div class="product-data-item"><span class="caption">Average Yield to Maturity <span class="as-of-date">as of Oct 28, 2026</span></span><span class="data">6.16%</span></div><div><span class="caption">Effective Duration <span>as of Oct 28, 2026</span></span><span class="data">6.59 yrs</span></div>`;
export const EEX_PAGE = `<a href="/fileadmin/EEX/Downloads/Market_Data/Environmentals/EUA_Primary_Auction_Report_2026.xlsx">2026</a> <a href="/fileadmin/x/EUA_Auction_Calendar_2026.xlsx">calendar</a> <a href="/fileadmin/x/emission-spot-primary-market-auction-report-2019-data.xlsx">2019</a>`;
export const EEX_XLSX = writeXlsx({ "Primary Market Auction": [["EUA Primary Auction Report"], ["Date", "Auction Name", "Contract", "Status", "Auction Price €/tCO2", "Auction Volume tCO2"],
  ["2026-10-27", "EU Auction", "EUA", "Completed", 71.2, 3000000], ["2026-10-27", "DE Auction", "EUA", "Completed", 71.6, 1500000], ["2026-10-28", "EU Auction (aviation)", "EUAA", "Completed", 70.1, 500000], [46323, "PL Auction", "EUA", "Completed", 72.05, 2000000], ["2026-10-30", "EU Auction", "EUA", "Cancelled", 0, 0]] });
export const CB_PAGES: Record<string, string> = {
  "www.cbn.gov.ng": `<p>The 307th meeting of the Monetary Policy Committee (MPC) is scheduled for Monday 23rd and Tuesday 24th November, 2026.</p><p>Annual report 2025 published 12 January 2026.</p>`,
  "www.centralbank.go.ke": `<h3>Next MPC Meeting</h3><p>The next Monetary Policy Committee (MPC) meeting will be held on Tuesday, December 8, 2026.</p>`,
  "www.bog.gov.gh": `<table><tr><td>133rd MPC Meeting</td><td>23rd – 25th November 2026</td></tr></table><p>MPC meeting dates: 128th MPC meeting 26th – 28th January 2026.</p>`,
  "www.cbe.org.eg": `<p>The Monetary Policy Committee (MPC) will hold its next meeting on Thursday 24 December 2026.</p><p>The Bank's offices close on 1 January 2027.</p>`,
  "www.banxico.org.mx": `<p>Calendario de anuncios de las decisiones de política monetaria: 19 de noviembre de 2026 y 17 de diciembre de 2026.</p>`,
};
export const RGGI_HTML = `<table><tr><th>Auction</th><th>Date</th><th>Quantity Sold</th><th>Clearing Price</th></tr><tr><td>71</td><td>03/11/2026</td><td>26,088,154</td><td>$24.99</td></tr><tr><td>72</td><td>06/03/2026</td><td>17,100,000</td><td>$23.10</td></tr><tr><td>Total</td><td></td><td>43,188,154</td><td></td></tr></table>`;
export const CARB_HTML = `<ul><li><a href="/sites/default/files/2026-08/results_summary.pdf">Summary of Auction Settlement Prices and Results</a></li><li><a href="/sites/default/files/2026-07/auction_notice.pdf">Auction Notice</a></li></ul>`;
export const CARB_PDF = makePdf(["Summary of Joint Auction Settlement Prices and Results", "Auction Current Vintage Advance Vintage", "May 2026 Settlement Price $29.61 $28.80", "August 2026 Settlement Price $30.05 $29.12", "Auction Reserve Price 2026 $25.87"]);
export const DAMO_HTML = `<p>Last updated: January 5, 2026</p><table><tr><td>Country</td><td>Moody's rating</td><td>Rating-based Default Spread</td><td>Total Equity Risk Premium</td><td>Country Risk Premium</td></tr>
<tr><td>Nigeria</td><td>Caa1</td><td>7.85%</td><td>14.20%</td><td>9.87%</td></tr><tr><td>United Kingdom</td><td>Aa3</td><td>0.67%</td><td>5.17%</td><td>0.84%</td></tr><tr><td>Côte d'Ivoire</td><td>Ba2</td><td>3.04%</td><td>8.15%</td><td>3.82%</td></tr><tr><td>Atlantis</td><td>A1</td><td>1%</td><td>5%</td><td>1%</td></tr></table>`;
const BOE_ZIP = writeZip([["GLC Inflation daily data current month.xlsx", writeXlsx({ "info": [["about"]], "4. spot curve": boeRows })], ["GLC Nominal daily data current month.xlsx", writeXlsx({ "4. spot curve": [["years:", 5, 10, 20]] })]]);
const BOE_ARCH = writeZip([["GLC Inflation daily data_2016 to 2024.xlsx", writeXlsx({ "4. spot curve": [["years:", 2.5, 3, 4, 5, 6, 7, 8, 10, 15, 20], [45000, 1, 1, 1, 3.9, 1, 1, 1, 3.8, 1, 3.7], [42000, 1, 1, 1, 2, 1, 1, 1, 2, 1, 2]] })]]);
export const nbs = { month: "October 2026" };
export const counts = { arch: 0 };
/** Answers for the survey and calculated-series sources; null for any other address. */
export function newSourceFetch(url: URL): Response | null {
  const p = url.pathname;
  const csv = (s: string) => new Response(s, { headers: { "content-type": "text/csv" } });
  if (url.hostname === "sdmx.oecd.org" && p.includes("DF_CLI")) return csv("REF_AREA,FREQ,MEASURE,UNIT_MEASURE,ACTIVITY,ADJUSTMENT,TRANSFORMATION,TIME_HORIZ,METHODOLOGY,TIME_PERIOD,OBS_VALUE\nUSA,M,LI,IX,_Z,AA,IX,_Z,H,2026-09,100.2\nJPN,M,CCICP,IX,_Z,AA,IX,_Z,H,2026-09,99.4\n");
  if (url.hostname === "ec.europa.eu" && p.endsWith("/ei_bssi_m_r2")) return new Response(JSON.stringify(JS));
  if (url.hostname === "data-api.ecb.europa.eu") {
    if (p.includes("/SPF/")) return p.includes("UNEM") ? new Response("no", { status: 404 }) : csv(`KEY,TIME_PERIOD,OBS_VALUE\nx,2026-Q3,${p.includes("HICP") ? "2.02" : "1.25"}\nx,2026-Q2,2.01\n`);
    if (p.includes("/EXR/D.USD.EUR")) return csv("KEY,TIME_PERIOD,OBS_VALUE\nx,2026-10-28,1.1000\nx,2026-10-27,1.0950\n");
    if (p.includes("/YC/")) return csv(`KEY,TIME_PERIOD,OBS_VALUE\nx,2026-10-28,${p.includes("SR_3M") ? "1.90" : "1.95"}\n`);
    return null;
  }
  if (url.hostname === "www.bankofengland.co.uk" && p.endsWith(".zip")) return p.endsWith("latest-yield-curve-data.zip") ? new Response(new Uint8Array(BOE_ZIP)) : p.endsWith("glcinflationddata.zip") ? (counts.arch++, new Response(new Uint8Array(BOE_ARCH))) : new Response("no", { status: 404 });
  if (url.hostname === "www.stats.gov.cn") return p === "/english/PressRelease/" ? new Response(LIST) : p.includes("t20261031") ? new Response(REL(nbs.month, "50.1", "50.6", "50.8")) : new Response(REL("September 2026", "49.8", "50.0", "50.4"));
  if (url.hostname === "www.bankofcanada.ca" && p.includes("V39065")) return new Response(JSON.stringify({ observations: [{ d: "2026-10-28", V39065: { v: "2.50" }, V39067: { v: "2.40" }, FXUSDCAD: { v: "1.3800" } }] }));
  if (url.hostname === "cdn.cboe.com") { const f = p.split("/").pop(); const v = { "VIX_History.csv": "DATE,OPEN,HIGH,LOW,CLOSE\n10/28/2026,1,1,1,20\n", "VIX3M_History.csv": "DATE,OPEN,HIGH,LOW,CLOSE\n10/28/2026,1,1,1,22\n", "VIX9D_History.csv": "DATE,OPEN,HIGH,LOW,CLOSE\n10/28/2026,1,1,1,18\n", "VVIX_History.csv": "DATE,VVIX\n10/28/2026,90\n" }[String(f)]; return v ? csv(v) : new Response("no", { status: 404 }); }
  if (url.hostname === "www.ishares.com" && p.includes("/239572/")) return new Response(EMB_HTML);
  if (url.hostname === "www.eex.com") return p.endsWith(".xlsx") ? (p.includes("2026") && !/calendar/i.test(p) ? new Response(new Uint8Array(EEX_XLSX)) : new Response("no", { status: 404 })) : new Response(EEX_PAGE);
  if (CB_PAGES[url.hostname]) return url.hostname === "www.bog.gov.gh" && !p.includes("2026") ? new Response("no", { status: 404 }) : new Response(CB_PAGES[url.hostname]);
  if (url.hostname === "www.rggi.org") return new Response(RGGI_HTML);
  if (url.hostname === "ww2.arb.ca.gov") return p.endsWith("results_summary.pdf") ? new Response(new Uint8Array(CARB_PDF), { headers: { "content-type": "application/pdf" } }) : p.endsWith(".pdf") ? new Response("no", { status: 404 }) : new Response(CARB_HTML);
  if (url.hostname === "pages.stern.nyu.edu") return new Response(DAMO_HTML);
  return null;
}
