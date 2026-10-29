/**
 * The artifact runtime's `db` capability (a Firestore-style document store),
 * rebuilt on one Supabase table: `docs(path, parent, id, data)`.
 *
 * - A document path has an even number of segments ("orgs/u1/members/u2"),
 *   a collection path an odd number ("orgs/u1/members").
 * - `where` / `orderBy` / `limit` run in the browser over the whole
 *   collection, as the original store did (collections stay small).
 * - Live updates come from one Supabase Realtime subscription on `docs`.
 */
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";

type Data = Record<string, unknown>;
type DbError = { code: string; message: string };
type Meta = { fromCache: boolean; hasPendingWrites: boolean };
const META: Meta = { fromCache: false, hasPendingWrites: false };

export type DocumentSnapshot = {
  id: string;
  exists: boolean;
  data(): Data | undefined;
  metadata: Meta;
};
type DocumentChange = {
  type: "added" | "modified" | "removed";
  doc: DocumentSnapshot;
  oldIndex: number;
  newIndex: number;
};
type QuerySnapshot = {
  docs: DocumentSnapshot[];
  size: number;
  empty: boolean;
  docChanges(): DocumentChange[];
  metadata: Meta;
};
type Filter = { field: string; op: string; value: unknown };
type QueryState = { filters: Filter[]; order?: { field: string; dir: "asc" | "desc" }; limit?: number };

const SEG = /^[A-Za-z0-9_\-.~:@+]{1,200}$/;
const segs = (p: string) => p.split("/").filter(Boolean);
function checkPath(path: string, kind: "doc" | "collection") {
  const s = segs(path);
  const ok = s.length > 0 && s.every((x) => SEG.test(x)) && (kind === "doc" ? s.length % 2 === 0 : s.length % 2 === 1);
  if (!ok) throw err("invalid_argument", `Not a ${kind} path: ${path}`);
  return s.join("/");
}
const parentOf = (docPath: string) => segs(docPath).slice(0, -1).join("/");
const lastSeg = (p: string) => segs(p).at(-1) ?? "";
const err = (code: string, message: string): DbError => ({ code, message });
const newId = () => {
  const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const b = crypto.getRandomValues(new Uint8Array(20));
  return Array.from(b, (x) => a[x % a.length]).join("");
};
const clone = <T,>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

function snap(path: string, data: Data | null): DocumentSnapshot {
  const d = data ?? undefined;
  return { id: lastSeg(path), exists: data != null, data: () => clone(d), metadata: META };
}

/** Postgres / PostgREST failure → the error codes the app already handles. */
function mapErr(e: { code?: string; message?: string } | null): DbError {
  if (!e) return err("unavailable", "Unknown error");
  // 42501 = RLS refused; the original store reported refused writes as invalid_argument
  if (e.code === "42501" || /row-level security/i.test(e.message ?? "")) return err("invalid_argument", e.message ?? "Not permitted");
  if (e.code === "P0002") return err("invalid_argument", e.message ?? "Document does not exist");
  return err("unavailable", e.message ?? "Database unavailable");
}

/* ---------- filters (Firestore semantics, top-level fields) ---------- */
function cmp(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a == null) return 1; // missing sorts last
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function matches(d: Data, f: Filter): boolean {
  const v = d[f.field];
  switch (f.op) {
    case "==": return eq(v, f.value);
    case "!=": return v !== undefined && !eq(v, f.value);
    case "<": return v != null && cmp(v, f.value) < 0;
    case "<=": return v != null && cmp(v, f.value) <= 0;
    case ">": return v != null && cmp(v, f.value) > 0;
    case ">=": return v != null && cmp(v, f.value) >= 0;
    case "in": return Array.isArray(f.value) && f.value.some((x) => eq(v, x));
    case "not-in": return v !== undefined && Array.isArray(f.value) && !f.value.some((x) => eq(v, x));
    case "array-contains": return Array.isArray(v) && v.some((x) => eq(x, f.value));
    default: throw err("invalid_argument", `Unsupported operator ${f.op}`);
  }
}
function applyQuery(rows: Map<string, Data>, q: QueryState): [string, Data][] {
  let out = [...rows.entries()].filter(([, d]) => q.filters.every((f) => matches(d, f)));
  if (q.order) {
    const { field, dir } = q.order;
    out.sort((a, b) => (dir === "desc" ? -1 : 1) * cmp(a[1][field], b[1][field]) || (a[0] < b[0] ? -1 : 1));
  } else out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  if (q.limit) out = out.slice(0, q.limit);
  return out;
}

/* ---------- realtime fan-out ---------- */
type Change = { path: string; parent: string };
type Listener = (c: Change) => void;

export function createDb(sb: SupabaseClient) {
  const listeners = new Set<Listener>();
  let channel: RealtimeChannel | null = null;
  const ensureChannel = () => {
    if (channel) return;
    channel = sb
      .channel("sf-docs")
      .on("postgres_changes", { event: "*", schema: "public", table: "docs" }, (p) => {
        const row = (p.new && "path" in p.new ? p.new : p.old) as { path?: string } | undefined;
        if (!row?.path) return;
        const c = { path: row.path, parent: parentOf(row.path) };
        listeners.forEach((l) => l(c));
      })
      .subscribe();
  };
  const listen = (l: Listener) => {
    ensureChannel();
    listeners.add(l);
    return () => listeners.delete(l);
  };

  async function readDoc(path: string): Promise<Data | null> {
    const { data, error } = await sb.from("docs").select("data").eq("path", path).maybeSingle();
    if (error) throw mapErr(error);
    return (data?.data as Data) ?? null;
  }
  async function readCollection(parent: string): Promise<Map<string, Data>> {
    const m = new Map<string, Data>();
    const page = 1000;
    for (let from = 0; ; from += page) {
      const { data, error } = await sb.from("docs").select("id,data").eq("parent", parent).order("id").range(from, from + page - 1);
      if (error) throw mapErr(error);
      (data ?? []).forEach((r) => m.set(r.id as string, r.data as Data));
      if (!data || data.length < page) break;
    }
    return m;
  }

  function docRef(rawPath: string) {
    const path = checkPath(rawPath, "doc");
    return {
      id: lastSeg(path),
      path,
      async get() { return snap(path, await readDoc(path)); },
      async set(data: Data) {
        const { error } = await sb.from("docs").upsert({ path, parent: parentOf(path), id: lastSeg(path), data: clone(data) });
        if (error) throw mapErr(error);
      },
      async update(data: Data) {
        const { error } = await sb.rpc("docs_merge", { p_path: path, p_patch: clone(data) });
        if (error) throw mapErr(error);
      },
      async delete() {
        const { error } = await sb.from("docs").delete().eq("path", path);
        if (error) throw mapErr(error);
      },
      async acquire() { throw err("unavailable", "acquire() is not supported in this build"); },
      onSnapshot(next: (s: DocumentSnapshot) => void, onError?: (e: DbError) => void) {
        let live = true;
        let last: string | undefined; // skip deliveries that change nothing
        const load = () => readDoc(path).then((d) => {
          const sig = JSON.stringify(d);
          if (!live || sig === last) return;
          last = sig;
          next(snap(path, d));
        }, (e) => live && onError?.(e));
        load();
        const off = listen((c) => { if (c.path === path) load(); });
        return () => { live = false; off(); };
      },
      collection(sub: string) { return collRef(`${path}/${sub}`); },
    };
  }

  function query(parent: string, q: QueryState) {
    const self = {
      where(field: string, op: string, value: unknown) { return query(parent, { ...q, filters: [...q.filters, { field, op, value }] }); },
      orderBy(field: string, dir: "asc" | "desc" = "asc") { return query(parent, { ...q, order: { field, dir } }); },
      limit(n: number) { return query(parent, { ...q, limit: n }); },
      async get(): Promise<QuerySnapshot> {
        const docs = applyQuery(await readCollection(parent), q).map(([id, d]) => snap(`${parent}/${id}`, d));
        return { docs, size: docs.length, empty: !docs.length, docChanges: () => docs.map((doc, i) => ({ type: "added" as const, doc, oldIndex: -1, newIndex: i })), metadata: META };
      },
      onSnapshot(next: (s: QuerySnapshot) => void, onError?: (e: DbError) => void) {
        let live = true;
        let rows: Map<string, Data> | null = null;
        let prev: [string, Data][] = [];
        let first = true;
        const emit = () => {
          if (!rows) return;
          const cur = applyQuery(rows, q);
          const prevIdx = new Map(prev.map(([id], i) => [id, i]));
          const curIdx = new Map(cur.map(([id], i) => [id, i]));
          const changes: DocumentChange[] = [];
          prev.forEach(([id, d], i) => { if (!curIdx.has(id)) changes.push({ type: "removed", doc: snap(`${parent}/${id}`, d), oldIndex: i, newIndex: -1 }); });
          cur.forEach(([id, d], i) => {
            const o = prevIdx.get(id);
            if (o === undefined) changes.push({ type: "added", doc: snap(`${parent}/${id}`, d), oldIndex: -1, newIndex: i });
            else if (!eq(prev[o][1], d) || o !== i) changes.push({ type: "modified", doc: snap(`${parent}/${id}`, d), oldIndex: o, newIndex: i });
          });
          if (!first && !changes.length) return; // nothing visible changed
          first = false;
          prev = cur;
          const docs = cur.map(([id, d]) => snap(`${parent}/${id}`, d));
          next({ docs, size: docs.length, empty: !docs.length, docChanges: () => changes, metadata: META });
        };
        readCollection(parent).then((m) => { if (!live) return; rows = m; emit(); }, (e) => live && onError?.(e));
        const off = listen(async (c) => {
          if (c.parent !== parent || !rows) return;
          try {
            const d = await readDoc(c.path);
            if (!live || !rows) return;
            if (d) rows.set(lastSeg(c.path), d); else rows.delete(lastSeg(c.path));
            emit();
          } catch (e) { onError?.(e as DbError); }
        });
        return () => { live = false; off(); };
      },
    };
    return self;
  }

  function collRef(rawPath: string) {
    const path = checkPath(rawPath, "collection");
    return {
      ...query(path, { filters: [] }),
      path,
      doc(id?: string) { return docRef(`${path}/${id ?? newId()}`); },
      async add(data: Data) { const r = docRef(`${path}/${newId()}`); await r.set(data); return r; },
    };
  }

  return Object.freeze({ doc: docRef, collection: collRef });
}
