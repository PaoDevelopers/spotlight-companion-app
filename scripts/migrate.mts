// Applies SQL migrations to DATABASE_URL. Runs as part of `npm run build` so deploys (Vercel) migrate
// before the new code goes live. No DATABASE_URL (local builds, CI) means nothing to do.
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { connectPostgres, schema, type Db } from "../lib/db";
import { seedDemo } from "../lib/seed";

const url = process.env.DATABASE_URL;
if (!url) {
  console.log("[migrate] DATABASE_URL not set, skipping");
  process.exit(0);
}
const sql = connectPostgres(url);
const db = drizzle(sql, { schema });
await migrate(db, { migrationsFolder: "./drizzle" });
console.log("[migrate] migrations applied");

// Opt-in: SEED_DEMO=1 loads FAKE demo accounts/data once and prints their one-time login codes in the
// build log (only team members can read it). Remove the variable afterwards. Never use with real data.
if (process.env.SEED_DEMO === "1") {
  delete process.env.DEMO_LOGIN_CODE;
  const codes = await seedDemo(db as unknown as Db);
  if (!codes) console.log("[seed] demo accounts already exist, nothing changed");
  else for (const [email, code] of Object.entries(codes)) console.log(`[seed] ${email} login code: ${code}`);
}
await sql.end();
