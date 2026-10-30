// Pulls recent company filings from EDINET (Japan), OpenDART (Korea) and filings.xbrl.org (EU/UK).
// Run: npx tsx --conditions=react-server scripts/intl-filings.mts                 (write)
//      npx tsx --conditions=react-server scripts/intl-filings.mts --dry-run       (fetch and report only)
//      ... --only=edinet,xbrl
// EDINET needs EDINET_API_KEY, OpenDART needs OPENDART_API_KEY (skipped without them). Reads .env.local / .env when present.
import { existsSync } from "node:fs";
import { runIntlFilingsSync, type IntlSourceId } from "../src/lib/filings/intl";
import { sql } from "../src/lib/db/postgres";
import { memoryStore } from "../src/lib/market/store";

for (const f of [".env.local", ".env"]) if (existsSync(f)) process.loadEnvFile(f);
const dry = process.argv.includes("--dry-run");
const noDb = !process.env.DATABASE_URL && !(process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL);
const store = dry && noDb ? memoryStore() : undefined;
if (store) console.log("No database configured: dry run against an empty in-memory store.\n");
const only = process.argv.find((a) => a.startsWith("--only"))?.split("=")[1]?.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean) as IntlSourceId[] | undefined;
const r = await runIntlFilingsSync({ store, dryRun: dry, only });
console.log(r.note);
for (const [k, s] of Object.entries(r.sources)) console.log(`  ${k}: ${s.error ?? s.skipped ?? `${s.n} filings`}`);
for (const [k, n] of Object.entries(r.lists)) console.log(`  ${k}: ${n}`);
if (r.dryRun) console.log("DRY RUN (nothing written)");
if (process.env.DATABASE_URL && !process.env.SUPABASE_SERVICE_ROLE_KEY) await sql().end({ timeout: 2 });
