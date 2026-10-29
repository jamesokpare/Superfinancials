/**
 * Sync health: checks that each scheduled sync ran recently and produced data,
 * from the `_meta` doc each one writes. Used by `npm run sync:health` and the
 * "Sync health" GitHub Actions workflow, which fails (and so emails the repo
 * owner) when a sync is stale or empty.
 */
import "server-only";
import type { DocStore } from "@/lib/market/store";

export type HealthRow = { sync: string; ok: boolean; checked: string | null; ageHours: number | null; detail: string };

/** Max age per sync: prices run on weekdays (a Monday check sees Friday's run), news twice a day, fundamentals daily. */
export const LIMITS: { sync: string; col: string; maxHours: number; count: (m: Record<string, unknown>) => number }[] = [
  { sync: "Market prices", col: "mkt", maxHours: 80, count: (m) => Number(m.resolved ?? m.n ?? 0) },
  { sync: "News", col: "mktnews", maxHours: 26, count: (m) => Number(m.n ?? 0) },
  { sync: "Fundamentals", col: "fund", maxHours: 26, count: (m) => Number(m.n ?? 0) },
  { sync: "Macro data", col: "macrosync", maxHours: 50, count: (m) => Number(m.n ?? 0) },
];

export async function checkSyncHealth(store: DocStore, now = new Date()): Promise<HealthRow[]> {
  return Promise.all(LIMITS.map(async ({ sync, col, maxHours, count }) => {
    const meta = (await store.list(col)).find((d) => d.id === "_meta")?.data;
    if (!meta) return { sync, ok: false, checked: null, ageHours: null, detail: "has never run (no _meta doc)" };
    const t = Date.parse(String(meta.checked)); const age = Number.isFinite(t) ? (now.getTime() - t) / 36e5 : null;
    const n = count(meta); const note = String(meta.note ?? "").slice(0, 300);
    if (age === null) return { sync, ok: false, checked: null, ageHours: null, detail: "last run time unreadable" };
    if (age > maxHours) return { sync, ok: false, checked: String(meta.checked), ageHours: age, detail: `last ran ${age.toFixed(0)} h ago (limit ${maxHours} h). ${note}` };
    if (!(n > 0)) return { sync, ok: false, checked: String(meta.checked), ageHours: age, detail: `last run produced no data. ${note}` };
    return { sync, ok: true, checked: String(meta.checked), ageHours: age, detail: note };
  }));
}
