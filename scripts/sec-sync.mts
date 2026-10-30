// SEC XBRL frames (EPS and revenue for every U.S. filer) and the Reg CF / Reg A offering data sets.
// Run: npm run sec:sync                          (write)
//      npm run sec:sync -- --dry-run             (fetch and report only)
//      npm run sec:sync -- --only=frames         (or datasets)
//      npm run sec:sync -- --budget=60           (frames per run)
// Needs SEC_USER_AGENT ("Company contact@domain"). Reads .env.local / .env when present.
import { existsSync } from "node:fs";
import { runSecSync, type SecPart } from "../src/lib/sec/sync";
import { sql } from "../src/lib/db/postgres";
import { memoryStore } from "../src/lib/market/store";

for (const f of [".env.local", ".env"]) if (existsSync(f)) process.loadEnvFile(f);
const dry = process.argv.includes("--dry-run");
const noDb = !process.env.DATABASE_URL && !(process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL);
const store = dry && noDb ? memoryStore() : undefined;
if (store) console.log("No database configured: dry run against an empty in-memory store.\n");
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];
const only = arg("only")?.split(",").filter((x): x is SecPart => x === "frames" || x === "datasets");
const budget = arg("budget") ? Number(arg("budget")) : undefined;
const r = await runSecSync({ store, dryRun: dry, only: only?.length ? only : undefined, budget });
console.log(r.note);
for (const [k, s] of Object.entries(r.sources)) if (s.error) console.log(`  ${k}: ${s.error}`);
for (const f of r.frames.failed) console.log(`  frame ${f}`);
if (r.dryRun) console.log("DRY RUN (nothing written)");
if (process.env.DATABASE_URL && !process.env.SUPABASE_SERVICE_ROLE_KEY) await sql().end({ timeout: 2 });
