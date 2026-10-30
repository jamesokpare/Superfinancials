/**
 * GET /api/providers — status of the external data connections.
 *   (no query)        which connections have their env var set
 *   ?check=1          also pings each configured one and reports ok / error
 *   ?check=fred,fmp   pings only those ids
 * Signed out, only the plain list is returned (name, what it feeds, configured or
 * not), for the public landing page: no env var names, no database, no pings.
 * Never returns key values.
 */
import { CONNECTIONS, checkConnections, isConfigured } from "@/lib/providers";
import { signedIn } from "@/lib/auth/server";

export async function GET(req: Request) {
  const check = new URL(req.url).searchParams.get("check");
  const headers = { "cache-control": "no-store" };
  if (!(await signedIn(req))) {
    if (check) return Response.json({ code: "not_granted", message: "Sign in to test data connections" }, { status: 401 });
    const connections = CONNECTIONS.filter((c) => c.kind !== "database").map((c) => ({ id: c.id, name: c.name, kind: c.kind, uses: c.uses, configured: isConfigured(c) }));
    return Response.json({ connections }, { headers: { "cache-control": "public, max-age=300" } });
  }
  if (!check) {
    const connections = CONNECTIONS.map((c) => ({ id: c.id, name: c.name, kind: c.kind, env: c.env, docs: c.docs, uses: c.uses, configured: isConfigured(c) }));
    return Response.json({ connections }, { headers });
  }
  const ids = check === "1" || check === "all" ? undefined : check.split(",").map((s) => s.trim()).filter(Boolean);
  return Response.json({ connections: await checkConnections(ids) }, { headers });
}
