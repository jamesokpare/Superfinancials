// Pulls recent SEC EDGAR filings and earnings press releases for the app's U.S. equities.
// Run: npm run filings:sync                     (write)
//      npm run filings:sync -- --dry-run        (fetch and report only)
//      npm run filings:sync -- --only=AAPL,MSFT
// Needs SEC_USER_AGENT ("Company contact@domain"). Reads .env.local / .env when present.
import { existsSync } from "node:fs";
import { runFilingsSync } from "../src/lib/filings/sync";
import { sql } from "../src/lib/db/postgres";
import { memoryStore } from "../src/lib/market/store";

for (const f of [".env.local", ".env"]) if (existsSync(f)) process.loadEnvFile(f);
const dry = process.argv.includes("--dry-run");
const noDb = !process.env.DATABASE_URL && !(process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL);
const store = dry && noDb ? memoryStore() : undefined;
if (store) console.log("No database configured: dry run against an empty in-memory store.\n");
const only = process.argv.find((a) => a.startsWith("--only"))?.split("=")[1]?.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
const r = await runFilingsSync({ store, dryRun: dry, only });
console.log(r.note);
for (const f of r.failed) console.log(`  ${f.tk}: ${f.error}`);
if (r.dryRun) console.log("DRY RUN (nothing written)");
if (process.env.DATABASE_URL && !process.env.SUPABASE_SERVICE_ROLE_KEY) await sql().end({ timeout: 2 });
