/**
 * GET /api/companies/no/<organisation number>  Norway (Brønnøysund Register Centre)
 * GET /api/companies/fr/<SIREN>                France (recherche-entreprises.api.gouv.fr)
 * A national register record: status, legal form, founding date, address, industry and,
 * for France, the directors. Signed-in users only. (LEI records: /api/companies/lei/<LEI>.)
 */
import { signedIn } from "@/lib/auth/server";
import { franceDetail, norwayDetail } from "@/lib/registry";

export async function GET(req: Request, ctx: { params: Promise<{ src: string; id: string }> }) {
  if (!(await signedIn(req))) return Response.json({ code: "not_granted", message: "Sign in to view register records" }, { status: 401 });
  const { src, id: raw } = await ctx.params; const id = decodeURIComponent(raw).replace(/\s/g, "");
  const fn = src === "no" && /^\d{9}$/.test(id) ? norwayDetail : src === "fr" && /^\d{9}$/.test(id) ? franceDetail : null;
  if (!fn) return Response.json({ code: "bad_request", message: "Unknown register or number (Norway: 9-digit organisation number; France: 9-digit SIREN)" }, { status: 400 });
  try {
    return Response.json(await fn(id), { headers: { "cache-control": "private, max-age=300" } });
  } catch (e) {
    if ((e as { status?: number }).status === 404) return Response.json({ code: "not_found", message: `No company ${id} on the register` }, { status: 404 });
    return Response.json({ code: "upstream_error", message: (e as Error).message.replace(/https?:\/\/\S+/g, "") }, { status: 502 });
  }
}
