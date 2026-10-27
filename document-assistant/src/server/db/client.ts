import fs from "node:fs";
import path from "node:path";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { getConfig } from "../config";
import * as schema from "./schema";

/**
 * Database access.
 *
 * - Production / staging: managed PostgreSQL (Azure Database for PostgreSQL) via node-postgres.
 * - Local development and automated tests: PGlite, a full PostgreSQL engine embedded in the
 *   process, so the owner can run the app without installing a database server.
 *
 * Both drivers speak the same PostgreSQL dialect and share one schema and one set of migrations.
 */
export type DB = NodePgDatabase<typeof schema>;

type Holder = { db?: DB; ready?: Promise<DB>; close?: () => Promise<void> };
const g = globalThis as unknown as { __fdaDb?: Holder };
const holder: Holder = (g.__fdaDb ??= {});

export const MIGRATIONS_DIR = path.resolve(process.cwd(), "drizzle");

export async function createDatabase(url: string, opts: { migrate?: boolean } = {}): Promise<{ db: DB; close: () => Promise<void> }> {
  if (url.startsWith("pglite:")) {
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    const location = url.slice("pglite:".length);
    let client;
    if (location === "memory" || location === "") {
      client = new PGlite();
    } else {
      const dir = path.resolve(process.cwd(), location);
      fs.mkdirSync(dir, { recursive: true });
      client = new PGlite(dir);
    }
    await client.waitReady;
    const db = drizzle(client, { schema }) as unknown as DB;
    if (opts.migrate) {
      const { migrate } = await import("drizzle-orm/pglite/migrator");
      await migrate(db as never, { migrationsFolder: MIGRATIONS_DIR });
    }
    return { db, close: () => client.close() };
  }
  const pg = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const pool = new pg.default.Pool({
    connectionString: url,
    max: 10,
    ssl: /sslmode=require|azure\.com/.test(url) ? { rejectUnauthorized: true } : undefined,
  });
  const db = drizzle(pool, { schema });
  if (opts.migrate) {
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  }
  return { db, close: () => pool.end() };
}

/** Returns the shared application database, connecting (and in development migrating) on first use. */
export async function getDb(): Promise<DB> {
  if (holder.db) return holder.db;
  if (!holder.ready) {
    holder.ready = (async () => {
      const config = getConfig();
      const autoMigrate = !config.isProduction;
      const { db, close } = await createDatabase(config.DATABASE_URL, { migrate: autoMigrate });
      if (autoMigrate) {
        const { ensureBaseline } = await import("./bootstrap");
        await ensureBaseline(db);
      }
      holder.db = db;
      holder.close = close;
      return db;
    })().catch((err) => {
      holder.ready = undefined;
      throw err;
    });
  }
  return holder.ready;
}

/** Test hook: point the application at a specific database instance. */
export function setDbForTesting(db: DB | undefined) {
  holder.db = db;
  holder.ready = db ? Promise.resolve(db) : undefined;
}

export async function closeDb() {
  await holder.close?.();
  holder.db = undefined;
  holder.ready = undefined;
  holder.close = undefined;
}
