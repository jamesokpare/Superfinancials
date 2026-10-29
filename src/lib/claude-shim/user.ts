/**
 * The artifact runtime's `user` capability on Supabase Auth + `profiles`.
 * "Owner" (the artifact owner, who may edit admin content) = profiles.is_admin.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

type ProfileRow = { id: string; name: string | null; avatar_url: string | null; color: string | null; is_admin?: boolean };
export type Profile = { id: string; name: string; avatarUrl: string; color: string; email: string | null; isMe: boolean; guest: boolean };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createUser(sb: SupabaseClient) {
  const cache = new Map<string, Profile>();

  async function session() {
    const { data } = await sb.auth.getSession();
    return data.session;
  }
  async function myRow(): Promise<ProfileRow | null> {
    const s = await session();
    if (!s) return null;
    const { data } = await sb.from("profiles").select("id,name,avatar_url,color,is_admin").eq("id", s.user.id).maybeSingle();
    return (data as ProfileRow) ?? { id: s.user.id, name: (s.user.user_metadata?.name as string) || "", avatar_url: null, color: "#2B5F93", is_admin: false };
  }
  const toProfile = (r: ProfileRow, me: string | null): Profile => ({
    id: r.id, name: r.name || "", avatarUrl: r.avatar_url || "", color: r.color || "#6B7280", email: null, isMe: r.id === me, guest: false,
  });

  return Object.freeze({
    async id() { return (await session())?.user.id ?? null; },
    async isOwner() { return !!(await myRow())?.is_admin; },
    async canEdit() { return !!(await myRow())?.is_admin; },
    async can(name: string) {
      if (name === "data.write") return !!(await session());
      return null;
    },
    async me() {
      const s = await session();
      const r = await myRow();
      return {
        id: s?.user.id ?? null,
        name: r?.name || "",
        avatarUrl: r?.avatar_url || "",
        color: r?.color || "#6B7280",
        email: s?.user.email ?? null,
        isOwner: !!r?.is_admin,
        canEdit: !!r?.is_admin,
      };
    },
    async name() { return (await myRow())?.name || ""; },
    async avatarUrl() { return (await myRow())?.avatar_url || null; },
    async email() { return (await session())?.user.email ?? null; },
    async profiles(ids: readonly string[] | string) {
      const list = [...new Set(typeof ids === "string" ? [ids] : ids)];
      const me = (await session())?.user.id ?? null;
      const missing = list.filter((i) => !cache.has(i) && UUID.test(i));
      if (missing.length) {
        const { data } = await sb.from("profiles").select("id,name,avatar_url,color").in("id", missing);
        (data as ProfileRow[] | null)?.forEach((r) => cache.set(r.id, toProfile(r, me)));
      }
      const out: Record<string, Profile> = {};
      list.forEach((i) => { const p = cache.get(i); if (p) out[i] = { ...p, isMe: i === me }; });
      return out;
    },
    async search(q: string) {
      const me = (await session())?.user.id ?? null;
      let req = sb.from("profiles").select("id,name,avatar_url,color").order("name").limit(20);
      if (q.trim()) req = req.ilike("name", `%${q.trim().replace(/[%_]/g, "")}%`);
      const { data } = await req;
      return ((data as ProfileRow[] | null) ?? []).map((r) => toProfile(r, me));
    },
  });
}
