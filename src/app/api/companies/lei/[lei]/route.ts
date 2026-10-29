/**
 * GET /api/companies/lei/<LEI> — a GLEIF record: legal name, addresses, local
 * registration number and authority, status, parents and subsidiaries.
 * Signed-in users only.
 */
import { signedIn } from "@/lib/auth/server";
import { ProviderError } from "@/lib/providers/http";
import { leiCode, leiDetail } from "@/lib/registry";

export async function GET(req: Request, ctx: { params: Promise<{ lei: string }> }) {
  if (!(await signedIn(req))) return Response.json({ code: "not_granted", message: "Sign in to view register records" }, { status: 401 });
  const lei = leiCode(decodeURIComponent((await ctx.params).lei));
  if (!lei) return Response.json({ code: "bad_request", message: "Not a valid LEI (20 characters)" }, { status: 400 });
  try {
    return Response.json(await leiDetail(lei), { headers: { "cache-control": "private, max-age=300" } });
  } catch (e) {
    if (e instanceof ProviderError && e.status === 404) return Response.json({ code: "not_found", message: `No entity with LEI ${lei}` }, { status: 404 });
    return Response.json({ code: "upstream_error", message: (e as Error).message.replace(/https?:\/\/\S+/g, "") }, { status: 502 });
  }
}
