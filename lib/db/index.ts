import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import { drizzle as drizzleLite } from "drizzle-orm/pglite";
import { migrate as migratePg } from "drizzle-orm/postgres-js/migrator";
import { migrate as migrateLite } from "drizzle-orm/pglite/migrator";
import postgres from "postgres";
import { PGlite } from "@electric-sql/pglite";
import * as schema from "./schema";
import { bootstrapAdmins } from "./bootstrap";

// Both drivers expose the same query API; services only use this shared surface.
export type Db = ReturnType<typeof drizzleLite<typeof schema>>;

const MIGRATIONS = { migrationsFolder: "./drizzle" };

/** In-memory Postgres (WASM) for tests and zero-setup local dev. */
export async function createMemoryDb(): Promise<Db> {
  const db = drizzleLite(new PGlite(), { schema });
  await migrateLite(db, MIGRATIONS);
  return db;
}

// Kept on globalThis: Next bundles routes/actions separately in dev, and each copy of this module
// would otherwise get its own in-memory database.
const g = globalThis as unknown as { __db?: Promise<Db> };

/** Real Postgres when DATABASE_URL is set; otherwise an in-memory DB (data resets on restart). */
export function getDb(): Promise<Db> {
  g.__db ??= (async () => {
    const url = process.env.DATABASE_URL;
    if (!url) return createMemoryDb();
    const db = drizzlePg(postgres(url, { max: 5 }), { schema });
    await migratePg(db, MIGRATIONS);
    await bootstrapAdmins(db as unknown as Db);
    return db as unknown as Db;
  })();
  return g.__db;
}

export { schema };
