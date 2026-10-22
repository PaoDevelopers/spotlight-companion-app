// Applies SQL migrations to DATABASE_URL. Runs as part of `npm run build` so deploys (Vercel) migrate
// before the new code goes live. No DATABASE_URL (local builds, CI) means nothing to do.
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { connectPostgres } from "../lib/db";

const url = process.env.DATABASE_URL;
if (!url) {
  console.log("[migrate] DATABASE_URL not set, skipping");
  process.exit(0);
}
const sql = connectPostgres(url);
await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
await sql.end();
console.log("[migrate] migrations applied");
