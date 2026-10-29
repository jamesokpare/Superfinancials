// Test of src/lib/health: stale, empty, missing and healthy syncs.
// Run: npm test
import { checkSyncHealth } from "../src/lib/health";
import { memoryStore } from "../src/lib/market/store";

let fails = 0;
const t = (label: string, ok: boolean, info?: unknown) => { if (!ok) fails++; console.log((ok ? "PASS " : "FAIL ") + label, ok ? "" : JSON.stringify(info)); };
const NOW = new Date("2026-11-02T09:17:00Z"); // a Monday morning
const store = memoryStore({
  mkt: [{ id: "_meta", data: { type: "meta", checked: "2026-10-30T22:31:00Z", n: 250, resolved: 231, note: "API sync 2026-10-30" } }], // Friday night: 59 h
  mktnews: [{ id: "_meta", data: { type: "meta", checked: "2026-10-31T16:46:00Z", n: 120, note: "News sync" } }],                 // 40 h: stale
  fund: [{ id: "_meta", data: { type: "meta", checked: "2026-11-02T05:41:00Z", n: 0, note: "Fundamentals sync: 0 companies" } }], // ran, no data
});
const rows = await checkSyncHealth(store, NOW); const by = Object.fromEntries(rows.map((r) => [r.sync, r]));
t("market prices: Friday's run is fine on Monday", by["Market prices"].ok, by["Market prices"]);
t("news: 40 hours old is stale", !by.News.ok && /41 h ago \(limit 26 h\)/.test(by.News.detail), by.News);
t("fundamentals: ran but produced nothing", !by.Fundamentals.ok && /no data/.test(by.Fundamentals.detail), by.Fundamentals);
const none = await checkSyncHealth(memoryStore(), NOW);
t("never run", none.every((r) => !r.ok && /never run/.test(r.detail)), none);
const stale = await checkSyncHealth(memoryStore({ mkt: [{ id: "_meta", data: { checked: "2026-10-28T22:45:00Z", n: 157, note: "desk" } }] }), NOW);
t("market prices: 4.5 days old is stale", !stale.find((r) => r.sync === "Market prices")!.ok);
console.log(fails ? `\n${fails} sync-health test(s) failed` : "\nAll sync-health tests passed");
process.exit(fails ? 1 : 0);
