// Pulls end-of-day prices from the configured providers into the app's database.
// Run: npm run market:sync                 (write)
//      npm run market:sync -- --dry-run    (fetch and report only)
//      npm run market:sync -- --only=EQ.AAPL,FX.USDNGN,NGX
// Reads keys from the environment, or from .env.local / .env when present.
import { existsSync } from "node:fs";
import { runMarketSync } from "../src/lib/market/sync";
import { sql } from "../src/lib/db/postgres";
import { memoryStore } from "../src/lib/market/store";

for (const f of [".env.local", ".env"]) if (existsSync(f)) process.loadEnvFile(f);
const dry = process.argv.includes("--dry-run");
const noDb = !process.env.DATABASE_URL && !(process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL);
// A dry run writes nothing, so without a database it runs against an empty in-memory copy.
const store = dry && noDb ? memoryStore() : undefined;
if (store) console.log("No database configured: dry run against an empty in-memory store (as on a first run).\n");
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}`));
const only = arg("only")?.split("=")[1]?.split(",").filter(Boolean);

const r = await runMarketSync({ store, dryRun: !!arg("dry-run"), only });
console.log(r.note);
console.log(`\nProviders configured: ${r.configured.join(", ") || "none"}  ·  store: ${r.store}${r.dryRun ? "  ·  DRY RUN (nothing written)" : ""}`);
for (const [p, s] of Object.entries(r.providers)) console.log(`  ${p.padEnd(13)} ${String(s.resolved).padStart(4)} / ${String(s.requested).padEnd(4)}${s.error ? `  ${s.error}` : ""}`);
if (r.ngx.source || r.ngx.error) console.log(`NGX: ${r.ngx.updated} listings via ${r.ngx.source ?? "-"}${r.ngx.asi ? `, ASI ${r.ngx.asi}` : ""}${r.ngx.error ? `  (${r.ngx.error})` : ""}`);
if (r.history.written.length) console.log(`History written: ${r.history.written.length}${r.history.pending ? `, ${r.history.pending} queued` : ""}`);
if (r.unresolved.length) console.log(`Still simulated (${r.unresolved.length}): ${r.unresolved.join(" ")}`);
if (process.env.DATABASE_URL && !process.env.SUPABASE_SERVICE_ROLE_KEY) await sql().end({ timeout: 2 });
