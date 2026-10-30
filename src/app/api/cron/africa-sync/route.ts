/**
 * GET /api/cron/africa-sync — NGX market snapshot, corporate disclosures,
 * company news, dividends and African elections (see src/lib/africa/sync.ts).
 * Called by Vercel Cron (vercel.json); needs `Authorization: Bearer <CRON_SECRET>`.
 *   ?dry=1   fetch and report without writing
 */
import { cronGuard } from "@/lib/auth/cron";
import { runAfricaSync } from "@/lib/africa/sync";

export const maxDuration = 300;

export async function GET(req: Request) {
  const denied = cronGuard(req); if (denied) return denied;
  const sp = new URL(req.url).searchParams;
  try {
    const report = await runAfricaSync({ dryRun: sp.get("dry") === "1" });
    return Response.json(report, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return Response.json({ code: "sync_failed", message: (e as Error).message }, { status: 500 });
  }
}
