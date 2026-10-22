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
import { checkInStudent, visitExhibit } from "@/lib/services/checkin";
import { seedDemo } from "@/lib/seed";

// Only same-site relative paths, to avoid open redirects after login.
const safeNext = (n: FormDataEntryValue | null) => (typeof n === "string" && n.startsWith("/") && !n.startsWith("//") ? n : "/");

export async function login(_: unknown, form: FormData) {
  const db = await getDb();
  if (process.env.NODE_ENV !== "production" && !process.env.DATABASE_URL) await seedDemo(db);
  const u = await loginWithCode(db, String(form.get("email") ?? ""), String(form.get("code") ?? ""));
  if (!u) return { error: "Email or code not recognised." };
  (await cookies()).set(COOKIE, createSession(secret(), u.id), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 45 * 86400 });
  redirect(safeNext(form.get("next")));
}

export async function logout() {
  (await cookies()).delete(COOKIE);
  redirect("/login");
}

/** Used by the in-app scanner: accepts a raw token or a full /c/<token> URL. */
export async function submitScan(raw: string) {
  const user = await requireUser();
  const token = raw.trim().split("/c/").pop()!.split(/[?#]/)[0];
  const db = await getDb();
  if (token.startsWith("exhibit.")) {
    const r = await visitExhibit(db, secret(), user.id, token);
    return r.ok ? { ok: true as const, message: "Exhibit visit recorded", href: `/exhibits/${r.slug}` } : { ok: false as const, message: "That exhibit code isn't valid." };
  }
  const r = await checkInStudent(db, secret(), user.id, token);
  revalidatePath("/");
  if (r.ok) return { ok: true as const, message: r.duplicate ? `Already checked in to ${r.title}` : `Checked in to ${r.title}!` };
  const msg = { invalid_token: "That code is invalid or expired. Scan the live screen again.", not_found: "Event not found.", closed: "Check-in isn't open for this event.", full: "This event is full." }[r.error];
  return { ok: false as const, message: msg };
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
