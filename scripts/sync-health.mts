// Checks that the market, news and fundamentals syncs ran recently and produced data.
// Exits 1 if any is stale or empty (so a scheduled CI job fails and notifies).
// Run: npm run sync:health   (needs DATABASE_URL or SUPABASE_SERVICE_ROLE_KEY)
import { existsSync, appendFileSync } from "node:fs";
import { checkSyncHealth } from "../src/lib/health";
import { openStore } from "../src/lib/market/store";
import { sql } from "../src/lib/db/postgres";

for (const f of [".env.local", ".env"]) if (existsSync(f)) process.loadEnvFile(f);
const rows = await checkSyncHealth(openStore());
const line = (r: (typeof rows)[number]) => `${r.ok ? "OK  " : "FAIL"}  ${r.sync.padEnd(14)} ${r.checked ? `last run ${r.checked}` : ""}${r.ok ? "" : `\n      ${r.detail}`}`;
for (const r of rows) console.log(line(r));
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Sync health\n\n| Sync | Status | Last run | Detail |\n|---|---|---|---|\n${rows.map((r) => `| ${r.sync} | ${r.ok ? "✅ OK" : "❌ Failing"} | ${r.checked ?? "never"} | ${r.detail.replace(/\|/g, "/")} |`).join("\n")}\n`);
}
if (process.env.DATABASE_URL && !process.env.SUPABASE_SERVICE_ROLE_KEY) await sql().end({ timeout: 2 });
process.exit(rows.every((r) => r.ok) ? 0 : 1);
