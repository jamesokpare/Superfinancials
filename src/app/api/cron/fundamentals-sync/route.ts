/**
 * GET /api/cron/fundamentals-sync — refreshes reported financials for the
 * app's U.S. equities (see src/lib/fundamentals/sync.ts).
 * Called by Vercel Cron (vercel.json); needs `Authorization: Bearer <CRON_SECRET>`.
 *   ?dry=1             fetch and report without writing
 *   ?only=AAPL,MSFT    limit to some tickers
 */
import { cronGuard } from "@/lib/auth/cron";
import { runFundamentalsSync } from "@/lib/fundamentals/sync";

export const maxDuration = 300;

export async function GET(req: Request) {
  const denied = cronGuard(req); if (denied) return denied;
  const sp = new URL(req.url).searchParams;
  try {
    const report = await runFundamentalsSync({ dryRun: sp.get("dry") === "1", only: sp.get("only")?.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean) });
    return Response.json(report, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return Response.json({ code: "sync_failed", message: (e as Error).message }, { status: 500 });
  }
}
