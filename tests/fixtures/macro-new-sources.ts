// Fake answers for the macro survey and calculated-series sources (OECD CLI, Eurostat sentiment, ECB SPF and
// curve, BoE yield-curve zips, NBS PMI pages, Bank of Canada bills, Cboe history). Shared by the macro tests.
import { writeXlsx, writeZip } from "../../src/lib/macro/xlsx";
export const JS = { id: ["indic", "geo", "time"], size: [2, 3, 2], dimension: { indic: { category: { index: { "BS-ESI-I": 0, "BS-CSMCI-BAL": 1 } } }, geo: { category: { index: { EL: 0, EA20: 1, DE: 2 } } }, time: { category: { index: { "2026-08": 0, "2026-09": 1 } } } }, value: { "0": 101.2, "3": 99.5, "5": 97.1, "9": -15.2, "7": null } };
export const boeRows: (string | number)[][] = [["UK implied inflation spot curve"], ["years:", 2.5, 3, 4, 5, 6, 7, 8, 10, 15, 20], [46300, 3.1, 3.2, 3.3, 3.4, 3.45, 3.5, 3.52, 3.6, 3.65, 3.7], ["", ""], [46301, 3.0, 3.1, 3.2, 3.3, 3.35, 3.4, 3.42, 3.5, 3.55, 3.6]];
export const LIST = `<ul><li><a href="./202610/t20261031_1960001.html" title="x">Purchasing Managers Index for October 2026</a></li><li><a href="./202610/t20261020_1960000.html">Industrial Production</a></li><li><a href="./202609/t20260930_1950000.html">Purchasing Managers Index for September 2026</a></li></ul>`;
export const REL = (m: string, a: string, b: string, c: string) => `<html><body><h1>Purchasing Managers Index for ${m}</h1><p>In ${m}, the manufacturing purchasing managers' index (PMI) was ${a} percent, up 0.2 percentage point from last month.</p><p>In ${m}, the non-manufacturing business activity index was ${b} percent.</p><p>The composite PMI output index was ${c} percent.</p></body></html>`;
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
  return null;
}
