/**
 * Direct Postgres connection from DATABASE_URL, using postgres.js
 * (npm: postgres). Server-only: use it in route handlers, server actions and
 * scripts for queries that the Supabase client can't express well.
 *
 * With Supabase, copy the connection string from Project Settings → Database.
 * The transaction pooler (port 6543) does not support prepared statements,
 * so they are turned off automatically for that port.
 *
 *   import { sql } from "@/lib/db/postgres";
 *   const rows = await sql()`select path, data from docs where parent = ${p}`;
 */
import "server-only";
import postgres from "postgres";

export const ENV = "DATABASE_URL";

const g = globalThis as unknown as { __sfSql?: postgres.Sql };

export function sql(): postgres.Sql {
  if (g.__sfSql) return g.__sfSql;
  const url = process.env[ENV]?.trim();
  if (!url) throw new Error(`${ENV} is not set`);
  const pooled = new URL(url).port === "6543" || /pgbouncer=true/.test(url);
  // Reused across hot reloads in development and across requests in production.
  g.__sfSql = postgres(url, {
    max: Number(process.env.DATABASE_POOL_MAX) || 5,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: !pooled,
    ssl: /localhost|127\.0\.0\.1/.test(url) ? false : "require",
  });
  return g.__sfSql;
}

export const ping = async () => (await sql()`select 1 as ok`)[0];
