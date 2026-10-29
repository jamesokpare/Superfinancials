// Unit test for src/lib/claude-shim/db.ts against an in-memory fake of supabase-js.
// Run: npm test
import { createDb } from "../src/lib/claude-shim/db";

type Row = { path: string; parent: string; id: string; data: Record<string, unknown> };
const table = new Map<string, Row>();
let rt: ((p: { new: Partial<Row>; old: Partial<Row> }) => void) | null = null;
const fire = (n: Partial<Row>, o: Partial<Row>) => setTimeout(() => rt?.({ new: n, old: o }), 5);

function from() {
  const f: { eq: [string, string][] } = { eq: [] };
  let range: [number, number] | null = null;
  const run = () => [...table.values()].filter((r) => f.eq.every(([k, v]) => (r as never)[k] === v)).sort((a, b) => (a.id < b.id ? -1 : 1));
  const b = {
    select() { return b; },
    eq(k: string, v: string) { f.eq.push([k, v]); return b; },
    order() { return b; },
    range(a: number, z: number) { range = [a, z]; return b; },
    async maybeSingle() { return { data: run()[0] ?? null, error: null }; },
    then(res: (v: unknown) => void) { const r = run(); res({ data: range ? r.slice(range[0], range[1] + 1) : r, error: null }); },
    async upsert(row: Row) { table.set(row.path, row); fire(row, {}); return { error: null }; },
    delete() { return { eq: async (_k: string, v: string) => { table.delete(v); fire({}, { path: v }); return { error: null }; } }; },
  };
  return b;
}
const sb = {
  from,
  async rpc(_n: string, a: { p_path: string; p_patch: Record<string, unknown> }) {
    const r = table.get(a.p_path);
    if (!r) return { error: { code: "P0002", message: "missing" } };
    r.data = { ...r.data, ...a.p_patch }; fire(r, {}); return { error: null };
  },
  channel() { const c = { on(_t: string, _f: unknown, cb: typeof rt) { rt = cb; return c; }, subscribe() { return c; } }; return c; },
};

const db = createDb(sb as never);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const t = (label: string, got: unknown, want: unknown) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log((ok ? "PASS " : "FAIL ") + label, ok ? "" : JSON.stringify(got)); };

(async () => {
  await db.doc("posts/u1/items/p1").set({ text: "a", createdAt: 1, orgId: "o1" });
  await db.doc("posts/u1/items/p2").set({ text: "b", createdAt: 3, orgId: "o2" });
  await db.collection("posts/u1/items").add({ text: "c", createdAt: 2, orgId: "o1" });
  t("doc get", (await db.doc("posts/u1/items/p1").get()).data(), { text: "a", createdAt: 1, orgId: "o1" });
  t("missing doc", (await db.doc("posts/u1/items/zz").get()).exists, false);
  const q = await db.collection("posts/u1/items").orderBy("createdAt", "desc").limit(2).get();
  t("orderBy desc + limit", q.docs.map((d) => d.data()!.text), ["b", "c"]);
  t("where ==", (await db.collection("posts/u1/items").where("orgId", "==", "o1").get()).size, 2);
  t("where in", (await db.collection("posts/u1/items").where("createdAt", "in", [1, 3]).get()).size, 2);
  t("doc().collection()", db.doc("orgs/o1").collection("members").path, "orgs/o1/members");
  let threw = false; try { db.doc("orgs"); } catch { threw = true; } t("odd doc path rejected", threw, true);
  let uerr: unknown = null; await db.doc("orgs/nope").update({ a: 1 }).catch((e) => (uerr = e)); t("update missing → invalid_argument", (uerr as { code: string }).code, "invalid_argument");

  const seen: string[][] = [];
  const changes: string[] = [];
  const off = db.collection("posts/u1/items").where("orgId", "==", "o1").orderBy("createdAt").onSnapshot((s) => { seen.push(s.docs.map((d) => d.data()!.text as string)); s.docChanges().forEach((c) => changes.push(c.type + ":" + c.doc.id)); });
  const docSeen: unknown[] = [];
  const offD = db.doc("posts/u1/items/p1").onSnapshot((s) => docSeen.push(s.exists ? s.data()!.text : null));
  await sleep(30);
  await db.doc("posts/u1/items/p4").set({ text: "d", createdAt: 0, orgId: "o1" });
  await sleep(30);
  await db.doc("posts/u1/items/p1").update({ text: "a2" });
  await sleep(30);
  await db.doc("posts/u1/items/p2").set({ text: "b", createdAt: 3, orgId: "o2" }); // not matching filter
  await sleep(30);
  await db.doc("posts/u1/items/p1").delete();
  await sleep(30);
  off(); offD();
  await db.doc("posts/u1/items/p5").set({ text: "e", createdAt: 9, orgId: "o1" });
  await sleep(30);
  t("query snapshots", seen, [["a", "c"], ["d", "a", "c"], ["d", "a2", "c"], ["d", "c"]]);
  t("doc snapshots", docSeen, ["a", "a2", null]);
  t("docChanges include removed", changes.includes("removed:p1") && changes.includes("added:p4"), true);
  console.log(fails ? `${fails} FAILED` : "all passed");
  if (fails) process.exit(1);
})();
