/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures are read loosely in assertions */
// End-to-end test of src/lib/africa with fake Mansa, NGX Pulse, MyStocks
// Africa and Africa API responses and an in-memory docs table: the NGX
// snapshot, disclosures, company news, dividends, elections, owner documents
// left alone, rotation, clean-up, failures and dry runs.
// Run: npm test
import { runAfricaSync, GEN, readMarket, readIntel } from "../src/lib/africa/sync";
import { africanCode, isoDate, num, readMover } from "../src/lib/africa/read";
import { facts, rankedLists } from "../src/lib/africa/country";
import { memoryStore } from "../src/lib/market/store";

process.env.MANSA_API_KEY = "mansa_live_sk_test"; process.env.NGX_PULSE_API_KEY = "ngxpulse_sk_test";
process.env.MYSTOCKS_AFRICA_API_KEY = "pk_live_test"; process.env.AFRICA_API_KEY = "afr_test";
const NOW = new Date("2026-10-30T17:10:00Z");
let mansaDown = false; const seen: string[] = [];

globalThis.fetch = (async (input: string | URL | Request) => {
  const url = new URL(input instanceof Request ? input.url : String(input)); const p = url.pathname; seen.push(url.hostname + p + url.search);
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
  if (url.hostname === "ngxpulse.ng") {
    if (p === "/api/ngxdata/market") return json({ data: { asi: 151234.56, asi_change_percent: -0.42, market_cap: "95,400,000,000,000", volume: 512345678, value: 12500000000, deals: 14321 } });
    if (p === "/api/ngxdata/market-status") return json({ status: "closed" });
    if (p === "/api/ngxdata/stocks") return json({ stocks: [
      { symbol: "MTNN", name: "MTN Nigeria", current_price: 250, change_percent: 2.5, volume: 4_000_000 },
      { symbol: "DANGCEM", name: "Dangote Cement", current_price: 480, change_percent: -1.2, volume: 900_000 },
      { symbol: "ZENITHBANK", name: "Zenith Bank", current_price: 45.1, change_percent: 0, volume: 30_000_000 },
    ] });
    if (p === "/api/ngxdata/disclosures") return json({ data: [
      { title: "Notice of Board Meeting", company_name: "MTN Nigeria Communications Plc", symbol: "MTNN", date: "2026-10-29T10:00:00Z", url: "https://ngxgroup.com/doc/1.pdf", type: "Board meeting" },
      { title: "Unaudited Q3 results", company: "Dangote Cement Plc", date: "29/10/2026", link: "javascript:alert(1)" },
      { title: "Old circular", date: "2026-01-02" },
      { title: "No date" },
    ] });
    if (p === "/api/nasddata/stocks") return json([{ symbol: "FRIESLAND", name: "FrieslandCampina WAMCO", price: "₦62.00", change: "2.00" }]);
  }
  if (url.hostname === "www.mansaapi.com") {
    if (mansaDown) return json({ success: false, error: { code: "rate_limited", message: "slow down" } }, 429);
    if (p === "/api/v1/markets/exchanges/nigeria/movers") return json({ success: true, data: url.searchParams.get("type") === "gainers"
      ? [{ ticker: "MTNN", name: "MTN Nigeria", price: 250, change_percent: "9.95%" }, { ticker: "OKOMUOIL", price: 900, change_percent: 5 }]
      : [{ ticker: "DANGCEM", price: 480, change_percent: -4.1 }] });
    if (p === "/api/v1/markets/movers/pan-african") return json({ success: true, data: [{ ticker: "SCOM", name: "Safaricom", exchange: "NSE Kenya", price: 18.2, change_percent: 3.1 }] });
    if (p === "/api/v1/markets/exchanges/nigeria/etfs") return json({ success: true, data: [{ ticker: "STANBICETF30", name: "Stanbic IBTC ETF 30", nav: 512.3, change_percent: 0.4 }] });
    if (p === "/api/v1/markets/exchanges/nigeria/disclosures") return json({ success: true, data: { disclosures: [
      { subject: "Notice of Board Meeting", company: "MTN Nigeria Communications Plc", date: "2026-10-29", url: "https://ngxgroup.com/doc/1.pdf" }, // same as NGX Pulse: merged
      { subject: "Interim dividend declared", company: "Zenith Bank Plc", ticker: "ZENITHBANK", date: "2026-10-28", url: "https://ngxgroup.com/doc/2.pdf" },
    ] } });
    if (p === "/api/v1/markets/exchanges/nigeria/dividends/MTNN") return json({ success: true, data: [
      { amount: 5.6, type: "Interim", qualification_date: "2026-11-12", payment_date: "2026-11-30" },
      { amount: 10, type: "Final", qualification_date: "2025-04-01", payment_date: "2025-05-01" }, // old: skipped
    ] });
    if (p.startsWith("/api/v1/markets/exchanges/nigeria/dividends/")) return json({ success: false, error: { code: "not_found", message: "none" } }, 404);
  }
  if (url.hostname === "mystocks.africa") {
    if (p === "/api/v1/partner/market-intel") return json({ data: { summary: "Banking stocks led the market higher as investors rotated into tier-one lenders ahead of results.", sectors: [{ sector: "Banking", change_percent: 1.8 }, { sector: "Industrial", change_percent: -0.6 }] } });
    if (/\/stocks\/[A-Z]+\/pulse$/.test(p)) { const tk = p.split("/")[5]; return json({ data: tk === "MTNN" ? [
      { title: "MTN Nigeria posts record data revenue", url: "https://news.example.com/mtn", published_at: "2026-10-29T08:00:00Z", source: { name: "BusinessDay" }, summary: "Data revenue rose 40%." },
      { title: "Old story", url: "https://news.example.com/old", published_at: "2026-08-01T08:00:00Z" },
    ] : [] }); }
  }
  if (url.hostname === "api.africa-api.com") {
    if (p === "/v1/elections/upcoming") return json({ data: [
      { country_code: "CIV", type: "Presidential", date: "2027-10-25" },
      { country: "Kenya", election_type: "General election", election_date: "2027-08-10" },
      { country_code: "NGA", type: "Governorship", date: "2025-01-01" }, // past: skipped
      { country_code: "FRA", type: "Presidential", date: "2027-04-10" }, // not African: skipped
    ] });
  }
  return json({ error: "not mocked: " + p }, 404);
}) as typeof fetch;

let fails = 0;
const t = (label: string, ok: boolean, info?: unknown) => { if (!ok) fails++; console.log((ok ? "PASS " : "FAIL ") + label, ok ? "" : JSON.stringify(info)); };

// --- readers ---
t("num reads ₦, %, commas", num("₦1,234.50") === 1234.5 && num("9.95%") === 9.95 && num("abc") === null && num("NGN 5") === 5);
t("isoDate reads ISO, DD/MM/YYYY and epochs", isoDate("29/10/2026") === "2026-10-29" && isoDate(1793318400) === "2026-10-30" && isoDate("2026-10-29T10:00:00Z") === "2026-10-29" && isoDate("") === null);
t("africanCode from alpha-2, alpha-3 and names", africanCode("CIV") === "CI" && africanCode("Kenya") === "KE" && africanCode("ng") === "NG" && africanCode("FRA") === null && africanCode("Cote d'Ivoire") === "CI");
const mv = readMover({ symbol: "x", price: 110, change: 10 });
t("mover: % change from price and change", mv?.tk === "X" && mv.chp === 10, mv);
const mk = readMarket({ data: { asi: 100000, asi_change_percent: "-0.5", market_cap: 5e13 } }, { is_open: false }, "NGX Pulse");
t("market summary: negative change and status", mk?.chp === -0.5 && mk.status === "Closed" && mk.mcap === 5e13, mk);
t("intel: text and sectors", readIntel({ summary: "Short" }) === null && readIntel({ data: { commentary: "A long enough market commentary about NGX stocks.", sector_performance: [{ name: "Oil", chp: 2 }] } })?.sectors[0].name === "Oil");
const fx = facts({ id: 7, name: "Nigeria", capital: "Abuja", gdp_usd: 3.6e11, flag_url: "https://x/flag.png", economy: { currency: "NGN", inflation_rate: 22.1 } });
t("country facts: labels, nested values, ids and links skipped", fx.some((f) => f.label === "Capital" && f.v === "Abuja") && fx.some((f) => f.label === "GDP USD") && fx.some((f) => f.label === "Economy inflation rate") && !fx.some((f) => /flag|Id/.test(f.label)), fx);
const rl = rankedLists({ data: { top_export_partners: [{ partner: "India", value: 9e9 }, { partner: "Spain", value: 6e9, share: 12 }], years: [2024] } });
t("trade lists ranked", rl[0]?.title === "Top export partners" && rl[0].rows[0].name === "India" && rl[0].rows[1].share === 12, rl);

// --- a full run ---
const store = memoryStore({
  adm_inst: [
    { id: "AD.NG.MTNN", data: { kind: "inst", id: "AD.NG.MTNN", meta: { exch: "NGX", tk: "MTNN", name: "MTN Nigeria Communications Plc" }, d: [], c: [] } },
    { id: "AD.NG.ZENITHBANK", data: { kind: "inst", id: "AD.NG.ZENITHBANK", meta: { exch: "NGX", tk: "ZENITHBANK", name: "Zenith Bank Plc" }, d: [], c: [] } },
  ],
  adm_news: [
    { id: "own-1", data: { title: "Owner story", date: "2026-10-01", cc: ["NG"] } },
    { id: "auto-ngxd-oldstale", data: { title: "Ancient", date: "2026-03-01", gen: GEN } },
  ],
  adm_cal: [
    { id: "auto-elec-GH-2027-12-07-presidential", data: { title: "Ghana: Presidential election", date: "2027-12-07", gen: GEN } }, // no longer listed: removed
    { id: "auto-ngxdiv-ZENITHBANK-2026-11-20", data: { title: "Zenith dividend", date: "2026-11-20", gen: GEN } },             // listing fetched, not listed: removed
    { id: "auto-elec-KE-2027-08-10-general", data: { title: "Owner's own", date: "2027-08-10", gen: "owner" } },               // owner's: kept as is
  ],
});
const r = await runAfricaSync({ store, now: NOW, newsBudget: 5, divBudget: 5 });
const db = store.dump(); const afr = Object.fromEntries(db.afr.map((d) => [d.id, d.data])) as Record<string, any>;
const snap = afr.ngx;
t("snapshot: market summary from NGX Pulse", snap.market.asi === 151234.56 && snap.market.chp === -0.42 && snap.market.mcap === 95.4e12 && snap.market.deals === 14321 && snap.market.status === "Closed" && snap.src.market === "NGX Pulse", snap.market);
t("snapshot: breadth from the full list", snap.market.adv === 1 && snap.market.dec === 1 && snap.market.unch === 1, snap.market);
t("snapshot: movers from Mansa", snap.gainers[0].tk === "MTNN" && snap.gainers[0].chp === 9.95 && snap.losers[0].tk === "DANGCEM" && snap.src.gainers === "Mansa API", { g: snap.gainers, l: snap.losers });
t("snapshot: most active by volume", snap.active[0].tk === "ZENITHBANK" && snap.active.length === 3, snap.active);
t("snapshot: pan-African, ETFs, NASD, intel", snap.pan[0].ex === "NSE Kenya" && snap.etfs[0].c === 512.3 && snap.nasd[0].c === 62 && snap.nasd[0].chp === 3.33 && snap.intel.sectors.length === 2 && /Banking stocks/.test(snap.intel.text[0]), snap);
const news = Object.fromEntries(db.adm_news.map((d) => [d.id, d.data])) as Record<string, any>;
const disc = Object.values(news).filter((x) => x.cat === "Corporate disclosure");
t("disclosures: merged across sources, old and undated skipped", disc.length === 3, disc.map((x) => x.title));
const mtn = disc.find((x) => /Board Meeting/.test(x.title));
t("disclosure linked to the listing, with company name and link", mtn?.ids[0] === "AD.NG.MTNN" && mtn.title.startsWith("MTN Nigeria Communications Plc: ") && mtn.url === "https://ngxgroup.com/doc/1.pdf" && mtn.cc[0] === "NG" && mtn.gen === GEN, mtn);
const dcm = disc.find((x) => /Q3/.test(x.title));
t("unsafe links dropped; unknown company not linked", dcm?.url === "" && dcm.ids.length === 0 && dcm.date === "2026-10-29", dcm);
t("dividend disclosure is high importance", disc.find((x) => /dividend/i.test(x.title))?.imp === 3);
const cn = Object.values(news).filter((x) => x.cat === "Company news");
t("company news: recent items only, source named, linked", cn.length === 1 && cn[0].srcName === "BusinessDay (via MyStocks Africa)" && cn[0].ids[0] === "AD.NG.MTNN", cn);
t("owner news kept; old auto news removed", news["own-1"]?.title === "Owner story" && !news["auto-ngxd-oldstale"]);
const cal = Object.fromEntries(db.adm_cal.map((d) => [d.id, d.data])) as Record<string, any>;
const q = cal["auto-ngxdiv-MTNN-2026-11-12"], pay = cal["auto-ngxdiv-MTNN-2026-11-30-pay"];
t("dividends: qualification and payment dates", q?.cat === "div" && q.actual === "₦5.6 per share" && /Interim dividend: qualification date/.test(q.title) && pay?.date === "2026-11-30" && q.ids[0] === "AD.NG.MTNN", { q, pay });
t("old dividends skipped", !Object.keys(cal).some((k) => k.includes("2025")));
t("elections: African, upcoming, high importance", cal["auto-elec-CI-2027-10-25-presidential"]?.imp === 3 && cal["auto-elec-CI-2027-10-25-presidential"].title === "Côte d'Ivoire: Presidential election" && !Object.keys(cal).some((k) => k.includes("FR") || k.includes("2025-01-01")), Object.keys(cal));
t("owner event with the same id is left alone", cal["auto-elec-KE-2027-08-10-general"]?.title === "Owner's own", cal["auto-elec-KE-2027-08-10-general"]);
t("upcoming auto events no longer listed are removed", !cal["auto-elec-GH-2027-12-07-presidential"] && !cal["auto-ngxdiv-ZENITHBANK-2026-11-20"]);
t("meta: summary, count and rotation state", afr._meta.n > 10 && /disclosures/.test(afr._meta.note) && afr._meta.state.divCursor === 0 && typeof afr._meta.sources.elections.n === "number", afr._meta);

// --- a failing source keeps its earlier snapshot section ---
mansaDown = true;
const r2 = await runAfricaSync({ store, now: new Date("2026-10-31T17:10:00Z"), only: ["pan-african", "etfs"] });
const snap2 = Object.fromEntries(store.dump().afr.map((d) => [d.id, d.data])).ngx as any;
t("failed sources reported", !!r2.sources["pan-african"]?.error && /429/.test(r2.sources["pan-african"]!.error!), r2.sources);
t("earlier sections kept when a source fails", snap2.pan?.[0]?.tk === "SCOM" && snap2.at.pan === NOW.toISOString(), snap2.at);
mansaDown = false;

// --- missing keys are skipped, dry runs write nothing ---
delete process.env.AFRICA_API_KEY;
const empty = memoryStore();
const r3 = await runAfricaSync({ store: empty, now: NOW, dryRun: true });
t("missing key: source skipped", /AFRICA_API_KEY not set/.test(r3.sources.elections?.skipped ?? ""), r3.sources.elections);
t("without desk listings, news and dividends use the most traded NGX stocks", (r3.sources.dividends?.n ?? 0) === 2 && (r3.sources["company-news"]?.n ?? 0) === 1, r3.sources);
t("dry run writes nothing", Object.values(empty.dump()).every((c) => c.length === 0), empty.dump());
t("report note", /African markets sync 2026-10-30/.test(r.note) && r.news.written >= 4, r.note);

console.log(fails ? `\n${fails} africa-sync test(s) failed` : "\nAll africa-sync tests passed");
process.exit(fails ? 1 : 0);
