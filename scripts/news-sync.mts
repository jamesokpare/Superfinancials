// Pulls recent headlines from the news providers into the app's database.
// Run: npm run news:sync                (write)
//      npm run news:sync -- --dry-run   (fetch and report only)
// Reads keys from the environment, or from .env.local / .env when present.
import { existsSync } from "node:fs";
import { runNewsSync } from "../src/lib/news/sync";
import { sql } from "../src/lib/db/postgres";

for (const f of [".env.local", ".env"]) if (existsSync(f)) process.loadEnvFile(f);
const r = await runNewsSync({ dryRun: process.argv.includes("--dry-run") });
console.log(r.note);
console.log(`Providers configured: ${r.configured.join(", ") || "none"}${r.dryRun ? "  ·  DRY RUN (nothing written)" : ""}`);
for (const [p, e] of Object.entries(r.errors)) console.log(`  ${p}: ${e}`);
if (r.days.length) console.log(`Days updated: ${r.days.join(", ")}`);
if (r.pruned.length) console.log(`Days removed: ${r.pruned.join(", ")}`);
if (process.env.DATABASE_URL && !process.env.SUPABASE_SERVICE_ROLE_KEY) await sql().end({ timeout: 2 });
