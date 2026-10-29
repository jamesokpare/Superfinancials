// Pings every configured data connection and prints a status table.
// Run: npm run providers:check          (all)
//      npm run providers:check fred fmp (only those ids)
// Reads keys from the environment, or from .env.local / .env when present.
import { existsSync } from "node:fs";
import { checkConnections } from "../src/lib/providers";
import { sql } from "../src/lib/db/postgres";

for (const f of [".env.local", ".env"]) if (existsSync(f)) process.loadEnvFile(f);

const results = await checkConnections(process.argv.slice(2));
const w = Math.max(...results.map((r) => r.name.length));
for (const r of results) {
  const status = !r.configured ? `skipped  (${r.env} not set)` : r.ok ? `ok       ${r.ms} ms` : `FAILED   ${r.error}`;
  console.log(`${r.name.padEnd(w)}  ${status}`);
}
const tried = results.filter((r) => r.configured);
console.log(`\n${tried.filter((r) => r.ok).length}/${tried.length} configured connections OK, ${results.length - tried.length} not configured.`);
if (results.some((r) => r.id === "database" && r.configured)) await sql().end({ timeout: 2 });
process.exit(tried.some((r) => !r.ok) ? 1 : 0);
