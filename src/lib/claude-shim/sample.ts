/**
 * The artifact runtime's `sample` capability: `sample(input, opts)` → {text, truncated}
 * and `sample.json(input, opts)` → parsed value. Calls our /api/ai route, which
 * streams newline-delimited JSON events back.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

type Msg = { role: "user" | "assistant"; content: string };
type Opts = {
  onText?: (e: { text: string; delta: string }) => void;
  signal?: AbortSignal;
  modelTier?: "quick" | "default" | "complex";
  cache?: boolean;
};
type SampleError = { code: string; message: string; text?: string };

/** Parse JSON out of a model reply, tolerating code fences or stray prose. */
function parseJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try { return JSON.parse(t); } catch { /* fall through */ }
  const start = t.search(/[[{]/);
  const end = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
  if (start >= 0 && end > start) return JSON.parse(t.slice(start, end + 1));
  throw { code: "invalid_json", message: "The answer was not valid JSON", text } satisfies SampleError;
}

export function createSample(sb: SupabaseClient) {
  const memo = new Map<string, { at: number; text: string; truncated: boolean }>();

  async function run(input: string | Msg[], opts: Opts = {}, json = false) {
    const key = JSON.stringify([input, opts.modelTier, json]);
    const hit = opts.cache !== false ? memo.get(key) : undefined;
    if (hit && Date.now() - hit.at < 5 * 60_000) { opts.onText?.({ text: hit.text, delta: hit.text }); return hit; }

    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw { code: "not_granted", message: "Sign in to use the AI features" } satisfies SampleError;

    let res: Response;
    try {
      res = await fetch("/api/ai", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ input, modelTier: opts.modelTier ?? "default", json }),
        signal: opts.signal,
      });
    } catch (e) {
      if ((e as Error).name === "AbortError") throw { code: "cancelled", message: "Stopped" } satisfies SampleError;
      throw { code: "network", message: "Could not reach the AI service" } satisfies SampleError;
    }
    if (!res.ok || !res.body) {
      const body = await res.json().catch(() => ({}));
      throw { code: body.code ?? (res.status === 429 ? "rate_limited" : "upstream_error"), message: body.message ?? res.statusText } satisfies SampleError;
    }

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "", text = "", truncated = false;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
          if (!line.trim()) continue;
          const ev = JSON.parse(line) as { t: "d"; text: string } | { t: "end"; truncated: boolean } | { t: "err"; code: string; message: string };
          if (ev.t === "d") { text += ev.text; opts.onText?.({ text, delta: ev.text }); }
          else if (ev.t === "end") truncated = ev.truncated;
          else throw { code: ev.code, message: ev.message, text } satisfies SampleError;
        }
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") throw { code: "cancelled", message: "Stopped", text } satisfies SampleError;
      throw e;
    }
    const out = { text, truncated };
    if (opts.cache !== false) memo.set(key, { ...out, at: Date.now() });
    return out;
  }

  const sample = (input: string | Msg[], opts?: Opts) => run(input, opts, false);
  sample.json = async (input: string | Msg[], opts?: Opts) => parseJson((await run(input, opts, true)).text);
  sample.limits = async () => ({ images: false });
  return Object.freeze(sample);
}
