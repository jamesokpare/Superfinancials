// Applies supabase/migrations to an in-memory Postgres (PGlite) with stubbed
// Supabase auth/storage schemas, then checks the row-level security rules.
// Run: npm test
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
const db = new PGlite();
const q = (s, p) => db.query(s, p);
await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create schema storage;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);
create table storage.objects (id serial, bucket_id text, name text);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql as $$ select string_to_array(name, '/') $$;
create publication supabase_realtime;
`);
for (const f of readdirSync("supabase/migrations").sort()) await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));
await db.exec(`grant usage on schema public, auth, storage to anon, authenticated;
grant all on all tables in schema public to anon, authenticated; grant execute on all functions in schema public, auth to anon, authenticated;`);

const A = "11111111-1111-1111-1111-111111111111", B = "22222222-2222-2222-2222-222222222222";
await q(`insert into auth.users values ($1,'a@x.com','{"name":"Alice"}'),($2,'b@x.com','{}')`, [A, B]);

await q(`update profiles set is_admin = true where id = $1`, [A]); // service role (superuser here)
await q(`insert into docs(path,parent,id,data) values ('mkt/_meta','mkt','_meta','{"n":1}'),('orgs/${B}','orgs','${B}','{"name":"B org"}')`);

async function as(uid, fn) {
  await db.exec(`set role ${uid ? "authenticated" : "anon"}`);
  await q(`select set_config('request.jwt.claim.sub', $1, false)`, [uid ?? ""]);
  try { return await fn(); } catch (e) { return "ERR " + (e.code ?? "") + " " + e.message; } finally { await db.exec("reset role"); }
}
const rows = (s, p) => async () => (await q(s, p)).rows;
const n = (s, p) => async () => (await q(s, p)).affectedRows;
let fails = 0;
const t = async (label, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log((ok ? "PASS " : "FAIL ") + label, ok ? "" : JSON.stringify(got)); };

await t("anon reads mkt", await as(null, rows("select path from docs where parent='mkt'")), [{ path: "mkt/_meta" }]);
await t("anon cannot read orgs", await as(null, rows("select path from docs where parent='orgs'")), []);
await t("B reads orgs", await as(B, rows("select path from docs where parent='orgs'")), [{ path: `orgs/${B}` }]);
await t("anon cannot write mkt", (await as(null, rows("insert into docs(path,parent,id) values ('mkt/x','mkt','x')"))).startsWith("ERR 42501"), true);
await t("B cannot write mkt", (await as(B, rows("insert into docs(path,parent,id) values ('mkt/x','mkt','x')"))).startsWith("ERR 42501"), true);
await t("A (admin) writes mkt", await as(A, n("insert into docs(path,parent,id) values ('mkt/x','mkt','x')")), 1);
await t("B writes own org member", await as(B, n(`insert into docs(path,parent,id,data) values ('orgs/${B}/members/${A}','orgs/${B}/members','${A}','{"role":"member"}')`)), 1);
await t("B cannot write A's outbox", (await as(B, rows(`insert into docs(path,parent,id) values ('outbox/${A}','outbox','${A}')`))).startsWith("ERR 42501"), true);
await t("B updates a member doc in its own org", await as(B, n(`update docs set data='{}' where path='orgs/${B}/members/${A}'`)), 1);
await t("admin may modify any org", await as(A, n(`update docs set data='{}' where path='orgs/${B}'`)), 1); // admin may
await t("B private data", await as(B, n(`insert into docs(path,parent,id) values ('data/users/${B}/ws','data/users/${B}','ws')`)), 1);
await t("A cannot read B private (admin too)", await as(A, rows(`select path from docs where path like 'data/%'`)), []);
// Workspaces (public/legacy/workspace.js): data/users/<uid>/workspace, readable and writable by its owner only.
await t("B saves own workspace", await as(B, n(`insert into docs(path,parent,id,data) values ('data/users/${B}/workspace','data/users/${B}','workspace','{"type":"workspace","savedAt":1,"ws":{"v":1}}') on conflict (path) do update set data = excluded.data`)), 1);
await t("B reads own workspace", await as(B, rows(`select path from docs where path = 'data/users/${B}/workspace'`)), [{ path: `data/users/${B}/workspace` }]);
await t("anon cannot read a workspace", await as(null, rows(`select path from docs where path like 'data/users/%/workspace'`)), []);
await t("B cannot write A's workspace", (await as(B, rows(`insert into docs(path,parent,id,data) values ('data/users/${A}/workspace','data/users/${A}','workspace','{}')`))).startsWith("ERR 42501"), true);
await t("bad path shape rejected", (await as(A, rows("insert into docs(path,parent,id) values ('mkt','','mkt')"))).startsWith("ERR"), true);
await q(`update docs set data='{"a":{"x":1,"y":[1,2]},"k":1}' where path='orgs/${B}'`);
await t("docs_merge deep merge", await as(B, async () => { await q(`select docs_merge($1, $2::jsonb)`, [`orgs/${B}`, '{"a":{"y":[3],"z":2},"n":5}']); return (await q(`select data from docs where path=$1`, [`orgs/${B}`])).rows[0].data; }), { a: { x: 1, y: [3], z: 2 }, k: 1, n: 5 });
await t("docs_merge missing doc", (await as(B, rows(`select docs_merge('orgs/${B}/members/nobody','{}')`))).startsWith("ERR P0002"), true);
await t("user cannot self-promote", (await as(B, rows(`update profiles set is_admin=true where id='${B}'`))).startsWith("ERR 42501"), true);
await t("user can rename self", await as(B, n(`update profiles set name='Bob' where id='${B}'`)), 1);
await t("user cannot rename other", await as(B, n(`update profiles set name='X' where id='${A}'`)), 0);
await t("B writes own public key", await as(B, n(`insert into docs(path,parent,id,data) values ('pk/${B}','pk','${B}','{"x":"1"}')`)), 1);
await t("B cannot write A public key", (await as(B, rows(`insert into docs(path,parent,id,data) values ('pk/${A}','pk','${A}','{}')`))).startsWith("ERR"), true);
await t("signed-in reads public keys", await as(A, rows("select path from docs where parent='pk'")), [{ path: `pk/${B}` }]);
await t("anon cannot read public keys", await as(null, rows("select path from docs where parent='pk'")), []);
await t("admin adds a registry company", await as(A, n(`insert into docs(path,parent,id,data) values ('adm_reg/ng-rc123','adm_reg','ng-rc123','{"name":"X"}')`)), 1);
await t("non-admin cannot add a registry company", (await as(B, rows(`insert into docs(path,parent,id,data) values ('adm_reg/ng-rc999','adm_reg','ng-rc999','{}')`))).startsWith("ERR"), true);
await t("non-admin cannot edit a registry company", await as(B, n(`update docs set data='{"name":"Y"}' where path='adm_reg/ng-rc123'`)), 0);
await t("non-admin cannot delete a registry company", await as(B, n(`delete from docs where path='adm_reg/ng-rc123'`)), 0);
await t("anyone reads the registry", await as(null, rows("select path from docs where parent='adm_reg'")), [{ path: "adm_reg/ng-rc123" }]);
await t("is_admin()", await as(A, rows("select public.is_admin() as a")), [{ a: true }]);

console.log(fails ? `${fails} FAILED` : "all passed");
if (fails) process.exit(1);
