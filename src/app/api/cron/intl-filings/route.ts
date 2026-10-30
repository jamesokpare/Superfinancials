/**
 * GET /api/cron/intl-filings — company filings from EDINET (Japan), OpenDART
 * (Korea) and filings.xbrl.org (EU/UK ESEF) (see src/lib/filings/intl.ts).
 * Called by Vercel Cron (vercel.json); needs `Authorization: Bearer <CRON_SECRET>`.
 *   ?dry=1              fetch and report without writing
 *   ?only=edinet,xbrl   run some sources only
 */
import { cronGuard } from "@/lib/auth/cron";
import { runIntlFilingsSync, type IntlSourceId } from "@/lib/filings/intl";

export const maxDuration = 300;

export async function GET(req: Request) {
  const denied = cronGuard(req); if (denied) return denied;
  const q = new URL(req.url).searchParams;
  const only = q.get("only")?.split(",").map((s) => s.trim()).filter((s): s is IntlSourceId => ["edinet", "opendart", "xbrl"].includes(s));
  try {
    const report = await runIntlFilingsSync({ dryRun: q.get("dry") === "1", only: only?.length ? only : undefined });
    return Response.json(report, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return Response.json({ code: "sync_failed", message: (e as Error).message }, { status: 500 });
  }
}
