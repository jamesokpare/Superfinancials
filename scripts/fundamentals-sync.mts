// Refreshes reported financials for the app's U.S. equities.
// Run: npm run fundamentals:sync                     (write)
//      npm run fundamentals:sync -- --dry-run        (fetch and report only)
//      npm run fundamentals:sync -- --only=AAPL,MSFT --budget=64
// Reads keys from the environment, or from .env.local / .env when present.
import { existsSync } from "node:fs";
import { runFundamentalsSync } from "../src/lib/fundamentals/sync";
import { sql } from "../src/lib/db/postgres";

for (const f of [".env.local", ".env"]) if (existsSync(f)) process.loadEnvFile(f);
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}`))?.split("=")[1];
const r = await runFundamentalsSync({
  dryRun: process.argv.includes("--dry-run"),
  only: arg("only")?.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean),
  budget: arg("budget") ? Number(arg("budget")) : undefined,
});
console.log(r.note);
console.log(`Providers configured: ${r.configured.join(", ") || "none"}${r.dryRun ? "  ·  DRY RUN (nothing written)" : ""}`);
for (const f of r.failed) console.log(`  ${f.tk}: ${f.error}`);
if (r.earnings.error) console.log(`Earnings calendar: ${r.earnings.error}`);
if (process.env.DATABASE_URL && !process.env.SUPABASE_SERVICE_ROLE_KEY) await sql().end({ timeout: 2 });
