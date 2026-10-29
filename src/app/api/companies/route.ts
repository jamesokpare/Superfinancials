/**
 * GET /api/companies?q=<name, number or LEI>&cc=<country>&n=20 — search the
 * live company registers (Companies House for the UK, GLEIF worldwide).
 * Signed-in users only; keys stay on the server.
 */
import { signedIn } from "@/lib/auth/server";
import { searchRegistry } from "@/lib/registry";

export async function GET(req: Request) {
  if (!(await signedIn(req))) return Response.json({ code: "not_granted", message: "Sign in to search the company registers" }, { status: 401 });
  const sp = new URL(req.url).searchParams; const q = (sp.get("q") ?? "").trim().slice(0, 160);
  if (q.length < 2) return Response.json({ code: "bad_request", message: "Type at least two characters" }, { status: 400 });
  const n = Math.min(50, Math.max(5, Number(sp.get("n")) || 20));
  return Response.json(await searchRegistry(q, { n, cc: sp.get("cc") ?? undefined }), { headers: { "cache-control": "private, max-age=300" } });
}
