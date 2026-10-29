// Pulls free official macro data and calendar events into the app's database.
// Run: npm run macro:sync                       (write)
//      npm run macro:sync -- --dry-run          (fetch and report only)
//      npm run macro:sync -- --only=bis,ecb
//      npm run macro:sync -- --group=rates      (official rates and CFTC; --group=core for the rest; default: all)
// Reads keys from the environment, or from .env.local / .env when present.
import { existsSync } from "node:fs";
import { runMacroSync, type MacroGroup, type MacroSourceId } from "../src/lib/macro/sync";
import { sql } from "../src/lib/db/postgres";
import { memoryStore } from "../src/lib/market/store";

for (const f of [".env.local", ".env"]) if (existsSync(f)) process.loadEnvFile(f);
const dry = process.argv.includes("--dry-run");
const noDb = !process.env.DATABASE_URL && !(process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL);
const store = dry && noDb ? memoryStore() : undefined;
if (store) console.log("No database configured: dry run against an empty in-memory store.\n");
const only = process.argv.find((a) => a.startsWith("--only"))?.split("=")[1]?.split(",").filter(Boolean) as MacroSourceId[] | undefined;

const group = process.argv.find((a) => a.startsWith("--group"))?.split("=")[1] as MacroGroup | undefined;
const r = await runMacroSync({ store, dryRun: dry, only, group });
console.log(r.note);
for (const [k, s] of Object.entries(r.sources)) console.log(`  ${k.padEnd(18)} ${String(s.series).padStart(5)} series ${String(s.events).padStart(4)} events${s.error ? `  ERROR ${s.error}` : ""}${s.skipped ? `  skipped: ${s.skipped}` : ""}`);
if (r.series.kept.length) console.log(`Owner series kept: ${r.series.kept.join(" ")}`);
if (process.env.DATABASE_URL && !process.env.SUPABASE_SERVICE_ROLE_KEY) await sql().end({ timeout: 2 });
