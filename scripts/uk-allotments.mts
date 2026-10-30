// Reads the Companies House filing stream for a while and keeps every new UK share allotment (SH01).
// Run: npm run uk:allotments                  (write)
//      npm run uk:allotments -- --dry-run     (read and report only)
// Needs COMPANIES_HOUSE_STREAM_KEY (Streaming API key). Reads .env.local / .env when present.
import { existsSync } from "node:fs";
import { runUkAllotments } from "../src/lib/ukstream/sync";
import { sql } from "../src/lib/db/postgres";
import { memoryStore } from "../src/lib/market/store";

for (const f of [".env.local", ".env"]) if (existsSync(f)) process.loadEnvFile(f);
const dry = process.argv.includes("--dry-run");
const noDb = !process.env.DATABASE_URL && !(process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL);
const store = dry && noDb ? memoryStore() : undefined;
const ms = Number(process.argv.find((a) => a.startsWith("--seconds"))?.split("=")[1] ?? 60) * 1000;
const r = await runUkAllotments({ store, dryRun: dry, readMs: ms });
console.log(r.note); if (r.dryRun) console.log("DRY RUN (nothing written)");
if (process.env.DATABASE_URL && !process.env.SUPABASE_SERVICE_ROLE_KEY) await sql().end({ timeout: 2 });
