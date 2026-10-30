// Pulls the NGX market snapshot, corporate disclosures, company news, NGX
// dividends and African elections into the app's database.
// Run: npm run africa:sync                          (write)
//      npm run africa:sync -- --dry-run             (fetch and report only)
//      npm run africa:sync -- --only=disclosures,elections
// Reads keys from the environment, or from .env.local / .env when present.
import { existsSync } from "node:fs";
import { runAfricaSync, type AfricaSourceId } from "../src/lib/africa/sync";
import { sql } from "../src/lib/db/postgres";
import { memoryStore } from "../src/lib/market/store";

for (const f of [".env.local", ".env"]) if (existsSync(f)) process.loadEnvFile(f);
const dry = process.argv.includes("--dry-run");
const noDb = !process.env.DATABASE_URL && !(process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL);
// A dry run writes nothing, so without a database it runs against an empty in-memory copy.
const store = dry && noDb ? memoryStore() : undefined;
if (store) console.log("No database configured: dry run against an empty in-memory store.\n");
const only = process.argv.find((a) => a.startsWith("--only"))?.split("=")[1]?.split(",").filter(Boolean) as AfricaSourceId[] | undefined;

const r = await runAfricaSync({ store, dryRun: dry, only });
console.log(r.note);
for (const [k, s] of Object.entries(r.sources)) console.log(`  ${k.padEnd(14)} ${String(s.n).padStart(4)}  ${s.src ?? ""}${s.error ? `  ERROR ${s.error}` : ""}${s.skipped ? `  skipped: ${s.skipped}` : ""}`);
if (r.dryRun) console.log("DRY RUN (nothing written)");
if (process.env.DATABASE_URL && !process.env.SUPABASE_SERVICE_ROLE_KEY) await sql().end({ timeout: 2 });
