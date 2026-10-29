/**
 * GET /api/providers — status of the external data connections.
 *   (no query)        which connections have their env var set
 *   ?check=1          also pings each configured one and reports ok / error
 *   ?check=fred,fmp   pings only those ids
 * Requires a signed-in Supabase user (`Authorization: Bearer <jwt>`).
 * Never returns key values.
 */
import { CONNECTIONS, checkConnections, isConfigured } from "@/lib/providers";
import { signedIn } from "@/lib/auth/server";

export async function GET(req: Request) {
  if (!(await signedIn(req))) return Response.json({ code: "not_granted", message: "Sign in to view data connections" }, { status: 401 });

  const check = new URL(req.url).searchParams.get("check");
  const headers = { "cache-control": "no-store" };
  if (!check) {
    const connections = CONNECTIONS.map((c) => ({ id: c.id, name: c.name, kind: c.kind, env: c.env, docs: c.docs, configured: isConfigured(c) }));
    return Response.json({ connections }, { headers });
  }
  const ids = check === "1" || check === "all" ? undefined : check.split(",").map((s) => s.trim()).filter(Boolean);
  return Response.json({ connections: await checkConnections(ids) }, { headers });
}
