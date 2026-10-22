// Seeds FAKE demo data (demo teacher + student, sample events/exhibits/competition) into DATABASE_URL
// and prints the login codes once. Never run against a database holding real student records.
//   DATABASE_URL=postgres://... npm run seed
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { connectPostgres, schema, type Db } from "../lib/db";
import { seedDemo } from "../lib/seed";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("Set DATABASE_URL to the database to seed");
delete process.env.DEMO_LOGIN_CODE; // fixed codes are for local tests only; here codes are random

const sql = connectPostgres(url);
const db = drizzle(sql, { schema });
await migrate(db, { migrationsFolder: "./drizzle" });
const codes = await seedDemo(db as unknown as Db);
await sql.end();

if (!codes) console.log("Demo data already present (teacher@demo.school exists); nothing changed.");
else {
  console.log("Seeded demo data. One-time login codes (not stored in plain text, so note them now):");
  for (const [email, code] of Object.entries(codes)) console.log(`  ${email}  ${code}`);
}
