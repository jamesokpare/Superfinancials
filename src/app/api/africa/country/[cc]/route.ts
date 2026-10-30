/**
 * GET /api/africa/country/<CC> — profile, trade and upcoming elections for an
 * African country from Africa API (see src/lib/africa/country.ts).
 * Signed-in users only; cached on the server for six hours.
 */
import { signedIn } from "@/lib/auth/server";
import { envKey } from "@/lib/providers/http";
import { countryDetail } from "@/lib/africa/country";

export async function GET(req: Request, ctx: { params: Promise<{ cc: string }> }) {
  if (!envKey("AFRICA_API_KEY")) return Response.json({ code: "not_configured", message: "Africa API is not connected on this server" }, { status: 503 });
  if (!(await signedIn(req))) return Response.json({ code: "not_granted", message: "Sign in to view country data" }, { status: 401 });
  const cc = decodeURIComponent((await ctx.params).cc).slice(0, 60);
  try {
    const v = await countryDetail(cc);
    if (!v) return Response.json({ code: "bad_request", message: "Not an African country code" }, { status: 400 });
    return Response.json(v, { headers: { "cache-control": "private, max-age=1800" } });
  } catch (e) {
    return Response.json({ code: "upstream_error", message: (e as Error).message.replace(/https?:\/\/\S+/g, "").slice(0, 300) }, { status: 502 });
  }
}
