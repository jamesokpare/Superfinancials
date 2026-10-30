/**
 * GET /api/uk-officers?q=<name>&n=20 — search UK company officers (directors,
 * secretaries, LLP members) on Companies House. Signed-in users only.
 */
import { signedIn } from "@/lib/auth/server";
import { envKey } from "@/lib/providers/http";
import { searchOfficers } from "@/lib/ukreg";

export async function GET(req: Request) {
  if (!envKey("COMPANIES_HOUSE_API_KEY")) return Response.json({ code: "not_configured", message: "Companies House is not connected on this server" }, { status: 503 });
  if (!(await signedIn(req))) return Response.json({ code: "not_granted", message: "Sign in to search UK officers" }, { status: 401 });
  const sp = new URL(req.url).searchParams; const q = (sp.get("q") ?? "").trim().slice(0, 160);
  if (q.length < 3) return Response.json({ code: "bad_request", message: "Type at least three characters" }, { status: 400 });
  try {
    return Response.json(await searchOfficers(q, Math.min(50, Math.max(5, Number(sp.get("n")) || 25))), { headers: { "cache-control": "private, max-age=300" } });
  } catch (e) {
    return Response.json({ code: "upstream_error", message: (e as Error).message.replace(/https?:\/\/\S+/g, "") }, { status: 502 });
  }
}
