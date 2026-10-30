/**
 * Shared plumbing for the market-data provider clients.
 *
 * Every provider reads its key from an environment variable with the same name
 * as the GitHub repository secret (ALPHAVANTAGE_API_KEY, FMP_API_KEY, ...).
 * Keys are server-only: none use the NEXT_PUBLIC_ prefix, so Next.js never
 * ships them to the browser.
 */

export class ProviderError extends Error {
  constructor(
    readonly provider: string,
    message: string,
    readonly status?: number,
    readonly body?: unknown,
  ) {
    super(`${provider}: ${message}`);
    this.name = "ProviderError";
  }
}

/** Thrown when a provider is called but its key is not set. */
export class MissingKeyError extends ProviderError {
  constructor(provider: string, readonly envVar: string) {
    super(provider, `${envVar} is not set`);
    this.name = "MissingKeyError";
  }
}

export const envKey = (name: string) => process.env[name]?.trim() || undefined;

export function requireKey(provider: string, envVar: string): string {
  const key = envKey(envVar);
  if (!key) throw new MissingKeyError(provider, envVar);
  return key;
}

export type Query = Record<string, string | number | boolean | undefined | null>;

export function buildUrl(base: string, path: string, query?: Query): URL {
  const url = new URL(base.replace(/\/+$/, "") + path);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  return url;
}

export type FetchOptions = {
  /** Extra fetch options, e.g. `{ next: { revalidate: 300 } }` to cache in Next.js. */
  init?: RequestInit;
  /** Milliseconds before the request is aborted. Default 15 s. */
  timeoutMs?: number;
  /** Hook to turn a 200 response that carries an error payload into an error message. */
  inBodyError?: (body: unknown) => string | undefined;
};

/** Removes secrets from URLs before they appear in error messages or logs. */
const redact = (url: URL) =>
  url.toString().replace(/((?:api_?key|apikey|api_token|access_key|token)=)[^&]+/gi, "$1***").replace(/\/v6\/[^/]+\//, "/v6/***/");

/** "www.mansaapi.com" and "mansaapi.com" are the same site. */
const site = (host: string) => host.toLowerCase().replace(/^www\./, "");
/**
 * fetch, following redirects itself. fetch drops the Authorization header when a redirect changes host
 * (e.g. www.example.com → example.com), so an API that redirects to its bare domain answers "no API key".
 * A redirect within the same site (www or not, https only) keeps every header; any other redirect is
 * followed without the Authorization header, as fetch would do, so a key never leaves the provider's site.
 */
export async function fetchKeepingAuth(url: URL | string, init: RequestInit = {}, hops = 5): Promise<Response> {
  let cur = new URL(String(url)); let headers = new Headers(init.headers);
  for (let i = 0; ; i++) {
    const res = await fetch(cur, { ...init, headers, redirect: "manual" });
    const loc = res.headers.get("location");
    if (![301, 302, 303, 307, 308].includes(res.status) || !loc || i >= hops) return res;
    const next = new URL(loc, cur);
    if (site(next.hostname) !== site(cur.hostname) || next.protocol !== "https:") { headers = new Headers(headers); headers.delete("authorization"); }
    cur = next;
  }
}

export async function getJson<T>(provider: string, url: URL, opts: FetchOptions = {}): Promise<T> {
  const { init, timeoutMs = 15_000, inBodyError } = opts;
  const signal = init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  let res: Response;
  try {
    res = await fetchKeepingAuth(url, { ...init, signal, headers: { accept: "application/json", ...init?.headers } });
  } catch (e) {
    const why = e instanceof Error && e.name === "TimeoutError" ? `timed out after ${timeoutMs} ms` : (e as Error).message;
    throw new ProviderError(provider, `request to ${redact(url)} failed: ${why}`);
  }
  const text = await res.text();
  let body: unknown = text;
  try { body = text ? JSON.parse(text) : null; } catch { /* keep raw text */ }
  if (!res.ok) {
    throw new ProviderError(provider, `HTTP ${res.status} from ${redact(url)}: ${describe(body)}`, res.status, body);
  }
  const msg = inBodyError?.(body);
  if (msg) throw new ProviderError(provider, msg, res.status, body);
  return body as T;
}

function describe(body: unknown): string {
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    const err = b.error as Record<string, unknown> | string | undefined;
    const m = (typeof err === "object" && err?.message) || err || b.message || b.error_message || b["Error Message"];
    if (m) return String(m).slice(0, 300);
    return JSON.stringify(body).slice(0, 300);
  }
  return String(body ?? "").slice(0, 300);
}
