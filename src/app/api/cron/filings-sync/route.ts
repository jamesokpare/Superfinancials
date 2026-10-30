/**
 * GET /api/cron/filings-sync — SEC EDGAR filings and earnings press releases for
 * the app's U.S. equities (see src/lib/filings/sync.ts).
 * Called by Vercel Cron (vercel.json); needs `Authorization: Bearer <CRON_SECRET>`.
 *   ?dry=1   fetch and report without writing
 */
import { cronGuard } from "@/lib/auth/cron";
import { runFilingsSync } from "@/lib/filings/sync";

export const maxDuration = 300;

export async function GET(req: Request) {
  const denied = cronGuard(req); if (denied) return denied;
  try {
    const report = await runFilingsSync({ dryRun: new URL(req.url).searchParams.get("dry") === "1" });
    return Response.json(report, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return Response.json({ code: "sync_failed", message: (e as Error).message }, { status: 500 });
  }
}
