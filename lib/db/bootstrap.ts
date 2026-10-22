import { eq } from "drizzle-orm";
import type { Db } from ".";
import { users } from "./schema";
import { generateLoginCode, hashCode } from "../services/auth";

/**
 * Creates the first admin(s) from ADMIN_EMAILS (comma-separated). A new login code is printed to the
 * server log once, only for accounts that don't exist yet. Afterwards admins promote teachers in /admin.
 */
export async function bootstrapAdmins(db: Db) {
  for (const email of (process.env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean)) {
    const [u] = await db.select().from(users).where(eq(users.email, email));
    if (u) continue;
    const code = generateLoginCode();
    await db.insert(users).values({ email, name: email.split("@")[0], role: "admin", loginCodeHash: hashCode(code) });
    console.log(`[bootstrap] admin ${email} created. One-time login code: ${code}`);
  }
}
