/**
 * GET /api/uk-companies?q=<name or number>&n=20 — search the UK company register.
 * Signed-in users only; the Companies House key stays on the server.
 */
import { signedIn } from "@/lib/auth/server";
import { envKey } from "@/lib/providers/http";
import { searchCompanies } from "@/lib/ukreg";

export async function GET(req: Request) {
  if (!envKey("COMPANIES_HOUSE_API_KEY")) return Response.json({ code: "not_configured", message: "Companies House is not connected on this server" }, { status: 503 });
  if (!(await signedIn(req))) return Response.json({ code: "not_granted", message: "Sign in to search the UK register" }, { status: 401 });
  const sp = new URL(req.url).searchParams; const q = (sp.get("q") ?? "").trim().slice(0, 160);
  if (q.length < 2) return Response.json({ code: "bad_request", message: "Type at least two characters" }, { status: 400 });
  try {
    return Response.json(await searchCompanies(q, Math.min(50, Math.max(5, Number(sp.get("n")) || 20))), { headers: { "cache-control": "private, max-age=300" } });
  } catch (e) {
    return Response.json({ code: "upstream_error", message: (e as Error).message.replace(/https?:\/\/\S+/g, "") }, { status: 502 });
  }
}
