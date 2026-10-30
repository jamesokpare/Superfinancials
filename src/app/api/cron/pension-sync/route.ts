/**
 * GET /api/cron/pension-sync — fund-level private-markets performance reported by
 * CalPERS, the Washington State Investment Board and Oregon Treasury (see
 * src/lib/pensions/sync.ts).
 * Called by Vercel Cron (vercel.json); needs `Authorization: Bearer <CRON_SECRET>`.
 *   ?dry=1                 fetch and report without writing
 *   ?only=calpers,wsib     only these pensions
 */
import { cronGuard } from "@/lib/auth/cron";
import { runPensionSync } from "@/lib/pensions/sync";
import type { Pension } from "@/lib/pensions";

export const maxDuration = 300;

export async function GET(req: Request) {
  const denied = cronGuard(req); if (denied) return denied;
  const q = new URL(req.url).searchParams;
  const only = q.get("only")?.split(",").filter((x): x is Pension => ["calpers", "wsib", "oregon"].includes(x));
  try {
    return Response.json(await runPensionSync({ dryRun: q.get("dry") === "1", only: only?.length ? only : undefined }), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return Response.json({ code: "sync_failed", message: (e as Error).message }, { status: 500 });
  }
}
