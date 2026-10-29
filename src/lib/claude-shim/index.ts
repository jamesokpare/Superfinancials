/**
 * Installs `window.claude.use(name)` — the claude.ai artifact runtime API the
 * legacy Superfinancials script was written against — backed by Supabase
 * (db, user, room, assets), the /api/ai route (sample) and the browser (downloads).
 *
 * Without Supabase env vars nothing is installed and the legacy app runs in
 * its original browser-only mode (local profiles, no cloud features).
 */
import { getSupabase } from "@/lib/supabase/client";
import { createDb } from "./db";
import { createUser } from "./user";
import { createRoom } from "./room";
import { createAssets, downloads } from "./files";
import { createSample } from "./sample";

declare global {
  interface Window {
    claude?: { use(name: string): Promise<unknown> };
    sfAuth?: { configured: boolean; goLogin(): void; signOut(): Promise<void> };
  }
}

export function installClaudeShim() {
  const sb = getSupabase();
  if (!sb || window.claude) return;

  const memo = new Map<string, Promise<unknown>>();
  const factories: Record<string, () => unknown | Promise<unknown>> = {
    db: () => createDb(sb),
    user: () => createUser(sb),
    room: () => createRoom(sb),
    assets: () => createAssets(sb),
    downloads: () => downloads,
    sample: () => createSample(sb),
  };
  /** room and assets need a signed-in user. db works signed out: public
   *  collections (prices, admin content) are readable, writes are refused by RLS. */
  const needsUser = new Set(["room", "assets"]);

  window.claude = Object.freeze({
    use(name: string) {
      if (!factories[name]) return Promise.resolve(null);
      if (!memo.has(name)) {
        memo.set(name, (async () => {
          if (needsUser.has(name)) {
            const { data } = await sb.auth.getSession();
            if (!data.session) { memo.delete(name); return null; }
          }
          try { return await factories[name](); } catch { memo.delete(name); return null; }
        })());
      }
      return memo.get(name)!;
    },
  });

  window.sfAuth = Object.freeze({
    configured: true,
    goLogin() {
      // Coming from the landing page (#welcome…), sign-in should open the dashboard.
      const hash = !location.hash || location.hash.startsWith("#welcome") ? "#overview" : location.hash;
      const next = location.pathname + hash;
      // Called from the legacy (non-React) script, so a full page load is intended.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      location.href = `/login?next=${encodeURIComponent(next)}`;
    },
    async signOut() { await sb.auth.signOut(); },
  });
}
