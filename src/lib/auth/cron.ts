import { timingSafeEqual } from "node:crypto";

/** Checks `Authorization: Bearer <CRON_SECRET>` (what Vercel Cron sends). Returns an error response, or null when allowed. */
export function cronGuard(req: Request): Response | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ code: "not_configured", message: "Set CRON_SECRET to enable scheduled syncs" }, { status: 503 });
  const got = req.headers.get("authorization") ?? ""; const want = `Bearer ${secret}`;
  const ok = got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want));
  return ok ? null : Response.json({ code: "unauthorized", message: "Bad or missing CRON_SECRET" }, { status: 401 });
}
