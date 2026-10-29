/**
 * GET /api/cron/market-sync — pulls end-of-day prices from the configured data
 * providers into the app (see src/lib/market/sync.ts).
 *
 * Called by Vercel Cron (vercel.json) after the U.S. close on weekdays. Vercel
 * sends `Authorization: Bearer <CRON_SECRET>`; any other caller needs the same.
 *   ?dry=1               fetch and report without writing
 *   ?only=EQ.AAPL,NGX    limit to some instruments
 */
import { cronGuard } from "@/lib/auth/cron";
import { runMarketSync } from "@/lib/market/sync";

export const maxDuration = 300;

export async function GET(req: Request) {
  const denied = cronGuard(req); if (denied) return denied;
  const sp = new URL(req.url).searchParams;
  try {
    const report = await runMarketSync({ dryRun: sp.get("dry") === "1", only: sp.get("only")?.split(",").map((s) => s.trim()).filter(Boolean) });
    return Response.json(report, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return Response.json({ code: "sync_failed", message: (e as Error).message }, { status: 500 });
  }
}
