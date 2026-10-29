/**
 * Which provider (and which symbol) supplies each instrument in the app's
 * universe. Instrument ids are the legacy app's ids (EQ.AAPL, IX.SPX, FX.EURUSD,
 * YD.US10, CM.CL1 ...). Each id lists sources in priority order; the sync uses
 * the first configured provider that returns a value.
 *
 * Instruments not listed here (or whose sources all fail) stay simulated and
 * keep their SIM label. Derived instruments (BD.* bond prices, FX.EC1, CM.XAU's
 * fallback) follow their underlying series automatically in the app.
 */

export type ProviderId =
  | "eodhd" | "fmp" | "marketstack" | "alphavantage" | "fred" | "exchangerate"
  | "ngxpulse" | "mansa" | "mystocks" | "africa";

/** FRED transforms: `units` is passed to the API; `period` re-dates monthly/quarterly observations to period end. */
export type FredSpec = { series: string; units?: "lin" | "chg" | "pc1"; period?: "M" | "Q"; frequency?: "m"; aggregation?: "eop" | "avg" };

export type Source =
  | { p: "eodhd" | "fmp" | "marketstack" | "alphavantage"; s: string; note?: string }
  | { p: "fred"; s: FredSpec; note?: string }
  | { p: "exchangerate"; s: string; note?: string }; // ISO pair, e.g. "USDJPY"

/** Labels shown in the app's Sources panel (keys are written into mkt docs). */
export const SOURCE_LABELS: Record<ProviderId, [string, string]> = {
  eodhd: ["EODHD", "https://eodhd.com/"],
  fmp: ["Financial Modeling Prep", "https://financialmodelingprep.com/"],
  marketstack: ["Marketstack", "https://marketstack.com/"],
  alphavantage: ["Alpha Vantage", "https://www.alphavantage.co/"],
  fred: ["FRED (St. Louis Fed)", "https://fred.stlouisfed.org/"],
  exchangerate: ["ExchangeRate-API", "https://www.exchangerate-api.com/"],
  ngxpulse: ["NGX Pulse", "https://ngxpulse.ng/"],
  mansa: ["Mansa API", "https://mansaapi.com/"],
  mystocks: ["MyStocks Africa", "https://mystocks.africa/"],
  africa: ["Africa API", "https://africa-api.com/"],
};

const MAP: Record<string, Source[]> = {};
const add = (id: string, ...src: Source[]) => { (MAP[id] ??= []).push(...src); };

// --- U.S. equities and ETFs -----------------------------------------------
const EQ = "AAPL MSFT NVDA AVGO ORCL ADBE CRM AMD INTC GOOGL META NFLX DIS T VZ AMZN TSLA HD MCD NKE WMT COST PG KO PEP JPM BAC GS MS V UNH LLY JNJ MRK PFE ABBV XOM CVX CAT BA GE NEE DUK LIN SHW PLD AMT FCX SCCO NEM AA ALB NUE MOS CF COP OXY VLO SLB CCJ ADM BG DE HSY";
const ETF = "XLK XLV XLF XLE XLI XLY XLP XLU XLB XLRE XLC IWF IWB IWD IWP IWR IWS IWO IWM IWN SHY IEF TLT TIP MUB LQD HYG CWB AGG BND EMB FXE GLD USO";
for (const [pre, list] of [["EQ", EQ], ["ET", ETF]] as const) {
  for (const tk of list.split(" ")) {
    add(`${pre}.${tk}`, { p: "eodhd", s: `${tk}.US` }, { p: "fmp", s: tk }, { p: "marketstack", s: tk }, { p: "alphavantage", s: tk });
  }
}

// --- Indices: [id, EODHD, FMP] -----------------------------------------------
const IDX: [string, string, string?][] = [
  ["SPX", "GSPC.INDX", "^GSPC"], ["INDU", "DJI.INDX", "^DJI"], ["CCMP", "IXIC.INDX", "^IXIC"], ["NDX", "NDX.INDX", "^NDX"],
  ["RUT", "RUT.INDX", "^RUT"], ["VIX", "VIX.INDX", "^VIX"], ["VXN", "VXN.INDX"], ["VXD", "VXD.INDX"], ["GVZ", "GVZ.INDX"],
  ["OVX", "OVX.INDX"], ["EVZ", "EVZ.INDX"], ["SKEW", "SKEW.INDX", "^SKEW"], ["MOVE", "MOVE.INDX", "^MOVE"],
  ["UKX", "FTSE.INDX", "^FTSE"], ["DAX", "GDAXI.INDX", "^GDAXI"], ["CAC", "FCHI.INDX", "^FCHI"], ["SX5E", "STOXX50E.INDX", "^STOXX50E"],
  ["NKY", "N225.INDX", "^N225"], ["HSI", "HSI.INDX", "^HSI"], ["AS51", "AXJO.INDX", "^AXJO"], ["SPTSX", "GSPTSE.INDX", "^GSPTSE"],
  ["SHCOMP", "SSEC.INDX", "000001.SS"], ["SENSEX", "BSESN.INDX", "^BSESN"], ["NIFTY", "NSEI.INDX", "^NSEI"], ["KOSPI", "KS11.INDX", "^KS11"],
  ["IBOV", "BVSP.INDX", "^BVSP"], ["JALSH", "J203.INDX"],
];
// Cboe volatility indices are also published daily on FRED (free, reliable).
const FRED_VOL: Record<string, string> = { VIX: "VIXCLS", VXN: "VXNCLS", VXD: "VXDCLS", GVZ: "GVZCLS", OVX: "OVXCLS", EVZ: "EVZCLS" };
for (const [tk, eod, fmp] of IDX) {
  add(`IX.${tk}`, { p: "eodhd", s: eod });
  if (fmp) add(`IX.${tk}`, { p: "fmp", s: fmp });
  if (FRED_VOL[tk]) add(`IX.${tk}`, { p: "fred", s: { series: FRED_VOL[tk] } });
}
// IX.NGSEINDX (NGX All-Share) comes from the African sources in sync.ts.

// --- FX: ExchangeRate-API first (one call covers every pair), FRED H.10 as a fallback ---
const FX_FRED: Record<string, string> = {
  EURUSD: "DEXUSEU", GBPUSD: "DEXUSUK", USDJPY: "DEXJPUS", USDCHF: "DEXSZUS", AUDUSD: "DEXUSAL", USDCAD: "DEXCAUS",
  USDHKD: "DEXHKUS", USDINR: "DEXINUS", USDBRL: "DEXBZUS", USDZAR: "DEXSFUS", USDKRW: "DEXKOUS", USDMXN: "DEXMXUS",
  NZDUSD: "DEXUSNZ", USDSEK: "DEXSDUS", USDNOK: "DEXNOUS",
};
const FX = "EURUSD GBPUSD USDJPY USDCHF AUDUSD USDCAD USDCNH USDHKD USDINR USDBRL USDZAR USDKRW USDNGN USDMXN USDIDR USDTRY USDKES USDEGP USDGHS NZDUSD USDSEK USDNOK USDPLN USDCLP USDCOP";
for (const pair of FX.split(" ")) {
  add(`FX.${pair}`, { p: "exchangerate", s: pair }, { p: "eodhd", s: `${pair}.FOREX` }, { p: "fmp", s: pair });
  if (FX_FRED[pair]) add(`FX.${pair}`, { p: "fred", s: { series: FX_FRED[pair] } });
  add(`FX.${pair}`, { p: "alphavantage", s: pair });
}
// FX.DXY is computed from its six component rates in sync.ts (ICE formula).

// --- Crypto ---
add("CR.BTCUSD", { p: "eodhd", s: "BTC-USD.CC" }, { p: "fmp", s: "BTCUSD" }, { p: "alphavantage", s: "BTCUSD" });
add("CR.ETHUSD", { p: "eodhd", s: "ETH-USD.CC" }, { p: "fmp", s: "ETHUSD" }, { p: "alphavantage", s: "ETHUSD" });

// --- Government yields (EODHD .GBOND), with FRED for U.S. Treasuries ---
const CURVES: Record<string, string[]> = {
  US: ["2", "5", "10", "30"], UK: ["2", "5", "10", "30"], DE: ["2", "5", "10", "30"], FR: ["2", "5", "10", "30"], IT: ["2", "5", "10", "30"],
  JP: ["2", "5", "10", "30"], CA: ["2", "5", "10", "30"], AU: ["2", "5", "10", "30"], IN: ["2", "5", "10", "30"], BR: ["2", "5", "10"],
  ZA: ["2", "5", "10", "30"], NG: ["2", "5", "10", "30"], CN: ["2", "5", "10", "30"], MX: ["2", "5", "10", "30"], ID: ["2", "5", "10", "30"],
  TR: ["2", "5", "10"], KE: ["2", "5", "10"], EG: ["2", "5", "10"], GH: ["2", "5", "10"],
};
const UST: Record<string, string> = { "2": "DGS2", "5": "DGS5", "10": "DGS10", "30": "DGS30" };
for (const [cc, tenors] of Object.entries(CURVES)) {
  for (const t of tenors) {
    if (cc === "US") add(`YD.US${t}`, { p: "fred", s: { series: UST[t] } });
    add(`YD.${cc}${t}`, { p: "eodhd", s: `${cc}${t}Y.GBOND` });
  }
}
add("YD.US3M", { p: "fred", s: { series: "DGS3MO" } }, { p: "eodhd", s: "US3M.GBOND" });
add("YD.US1Y", { p: "fred", s: { series: "DGS1" } }, { p: "eodhd", s: "US1Y.GBOND" });

// --- Spreads and money markets (FRED) ---
add("SP.HYOAS", { p: "fred", s: { series: "BAMLH0A0HYM2" } });
add("SP.IGOAS", { p: "fred", s: { series: "BAMLC0A0CM" } });
add("MM.SOFR", { p: "fred", s: { series: "SOFR" } });

// --- Commodities: FMP continuous futures; EODHD spot metals; FRED spot energy ---
const CMD_FMP: Record<string, string> = {
  GC1: "GCUSD", SI1: "SIUSD", PL1: "PLUSD", PA1: "PAUSD", HG1: "HGUSD", CL1: "CLUSD", CO1: "BZUSD", NG1: "NGUSD",
  ZC1: "ZCUSX", ZW1: "ZWUSX", ZS1: "ZSUSX", KC1: "KCUSX", RB1: "RBUSD", HO1: "HOUSD", SB1: "SBUSX", CC1: "CCUSD",
  CT1: "CTUSX", LE1: "LEUSX",
};
for (const [tk, s] of Object.entries(CMD_FMP)) add(`CM.${tk}`, { p: "fmp", s });
add("CM.CL1", { p: "fred", s: { series: "DCOILWTICO" }, note: "WTI spot (Cushing)" });
add("CM.CO1", { p: "fred", s: { series: "DCOILBRENTEU" }, note: "Brent spot (Europe)" });
add("CM.NG1", { p: "fred", s: { series: "DHHNGSP" }, note: "Henry Hub spot" });
add("CM.XAU", { p: "eodhd", s: "XAUUSD.FOREX" }, { p: "fmp", s: "XAUUSD" });

// --- Economic indicators (FRED). Dated at period end, like the app's own series. ---
add("EC.USCPI", { p: "fred", s: { series: "CPIAUCSL", units: "pc1", period: "M" } });
add("EC.USCPCE", { p: "fred", s: { series: "PCEPILFE", units: "pc1", period: "M" } });
add("EC.USUR", { p: "fred", s: { series: "UNRATE", period: "M" } });
add("EC.USNFP", { p: "fred", s: { series: "PAYEMS", units: "chg", period: "M" } });
add("EC.FEDF", { p: "fred", s: { series: "DFEDTARU", frequency: "m", aggregation: "eop", period: "M" } });
add("EC.USGDP", { p: "fred", s: { series: "A191RL1Q225SBEA", period: "Q" } });
add("EC.UKCPI", { p: "fred", s: { series: "GBRCPIALLMINMEI", units: "pc1", period: "M" } });
add("EC.EAHICP", { p: "fred", s: { series: "CP0000EZ19M086NEST", units: "pc1", period: "M" } });
add("EC.JPCPI", { p: "fred", s: { series: "JPNCPIALLMINMEI", units: "pc1", period: "M" } });
add("EC.INCPI", { p: "fred", s: { series: "INDCPIALLMINMEI", units: "pc1", period: "M" } });

export const INSTRUMENT_SOURCES: Readonly<Record<string, Source[]>> = MAP;

/** NGX listings kept by the data desk (adm_inst/AD.NG.<TICKER>) are priced from these, in order. */
export const NGX_SOURCES: ProviderId[] = ["ngxpulse", "mansa", "mystocks", "africa"];

/** DXY = 50.14348112 × EURUSD^-0.576 × USDJPY^0.136 × GBPUSD^-0.119 × USDCAD^0.091 × USDSEK^0.042 × USDCHF^0.036 */
export function dxy(r: Partial<Record<"EURUSD" | "USDJPY" | "GBPUSD" | "USDCAD" | "USDSEK" | "USDCHF", number>>): number | null {
  const { EURUSD, USDJPY, GBPUSD, USDCAD, USDSEK, USDCHF } = r;
  if (!EURUSD || !USDJPY || !GBPUSD || !USDCAD || !USDSEK || !USDCHF) return null;
  return 50.14348112 * EURUSD ** -0.576 * USDJPY ** 0.136 * GBPUSD ** -0.119 * USDCAD ** 0.091 * USDSEK ** 0.042 * USDCHF ** 0.036;
}
