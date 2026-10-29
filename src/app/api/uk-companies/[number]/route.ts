/**
 * GET /api/uk-companies/<company number> — profile, officers, people with
 * significant control, recent filings and charges from Companies House.
 * Signed-in users only.
 */
import { signedIn } from "@/lib/auth/server";
import { envKey, ProviderError } from "@/lib/providers/http";
import { companyDetail, companyNumber } from "@/lib/ukreg";

export async function GET(req: Request, ctx: { params: Promise<{ number: string }> }) {
  if (!envKey("COMPANIES_HOUSE_API_KEY")) return Response.json({ code: "not_configured", message: "Companies House is not connected on this server" }, { status: 503 });
  if (!(await signedIn(req))) return Response.json({ code: "not_granted", message: "Sign in to view UK register records" }, { status: 401 });
  const num = companyNumber(decodeURIComponent((await ctx.params).number));
  if (!num) return Response.json({ code: "bad_request", message: "Not a UK company number" }, { status: 400 });
  try {
    return Response.json(await companyDetail(num), { headers: { "cache-control": "private, max-age=300" } });
  } catch (e) {
    if (e instanceof ProviderError && e.status === 404) return Response.json({ code: "not_found", message: `No company ${num} on the register` }, { status: 404 });
    return Response.json({ code: "upstream_error", message: (e as Error).message.replace(/https?:\/\/\S+/g, "") }, { status: 502 });
  }
}
