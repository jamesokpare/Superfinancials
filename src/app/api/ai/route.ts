/**
 * POST /api/ai — server side of the `sample` capability (Copilot, AI analyst,
 * portfolio summaries). Requires a signed-in Supabase user; the Anthropic API
 * key never leaves the server. Streams newline-delimited JSON events:
 *   {"t":"d","text":"..."}  a text delta
 *   {"t":"end","truncated":false}
 *   {"t":"err","code":"...","message":"..."}
 */
import Anthropic from "@anthropic-ai/sdk";
import { signedIn } from "@/lib/auth/server";

const MODEL = process.env.SF_AI_MODEL || "claude-opus-5-5";
/** The artifact's model tiers map to effort on one model. */
const EFFORT = { quick: "low", default: "medium", complex: "high" } as const;
const MAX_BODY = 2_000_000;

type Tier = keyof typeof EFFORT;
const fail = (status: number, code: string, message: string) => Response.json({ code, message }, { status });

let anthropic: Anthropic | null = null;
const client = () => (anthropic ??= new Anthropic());

function toMessages(input: unknown): Anthropic.Beta.BetaMessageParam[] | null {
  if (typeof input === "string" && input.trim()) return [{ role: "user", content: input }];
  if (!Array.isArray(input) || !input.length) return null;
  const ok = input.every((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string");
  if (!ok || input[input.length - 1].role !== "user") return null;
  return input.map((m) => ({ role: m.role, content: m.content }));
}

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) return fail(503, "sampling_disabled", "AI is not configured on this server");
  if (!(await signedIn(req))) return fail(401, "not_granted", "Sign in to use the AI features");

  const raw = await req.text();
  if (raw.length > MAX_BODY) return fail(413, "prompt_too_large", "This request is too large");
  let body: { input?: unknown; modelTier?: string; json?: boolean };
  try { body = JSON.parse(raw); } catch { return fail(400, "bad_request", "Invalid JSON body"); }
  const messages = toMessages(body.input);
  if (!messages) return fail(400, "bad_request", "input must be a string or messages ending on a user turn");
  const tier: Tier = body.modelTier && body.modelTier in EFFORT ? (body.modelTier as Tier) : "default";

  const system = body.json
    ? "Reply with a single valid JSON value only: no prose, no markdown, no code fences."
    : undefined;

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      const send = (o: object) => ctrl.enqueue(enc.encode(JSON.stringify(o) + "\n"));
      try {
        const s = client().beta.messages.stream(
          {
            model: MODEL,
            max_tokens: 32000,
            output_config: { effort: EFFORT[tier] },
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
            ...(system ? { system } : {}),
            messages,
          },
          { signal: req.signal },
        );
        for await (const ev of s) {
          if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") send({ t: "d", text: ev.delta.text });
        }
        const final = await s.finalMessage();
        if (final.stop_reason === "refusal") send({ t: "err", code: "refused", message: "The model declined this request" });
        else send({ t: "end", truncated: final.stop_reason === "max_tokens" });
      } catch (e) {
        if (req.signal.aborted) { /* client went away */ }
        else if (e instanceof Anthropic.RateLimitError) send({ t: "err", code: "rate_limited", message: "Too many requests" });
        else if (e instanceof Anthropic.APIConnectionError) send({ t: "err", code: "upstream_error", message: "Could not reach the AI service" });
        else if (e instanceof Anthropic.APIError) send({ t: "err", code: e.status === 413 ? "prompt_too_large" : "upstream_error", message: e.message });
        else send({ t: "err", code: "upstream_error", message: "The answer was interrupted" });
      } finally {
        ctrl.close();
      }
    },
  });

  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
