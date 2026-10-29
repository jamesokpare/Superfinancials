// Loads supabase/seed-data/<collection>/<doc_id>.json into the docs table.
// These are the shared documents exported from the original artifact's
// database: live EOD prices (mkt), Studio content (adm_*), energyinfra.
//
// Usage: SUPABASE_SERVICE_ROLE_KEY=... NEXT_PUBLIC_SUPABASE_URL=... node scripts/seed.mjs
// (both are read from .env.local automatically when present)
import { createClient } from "@supabase/supabase-js";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (in .env.local or the environment).");
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });
const root = "supabase/seed-data";
const rows = [];
for (const col of readdirSync(root)) {
  for (const file of readdirSync(join(root, col)).filter((f) => f.endsWith(".json"))) {
    const id = file.slice(0, -5);
    rows.push({ path: `${col}/${id}`, parent: col, id, data: JSON.parse(readFileSync(join(root, col, file), "utf8")) });
  }
}

for (let i = 0; i < rows.length; i += 50) {
  const batch = rows.slice(i, i + 50);
  const { error } = await sb.from("docs").upsert(batch);
  if (error) { console.error(`Failed at ${batch[0].path}:`, error.message); process.exit(1); }
}
console.log(`Seeded ${rows.length} documents.`);
