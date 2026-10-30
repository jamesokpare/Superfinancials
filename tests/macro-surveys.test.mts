// Surveys, expectations and calculated market series in the macro sync:
// OECD leading indicators, EC sentiment (Eurostat JSON-stat), ECB SPF, BoE
// implied inflation (zip of workbooks), China NBS PMI releases, Cleveland Fed
// (FRED), bill-implied policy path, CIP forwards and VIX ratios. Fake APIs,
// in-memory store.
// Run: npm test
import { runMacroSync } from "../src/lib/macro/sync";
import { cipForward, impliedForward, parseCboeHistory, policyPath, realisedVol, vixRatios } from "../src/lib/macro/derived";
import { jsonStatRows, nbsPmiLinks, parseBoeSpot, parseNbsPmi, parseOecdCli } from "../src/lib/macro/surveys";
import { FRED_SERIES } from "../src/lib/macro/sources";
import { datesIn, noticeDates } from "../src/lib/macro/cbnotices";
import { eexReportLinks, embSpread, interpCurve, parseEmbPage } from "../src/lib/macro/spreads";
import { boeRows, CB_PAGES, counts, EEX_PAGE, EMB_HTML, JS, LIST, nbs, newSourceFetch, REL } from "./fixtures/macro-new-sources";
import { memoryStore } from "../src/lib/market/store";

process.env.MACRO_RETRY_MS = "5"; process.env.MACRO_GAP_MS = "0";
let fails = 0;
const t = (name: string, ok: boolean, info?: unknown) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}`); if (!ok) { fails++; if (info !== undefined) console.log("     ", JSON.stringify(info)?.slice(0, 600)); } };
const near = (a: number | undefined, b: number, e = 1e-3) => a != null && Math.abs(a - b) < e;
const NOW = new Date("2026-10-30T05:50:00Z");

// --- pure calculations ------------------------------------------------------------------------------------------
t("forward rate: flat curve gives the same rate", near(impliedForward(4, 0.25, 4, 0.5), 3.96, 0.05));
t("forward rate: rising curve gives a higher forward", impliedForward(4, 0.25, 4.2, 0.5) > 4.3);
t("CIP forward: higher quote-currency rate → forward above spot", cipForward(1.1, 4, 2, 91) > 1.1 && near(cipForward(1.1, 4, 2, 91), 1.1 * (1 + 0.04 * 91 / 360) / (1 + 0.02 * 91 / 360), 1e-9));
const flat = Array.from({ length: 30 }, (_, i) => ({ t: `2026-09-${String(i + 1).padStart(2, "0")}`, v: 100 }));
t("realised vol of a flat series is 0", realisedVol(flat).every((p) => p.v === 0) && realisedVol(flat).length === 9);
t("Cboe history CSV (MM/DD/YYYY, CLOSE or index column)", JSON.stringify(parseCboeHistory("DATE,OPEN,HIGH,LOW,CLOSE\n10/28/2026,15,16,14,15.5\n")) === JSON.stringify([{ t: "2026-10-28", v: 15.5 }]) && parseCboeHistory("DATE,VVIX\n10/28/2026,90.1\n")[0]?.v === 90.1);
const pp = policyPath({ m3: [{ t: "2026-10-28", v: 4.0 }], m6: [{ t: "2026-10-28", v: 3.8 }], y1: [{ t: "2026-10-28", v: 3.5 }] }, [{ t: "2026-10-27", v: 4.1 }]);
const pp6 = pp.find((s) => s.code === "PPATH6M")?.points[0]?.v;
t("policy path: inverted bills price cuts vs EFFR (uses the last EFFR on or before the date)", pp.length === 4 && pp6 != null && pp6 < -40 && pp6 > -60, pp);
const vr = vixRatios({ vix: [{ t: "2026-10-28", v: 20 }], vix3m: [{ t: "2026-10-28", v: 22 }], vix9d: [{ t: "2026-10-28", v: 18 }], vvix: [{ t: "2026-10-28", v: 90 }] });
t("VIX ratios: VIX/VIX3M, VIX9D/VIX, VVIX/VIX; no levels stored", near(vr.find((s) => s.code === "VIXTS")?.points[0].v, 0.909) && near(vr.find((s) => s.code === "VIX9DR")?.points[0].v, 0.9) && near(vr.find((s) => s.code === "VVIXR")?.points[0].v, 4.5) && !vr.some((s) => s.points.some((p) => p.v === 20)), vr);

// --- parsers --------------------------------------------------------------------------------------------------------
const cli = parseOecdCli([
  { REF_AREA: "USA", MEASURE: "LI", ADJUSTMENT: "AA", TRANSFORMATION: "IX", METHODOLOGY: "H", TIME_PERIOD: "2026-08", OBS_VALUE: "100.4" },
  { REF_AREA: "USA", MEASURE: "LI", ADJUSTMENT: "NOR", TRANSFORMATION: "IX", METHODOLOGY: "H", TIME_PERIOD: "2026-08", OBS_VALUE: "99.1" },
  { REF_AREA: "DEU", MEASURE: "BCICP", ADJUSTMENT: "AA", TRANSFORMATION: "IX", METHODOLOGY: "H", TIME_PERIOD: "2026-09", OBS_VALUE: "98.7" },
  { REF_AREA: "XXX", MEASURE: "LI", ADJUSTMENT: "AA", TIME_PERIOD: "2026-09", OBS_VALUE: "1" },
]);
t("OECD CLI: amplitude-adjusted variant chosen, app country codes, period end dates", cli.length === 2 && cli.find((s) => s.cc === "US" && s.code === "CLI")?.points[0].v === 100.4 && cli.find((s) => s.cc === "DE")?.code === "BCI" && cli[0].points[0].t.endsWith("-31"), cli);
const rows = jsonStatRows(JS);
t("JSON-stat: flat index → dimension codes", rows.length === 4 && rows[0].geo === "EL" && rows[0].time === "2026-08" && rows[1].geo === "EA20" && rows[1].time === "2026-09" && rows[3].indic === "BS-CSMCI-BAL" && rows[3].geo === "EA20", rows);
const bs = parseBoeSpot(boeRows, [5, 10, 20]);
t("BoE spot sheet: maturities from the header row, Excel serial dates", bs.get(5)?.length === 2 && bs.get(10)?.[0].v === 3.6 && bs.get(20)?.[1].v === 3.6 && bs.get(5)?.[0].t === "2026-10-05", Object.fromEntries(bs));
const links = nbsPmiLinks(LIST);
t("NBS list: PMI releases only, absolute URLs, newest first", links.length === 2 && links[0].url === "https://www.stats.gov.cn/english/PressRelease/202610/t20261031_1960001.html" && links[0].released === "2026-10-31", links);
const nb = parseNbsPmi(REL("October 2026", "50.1", "50.6", "50.8"), "Purchasing Managers Index for October 2026", "2026-10-31");
t("NBS release: the three headline indexes and the month", JSON.stringify(nb) === JSON.stringify({ month: "2026-10-31", mfg: 50.1, nonmfg: 50.6, comp: 50.8 }), nb);
t("Cleveland Fed expected inflation series listed (FRED EXPINF*)", ["EXPINF1YR", "EXPINF10YR", "EXPINF30YR"].every((id) => FRED_SERIES.some((s) => s.id === id && /Cleveland/.test(s.src))));

t("EMB page: yield, duration and as-of date", JSON.stringify(parseEmbPage(EMB_HTML)) === JSON.stringify({ t: "2026-10-28", ytm: 6.16, dur: 6.59 }), parseEmbPage(EMB_HTML));
t("curve interpolation (linear, flat beyond the ends)", near(interpCurve([[5, 4], [10, 4.5]], 6.59) ?? undefined, 4.159) && interpCurve([[5, 4], [10, 4.5]], 40) === 4.5);
const es = embSpread({ t: "2026-10-28", ytm: 6.16, dur: 6.59 }, { "YD.US5": [{ t: "2026-10-27", v: 4.0 }], "YD.US10": [{ t: "2026-10-28", v: 4.5 }, { t: "2026-10-29", v: 9 }] });
t("EMB spread: yield minus Treasury at its duration, in bp; uses curve data on or before the as-of date", es[0]?.points[0].v === 200.1 && es[0].unit === "bp" && /not the J.P. Morgan EMBI/.test(es[0].notes), es);
t("EEX: this year's auction report linked, calendars and old years skipped", JSON.stringify(eexReportLinks(EEX_PAGE, 2026)) === JSON.stringify(["https://www.eex.com/fileadmin/EEX/Downloads/Market_Data/Environmentals/EUA_Primary_Auction_Report_2026.xlsx"]), eexReportLinks(EEX_PAGE, 2026));
t("dates in notices: ranges give the last day; English and Spanish", JSON.stringify(datesIn("Monday 23rd and Tuesday 24th November, 2026")) === '["2026-11-24"]' && JSON.stringify(datesIn("March 16 to Wednesday, March 18, 2026")) === '["2026-03-18"]' && JSON.stringify(datesIn("el 6 de noviembre de 2026")) === '["2026-11-06"]' && JSON.stringify(datesIn("23rd – 25th November 2026")) === '["2026-11-25"]', [datesIn("Monday 23rd and Tuesday 24th November, 2026"), datesIn("March 16 to Wednesday, March 18, 2026"), datesIn("23rd – 25th November 2026")]);
t("notice dates: MPC sentences only, future only", JSON.stringify(noticeDates(CB_PAGES["www.cbe.org.eg"], NOW)) === '["2026-12-24"]' && JSON.stringify(noticeDates(CB_PAGES["www.bog.gov.gh"], NOW)) === '["2026-11-25"]', [noticeDates(CB_PAGES["www.cbe.org.eg"], NOW), noticeDates(CB_PAGES["www.bog.gov.gh"], NOW)]);

// --- the sync with fake publishers -----------------------------------------------------------------------------------
const treasCsv = `Date,"1 Mo","2 Mo","3 Mo","6 Mo","1 Yr","2 Yr","5 Yr","10 Yr","30 Yr"\n10/28/2026,4.10,4.05,4.00,3.80,3.50,3.40,3.60,4.00,4.50\n10/27/2026,4.11,4.06,4.01,3.82,3.52,3.41,3.61,4.01,4.51\n`;
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = new URL(String(input instanceof Request ? input.url : input)); const p = url.pathname;
  const f = newSourceFetch(url); if (f) return f;
  if (url.hostname === "home.treasury.gov") return new Response(treasCsv, { headers: { "content-type": "text/csv" } });
  if (url.hostname === "markets.newyorkfed.org") return new Response(JSON.stringify({ refRates: [{ effectiveDate: "2026-10-28", percentRate: p.includes("effr") ? 4.08 : 4.05 }] }));
  return new Response("unexpected " + url.href, { status: 404 });
}) as typeof fetch;

const store = memoryStore();
// SPX history in the market store (t0 + day gaps), for VIX minus realised volatility.
await store.upsert("mkthist", [{ id: "IX.SPX", data: { type: "hist", id: "IX.SPX", parts: { eodhd: { t0: "2026-09-27", c: Array.from({ length: 32 }, (_, i) => 5000 * (1 + (i % 2 ? 0.01 : -0.01))), dd: Array(31).fill(1), checked: "x" } } } }]);
await store.upsert("adm_series", [{ id: "CN.PMIMFG", data: { kind: "eco", cc: "CN", code: "PMIMFG", d: ["2026-08-31"], v: [49.4], gen: "macro-sync" } }]);
const r = await runMacroSync({ store, now: NOW, only: ["oecd-cli", "ec-sentiment", "ecb-spf", "nbs-pmi", "boe-inflation", "treasury-curve", "nyfed", "fx-forwards", "vix-curve", "emb-spread", "eu-carbon", "cb-notices"] });
const S = new Map((await store.list("adm_series")).map((d) => [d.id, d.data as Record<string, any>])); // eslint-disable-line @typescript-eslint/no-explicit-any
t("every new source answered", Object.values(r.sources).every((s) => !s.error && !s.skipped), r.sources);
t("OECD CLI and consumer confidence stored with credit", S.get("US.CLI")?.v?.[0] === 100.2 && S.get("JP.CCI")?.unit === "index (LTA = 100)" && /CC BY 4.0/.test(S.get("US.CLI")?.notes));
t("EC sentiment: euro area as EU, Greece as GR, consumer confidence", S.get("EU.ESI")?.v?.[0] === 99.5 && S.get("GR.ESI")?.v?.[0] === 101.2 && S.get("EU.CONSCONF")?.v?.[0] === -15.2 && /DG ECFIN/.test(S.get("EU.ESI")?.src));
t("ECB SPF: quarterly rounds dated to quarter end; a missing key doesn't stop the rest", S.get("EU.SPF.HICPLT")?.d?.join() === "2026-06-30,2026-09-30" && S.has("EU.SPF.GDPLT") && !S.has("EU.SPF.UNEMLT"));
t("BoE implied inflation: spot 5/10/20y and 5y5y, archive read once, old years dropped", S.get("UK.INFL10Y")?.d?.length === 3 && S.get("UK.INFL5Y5Y")?.v?.length === 3 && !S.get("UK.INFL5Y")?.d?.includes("2014-12-27") && counts.arch === 1, { d: S.get("UK.INFL10Y")?.d, arch: counts.arch });
t("NBS PMI: added to stored history (kept), composite and non-manufacturing", S.get("CN.PMIMFG")?.d?.join() === "2026-08-31,2026-09-30,2026-10-31" && S.get("CN.PMIMFG")?.v?.join() === "49.4,49.8,50.1" && S.get("CN.PMICOMP")?.v?.at(-1) === 50.8);
t("policy path from Treasury bills vs EFFR", S.get("US.PPATH6M")?.v?.at(-1) != null && S.get("US.PPATH6M")!.v.at(-1) < 0 && !!S.get("US.FWD3M3M")?.src.includes("U.S. Treasury"));
t("bill yields themselves are not stored as series", !S.has("US.TB1M") && ![...S.keys()].some((k) => k.includes("m1")));
const fwd = S.get("EU.FWD3M.EURUSD")?.v?.at(-1);
t("CIP forwards: EUR/USD 3M and 1Y with points, USD/CAD", near(fwd, 1.1 * (1 + 0.04 * 91 / 360) / (1 + 0.019 * 91 / 360), 1e-4) && S.get("EU.FWDPTS1Y.EURUSD")?.unit === "pips" && S.has("CA.FWD3M.USDCAD"), { fwd, keys: [...S.keys()].filter((k) => k.includes("FWD")) });
t("VIX ratios stored, levels not; VRP from SPX history", S.get("US.VIXTS")?.v?.[0] === 0.909 && S.has("US.VRP") && ![...S.values()].some((x) => x.code === "VIX"), [...S.keys()].filter((k) => k.startsWith("US.V")));
const C = new Map((await store.list("adm_cal")).map((d) => [d.id, d.data as Record<string, any>])); // eslint-disable-line @typescript-eslint/no-explicit-any
t("EMB spread stored from this run's Treasury curve", S.get("US.EMSPRD")?.d?.join() === "2026-10-28" && S.get("US.EMSPRD")?.v?.[0] != null && S.get("US.EMSPRD")!.v[0] > 150, S.get("US.EMSPRD"));
t("EU carbon: EUA auctions averaged per day, aviation and cancelled skipped", S.get("EU.EUAAUC")?.d?.join() === "2026-10-27,2026-10-28" && S.get("EU.EUAAUC")?.v?.join() === "71.4,72.05" && /EEX/.test(S.get("EU.EUAAUC")?.src), S.get("EU.EUAAUC"));
t("central-bank notices: CBN, CBK, BoG, CBE and Banxico dates, each linked to its page", ["auto-cbn-ng-2026-11-24", "auto-cbn-ke-2026-12-08", "auto-cbn-gh-2026-11-25", "auto-cbn-eg-2026-12-24", "auto-cbn-mx-2026-11-19", "auto-cbn-mx-2026-12-17"].every((id) => C.get(id)?.cat === "cb") && /centralbank\.go\.ke/.test(C.get("auto-cbn-ke-2026-12-08")?.url) && !C.has("auto-cbn-ng-2027-01-12"), [...C.keys()]);
t("derived counts credited to their input sources", (r.sources["vix-curve"]?.series ?? 0) >= 3 && (r.sources["treasury-curve"]?.series ?? 0) >= 6, r.sources);

// second run: the BoE archive is not read again; NBS keeps history; a changed release replaces its month
nbs.month = "October 2026";
const r2 = await runMacroSync({ store, now: NOW, only: ["boe-inflation", "nbs-pmi"] });
const S2 = new Map((await store.list("adm_series")).map((d) => [d.id, d.data as Record<string, any>])); // eslint-disable-line @typescript-eslint/no-explicit-any
t("re-run: archive not fetched again, history kept", counts.arch === 1 && S2.get("UK.INFL10Y")?.d?.length === 3 && S2.get("CN.PMIMFG")?.d?.length === 3 && r2.series.unchanged >= 2, { arch: counts.arch, r2: r2.series });

if (fails) { console.log(`\n${fails} failed`); process.exit(1); }
console.log("\nall macro survey and calculated-series checks passed");
