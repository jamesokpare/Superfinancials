/**
 * GET /api/uk-officers/<officer id> — one officer's appointments across UK
 * companies, from Companies House. Signed-in users only.
 */
import { signedIn } from "@/lib/auth/server";
import { envKey, ProviderError } from "@/lib/providers/http";
import { officerAppointments } from "@/lib/ukreg";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!envKey("COMPANIES_HOUSE_API_KEY")) return Response.json({ code: "not_configured", message: "Companies House is not connected on this server" }, { status: 503 });
  if (!(await signedIn(req))) return Response.json({ code: "not_granted", message: "Sign in to view UK officers" }, { status: 401 });
  const id = decodeURIComponent((await ctx.params).id);
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) return Response.json({ code: "bad_request", message: "Not an officer id" }, { status: 400 });
  try {
    return Response.json(await officerAppointments(id), { headers: { "cache-control": "private, max-age=300" } });
  } catch (e) {
    if (e instanceof ProviderError && e.status === 404) return Response.json({ code: "not_found", message: "No such officer on the register" }, { status: 404 });
    return Response.json({ code: "upstream_error", message: (e as Error).message.replace(/https?:\/\/\S+/g, "") }, { status: 502 });
  }
}
