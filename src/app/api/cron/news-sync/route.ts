/**
 * GET /api/cron/news-sync — pulls recent headlines from Marketaux, NewsAPI.ai
 * and Currents for the Market news page (see src/lib/news/sync.ts).
 * Called by Vercel Cron (vercel.json); needs `Authorization: Bearer <CRON_SECRET>`.
 *   ?dry=1   fetch and report without writing
 */
import { cronGuard } from "@/lib/auth/cron";
import { runNewsSync } from "@/lib/news/sync";

export const maxDuration = 120;

export async function GET(req: Request) {
  const denied = cronGuard(req); if (denied) return denied;
  try {
    const report = await runNewsSync({ dryRun: new URL(req.url).searchParams.get("dry") === "1" });
    return Response.json(report, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return Response.json({ code: "sync_failed", message: (e as Error).message }, { status: 500 });
  }
}
