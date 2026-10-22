"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { COOKIE, requireUser, secret } from "@/lib/session";
import { createSession, loginWithCode } from "@/lib/services/auth";
import { castVote } from "@/lib/services/awards";
import { register } from "@/lib/services/competitions";
import { seedDemo } from "@/lib/seed";
import { processScan } from "@/lib/scan";
import { clearFailures, recordFailure, tooManyFailures } from "@/lib/rateLimit";

// Only same-site relative paths, to avoid open redirects after login.
const safeNext = (n: FormDataEntryValue | null) => (typeof n === "string" && n.startsWith("/") && !n.startsWith("//") ? n : "/");

export async function login(_: unknown, form: FormData) {
  const db = await getDb();
  if (process.env.NODE_ENV !== "production" && !process.env.DATABASE_URL) await seedDemo(db);
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (tooManyFailures(email)) return { error: "Too many attempts. Try again in 10 minutes or ask your teacher." };
  const u = await loginWithCode(db, email, String(form.get("code") ?? ""));
  if (!u) { recordFailure(email); return { error: "Email or code not recognised." }; }
  clearFailures(email);
  (await cookies()).set(COOKIE, createSession(secret(), u.id), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 45 * 86400 });
  redirect(safeNext(form.get("next")));
}

export async function logout() {
  (await cookies()).delete(COOKIE);
  redirect("/login");
}

/** Used by the in-app scanner. The /c/[token] page calls processScan directly (can't revalidate during render). */
export async function submitScan(raw: string) {
  const r = await processScan(raw);
  revalidatePath("/");
  return r;
}

export async function toggleLeaderboard(form: FormData) {
  const u = await requireUser();
  const db = await getDb();
  await db.update(users).set({ showOnLeaderboard: form.get("show") === "on" }).where(eq(users.id, u.id));
  revalidatePath("/me");
}

export async function vote(form: FormData) {
  const u = await requireUser();
  const id = Number(form.get("exhibitId"));
  await castVote(await getDb(), u.id, id);
  revalidatePath("/exhibits");
}

export async function registerForCompetition(form: FormData) {
  const u = await requireUser();
  await register(await getDb(), Number(form.get("competitionId")), u.id, String(form.get("team") ?? "") || undefined);
  revalidatePath("/competitions");
}
