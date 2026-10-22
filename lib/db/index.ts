import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import type { drizzle as drizzleLite } from "drizzle-orm/pglite";
import { migrate as migratePg } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as schema from "./schema";
import { bootstrapAdmins } from "./bootstrap";

// Both drivers expose the same query API; services only use this shared surface.
export type Db = ReturnType<typeof drizzleLite<typeof schema>>;

const MIGRATIONS = { migrationsFolder: "./drizzle" };

/** In-memory Postgres (WASM) for tests and zero-setup local dev. */
export async function createMemoryDb(): Promise<Db> {
  // Loaded lazily so the WASM engine isn't pulled into production (Vercel) bundles that use real Postgres.
  const [{ PGlite }, { drizzle }, { migrate }] = await Promise.all([
    import("@electric-sql/pglite"),
    import("drizzle-orm/pglite"),
    import("drizzle-orm/pglite/migrator"),
  ]);
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, MIGRATIONS);
  return db;
}

/**
 * One small connection per serverless instance. `prepare: false` keeps it compatible with pooled
 * (pgbouncer transaction mode) URLs such as Neon's "-pooler" host, which don't support prepared statements.
 */
export function connectPostgres(url: string) {
  return postgres(url, { max: 1, prepare: false });
}

// Kept on globalThis: Next bundles routes/actions separately in dev, and each copy of this module
// would otherwise get its own in-memory database.
const g = globalThis as unknown as { __db?: Promise<Db> };

/** Real Postgres when DATABASE_URL is set; otherwise an in-memory DB (data resets on restart). */
export function getDb(): Promise<Db> {
  g.__db ??= (async () => {
    const url = process.env.DATABASE_URL;
    if (!url) return createMemoryDb();
    const db = drizzlePg(connectPostgres(url), { schema });
    // Deployments migrate during the build (scripts/migrate.ts); set SKIP_RUNTIME_MIGRATE=1 to skip it here.
    if (!process.env.SKIP_RUNTIME_MIGRATE) await migratePg(db, MIGRATIONS);
    await bootstrapAdmins(db as unknown as Db);
    return db as unknown as Db;
  })();
  return g.__db;
}

export { schema };
