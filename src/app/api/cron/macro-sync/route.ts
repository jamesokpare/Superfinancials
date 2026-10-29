/**
 * GET /api/cron/macro-sync — pulls free official macro data (World Bank, BIS,
 * ECB, OECD) and calendar events (FRED release dates, U.S. Treasury auctions)
 * into the data desk's collections (see src/lib/macro/sync.ts).
 *
 * Called daily by Vercel Cron (vercel.json) with `Authorization: Bearer <CRON_SECRET>`.
 *   ?dry=1                 fetch and report without writing
 *   ?only=bis,ecb          limit to some sources
 */
import { cronGuard } from "@/lib/auth/cron";
import { runMacroSync, type MacroSourceId } from "@/lib/macro/sync";

export const maxDuration = 300;

export async function GET(req: Request) {
  const denied = cronGuard(req); if (denied) return denied;
  const sp = new URL(req.url).searchParams;
  try {
    const report = await runMacroSync({ dryRun: sp.get("dry") === "1", only: sp.get("only")?.split(",").map((s) => s.trim()).filter(Boolean) as MacroSourceId[] | undefined });
    return Response.json(report, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return Response.json({ code: "sync_failed", message: (e as Error).message }, { status: 500 });
  }
}
