import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { users } from "./db/schema";
import { readSession, type Role } from "./services/auth";

export const COOKIE = "session";

export function secret() {
  const s = process.env.CHECKIN_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production") throw new Error("CHECKIN_SECRET must be set in production");
  return "dev-only-secret";
}

export async function currentUser() {
  const id = readSession(secret(), (await cookies()).get(COOKIE)?.value);
  if (id == null) return null;
  const db = await getDb();
  const [u] = await db.select().from(users).where(eq(users.id, id));
  return u ?? null;
}

export async function requireUser(next?: string) {
  const u = await currentUser();
  if (!u) redirect(`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  return u;
}

export async function requireStaff() {
  const u = await requireUser("/admin");
  if (u.role === "student") redirect("/");
  return u;
}

export const isStaff = (r: Role) => r !== "student";
