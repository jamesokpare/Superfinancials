// Reads the public pension fund performance reports (CalPERS, WSIB, Oregon Treasury) into the data desk.
// Run: npm run pensions:sync                        (write)
//      npm run pensions:sync -- --dry-run           (read and report only)
//      npm run pensions:sync -- --only=calpers      (one pension)
// No keys needed. Reads .env.local / .env when present.
import { existsSync } from "node:fs";
import { runPensionSync } from "../src/lib/pensions/sync";
import type { Pension } from "../src/lib/pensions";
import { sql } from "../src/lib/db/postgres";
import { memoryStore } from "../src/lib/market/store";

for (const f of [".env.local", ".env"]) if (existsSync(f)) process.loadEnvFile(f);
const dry = process.argv.includes("--dry-run");
const noDb = !process.env.DATABASE_URL && !(process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL);
const store = dry && noDb ? memoryStore() : undefined;
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",") as Pension[] | undefined;
const r = await runPensionSync({ store, dryRun: dry, only });
console.log(r.note);
for (const [k, s] of Object.entries(r.sources)) console.log(`  ${k.padEnd(8)} ${s.error ? "FAILED " + s.error : `${s.rows} funds, as of ${s.asof}`}`);
if (r.dryRun) console.log("DRY RUN (nothing written)");
if (process.env.DATABASE_URL && !process.env.SUPABASE_SERVICE_ROLE_KEY) await sql().end({ timeout: 2 });
