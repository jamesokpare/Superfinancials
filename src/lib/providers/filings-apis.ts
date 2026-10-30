/**
 * Keys for the national filing systems read by the international filings sync
 * (src/lib/filings/intl.ts). Both are free; registered here so the Data sources
 * page lists them and error messages never show the keys.
 *
 *   EDINET (Japan, Financial Services Agency)    EDINET_API_KEY     Public Data License 1.0
 *   OpenDART (Korea, Financial Supervisory Svc)  OPENDART_API_KEY   free, 20,000 calls a day
 */
import { buildUrl, getJson, ProviderError, requireKey } from "./http";

export const EDINET_ENV = "EDINET_API_KEY";
export const OPENDART_ENV = "OPENDART_API_KEY";

export async function pingEdinet() {
  const key = requireKey("EDINET", EDINET_ENV); const day = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  const r = await getJson<{ metadata?: { status?: string; message?: string }; statusCode?: number; message?: string }>("EDINET", buildUrl("https://api.edinet-fsa.go.jp/api/v2", "/documents.json", { date: day, type: 1, "Subscription-Key": key }));
  const status = String(r.metadata?.status ?? r.statusCode ?? "");
  if (status !== "200") throw new ProviderError("EDINET", `status ${status}: ${r.metadata?.message ?? r.message ?? "rejected"}`);
  return r.metadata;
}
export async function pingOpenDart() {
  const key = requireKey("OpenDART", OPENDART_ENV); const d = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const r = await getJson<{ status?: string; message?: string }>("OpenDART", buildUrl("https://opendart.fss.or.kr/api", "/list.json", { crtfc_key: key, bgn_de: d, end_de: d, page_count: 1 }));
  if (r.status !== "000" && r.status !== "013") throw new ProviderError("OpenDART", `status ${r.status}: ${r.message ?? "rejected"}`); // 013 = no filings today
  return r.status;
}
