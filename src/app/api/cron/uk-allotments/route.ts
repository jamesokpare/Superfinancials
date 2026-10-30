/**
 * GET /api/cron/uk-allotments — reads the Companies House filing stream for a few
 * minutes and keeps every new share allotment (SH01). See src/lib/ukstream/sync.ts.
 * Called by Vercel Cron (vercel.json); needs `Authorization: Bearer <CRON_SECRET>`.
 */
import { cronGuard } from "@/lib/auth/cron";
import { runUkAllotments } from "@/lib/ukstream/sync";

export const maxDuration = 300;

export async function GET(req: Request) {
  const denied = cronGuard(req); if (denied) return denied;
  try {
    return Response.json(await runUkAllotments({ dryRun: new URL(req.url).searchParams.get("dry") === "1" }), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return Response.json({ code: "sync_failed", message: (e as Error).message }, { status: 500 });
  }
}
