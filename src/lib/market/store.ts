/**
 * Server-side access to the app's `docs` table for the market sync.
 * Writes to shared collections (mkt, adm_inst) need admin rights, so this uses
 * either the Supabase service-role key or a direct DATABASE_URL connection,
 * both of which bypass row-level security. Never import this from client code.
 */
import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { sql } from "@/lib/db/postgres";

export type Doc = { id: string; data: Record<string, unknown> };

export interface DocStore {
  readonly kind: string;
  list(parent: string): Promise<Doc[]>;
  upsert(parent: string, docs: Doc[]): Promise<void>;
  remove(parent: string, ids: string[]): Promise<void>;
}

function supabaseStore(sb: SupabaseClient): DocStore {
  return {
    kind: "supabase",
    async list(parent) {
      const out: Doc[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await sb.from("docs").select("id, data").eq("parent", parent).order("id").range(from, from + 999);
        if (error) throw new Error(`read ${parent}: ${error.message}`);
        out.push(...(data as Doc[]));
        if (!data || data.length < 1000) return out;
      }
    },
    async upsert(parent, docs) {
      for (let i = 0; i < docs.length; i += 50) {
        const rows = docs.slice(i, i + 50).map((d) => ({ path: `${parent}/${d.id}`, parent, id: d.id, data: d.data }));
        const { error } = await sb.from("docs").upsert(rows);
        if (error) throw new Error(`write ${parent}: ${error.message}`);
      }
    },
    async remove(parent, ids) {
      if (!ids.length) return;
      const { error } = await sb.from("docs").delete().in("path", ids.map((id) => `${parent}/${id}`));
      if (error) throw new Error(`delete ${parent}: ${error.message}`);
    },
  };
}

function postgresStore(): DocStore {
  const db = sql();
  return {
    kind: "postgres",
    list: async (parent) => (await db<Doc[]>`select id, data from public.docs where parent = ${parent} order by id`).map((r) => ({ id: r.id, data: r.data })),
    async upsert(parent, docs) {
      for (const d of docs) {
        await db`insert into public.docs (path, parent, id, data) values (${`${parent}/${d.id}`}, ${parent}, ${d.id}, ${db.json(d.data as never)})
                 on conflict (path) do update set data = excluded.data`;
      }
    },
    async remove(parent, ids) {
      if (ids.length) await db`delete from public.docs where path in ${db(ids.map((id) => `${parent}/${id}`))}`;
    },
  };
}

/** Picks the service-role Supabase client when configured, else DATABASE_URL. */
export function openStore(): DocStore {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) return supabaseStore(createClient(url, key, { auth: { persistSession: false } }));
  if (process.env.DATABASE_URL) return postgresStore();
  throw new Error("Set SUPABASE_SERVICE_ROLE_KEY (with NEXT_PUBLIC_SUPABASE_URL) or DATABASE_URL so the market sync can write prices");
}

/** In-memory store for tests and dry runs. */
export function memoryStore(seed: Record<string, Doc[]> = {}): DocStore & { dump(): Record<string, Doc[]> } {
  const m = new Map<string, Map<string, Record<string, unknown>>>();
  for (const [p, docs] of Object.entries(seed)) m.set(p, new Map(docs.map((d) => [d.id, structuredClone(d.data)])));
  const col = (p: string) => { if (!m.has(p)) m.set(p, new Map()); return m.get(p)!; };
  return {
    kind: "memory",
    list: async (p) => [...(m.get(p) ?? [])].sort(([a], [b]) => (a < b ? -1 : 1)).map(([id, data]) => ({ id, data: structuredClone(data) })),
    upsert: async (p, docs) => { for (const d of docs) col(p).set(d.id, structuredClone(d.data)); },
    remove: async (p, ids) => { for (const id of ids) col(p).delete(id); },
    dump: () => Object.fromEntries([...m].map(([p, c]) => [p, [...c].map(([id, data]) => ({ id, data }))])),
  };
}
