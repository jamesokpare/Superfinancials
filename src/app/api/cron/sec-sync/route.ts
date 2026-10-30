/**
 * GET /api/cron/sec-sync — SEC XBRL frames (EPS and revenue for every U.S. filer)
 * and the Regulation Crowdfunding / Regulation A offering data sets
 * (see src/lib/sec/sync.ts).
 * Called by Vercel Cron (vercel.json); needs `Authorization: Bearer <CRON_SECRET>`.
 *   ?dry=1                    fetch and report without writing
 *   ?only=frames|datasets     run one part
 */
import { cronGuard } from "@/lib/auth/cron";
import { runSecSync, type SecPart } from "@/lib/sec/sync";

export const maxDuration = 300;

export async function GET(req: Request) {
  const denied = cronGuard(req); if (denied) return denied;
  const q = new URL(req.url).searchParams;
  const only = q.get("only")?.split(",").filter((x): x is SecPart => x === "frames" || x === "datasets");
  try {
    const report = await runSecSync({ dryRun: q.get("dry") === "1", only: only?.length ? only : undefined });
    return Response.json(report, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return Response.json({ code: "sync_failed", message: (e as Error).message }, { status: 500 });
  }
}
