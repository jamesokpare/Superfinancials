/**
 * GET /api/intraday/<instrument id>?interval=5m — delayed quote and the latest
 * session's intraday bars from EODHD (see src/lib/market/intraday.ts).
 * Signed-in users only; cached on the server for a minute.
 */
import { signedIn } from "@/lib/auth/server";
import { envKey } from "@/lib/providers/http";
import { intraday } from "@/lib/market/intraday";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!envKey("EODHD_API_KEY")) return Response.json({ code: "not_configured", message: "EODHD is not connected on this server" }, { status: 503 });
  if (!(await signedIn(req))) return Response.json({ code: "not_granted", message: "Sign in to load intraday data" }, { status: 401 });
  const id = decodeURIComponent((await ctx.params).id).slice(0, 40);
  const iv = new URL(req.url).searchParams.get("interval");
  const interval = iv === "1m" || iv === "1h" ? iv : "5m";
  try {
    const v = await intraday(id, interval);
    if (!v) return Response.json({ code: "not_covered", message: "Intraday data is not available for this instrument" }, { status: 404 });
    return Response.json(v, { headers: { "cache-control": "private, max-age=60" } });
  } catch (e) {
    const status = (e as { status?: number; statusCode?: number }).status ?? (e as { statusCode?: number }).statusCode;
    const msg = (e as Error).message.replace(/api_token=[^&\s]+/g, "api_token=***").replace(/https?:\/\/\S+/g, "").slice(0, 300);
    return Response.json({ code: status === 403 || status === 402 ? "plan" : "upstream_error", message: status === 403 || status === 402 ? "The EODHD plan on this server does not include intraday data" : msg }, { status: 502 });
  }
}
