/**
 * GET /api/cron/market-sync — pulls end-of-day prices from the configured data
 * providers into the app (see src/lib/market/sync.ts).
 *
 * Called by Vercel Cron (vercel.json) after the U.S. close on weekdays. Vercel
 * sends `Authorization: Bearer <CRON_SECRET>`; any other caller needs the same.
 *   ?dry=1               fetch and report without writing
 *   ?only=EQ.AAPL,NGX    limit to some instruments
 */
import { timingSafeEqual } from "node:crypto";
import { runMarketSync } from "@/lib/market/sync";

export const maxDuration = 300;

function authorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  const got = req.headers.get("authorization") ?? "";
  if (!secret) return false;
  const want = `Bearer ${secret}`;
  return got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

export async function GET(req: Request) {
  if (!process.env.CRON_SECRET) return Response.json({ code: "not_configured", message: "Set CRON_SECRET to enable the market sync" }, { status: 503 });
  if (!authorized(req)) return Response.json({ code: "unauthorized", message: "Bad or missing CRON_SECRET" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  try {
    const report = await runMarketSync({ dryRun: sp.get("dry") === "1", only: sp.get("only")?.split(",").map((s) => s.trim()).filter(Boolean) });
    return Response.json(report, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return Response.json({ code: "sync_failed", message: (e as Error).message }, { status: 500 });
  }
}
