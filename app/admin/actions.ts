"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { competitions, events, exhibitOwners, exhibits, users, auditLog } from "@/lib/db/schema";
import { requireStaff, secret } from "@/lib/session";
import { importRoster, parseRosterCsv } from "@/lib/services/auth";
import { checkInByPass, manualCheckIn, undoCheckIn } from "@/lib/services/checkin";
import { updateEntry, type EntryStatus } from "@/lib/services/competitions";
import { publishAwards, removeDraftResult, runAwards, scoreExhibit } from "@/lib/services/awards";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export async function saveEvent(form: FormData) {
  await requireStaff();
  const values = {
    title: str(form, "title"), subject: str(form, "subject") as "physics" | "cs" | "both", venue: str(form, "venue") || null,
    description: str(form, "description"), startsAt: new Date(str(form, "startsAt")), endsAt: new Date(str(form, "endsAt")),
    capacity: str(form, "capacity") ? Number(str(form, "capacity")) : null,
  };
  if (!values.title || isNaN(+values.startsAt) || isNaN(+values.endsAt) || values.endsAt <= values.startsAt) return;
  const db = await getDb();
  const id = Number(str(form, "id"));
  if (id) await db.update(events).set(values).where(eq(events.id, id));
  else await db.insert(events).values(values);
  revalidatePath("/admin/events");
}

export async function deleteEvent(form: FormData) {
  await requireStaff();
  await (await getDb()).delete(events).where(eq(events.id, Number(str(form, "id"))));
  revalidatePath("/admin/events");
  redirect("/admin/events");
}

export async function manualAdd(form: FormData) {
  await requireStaff();
  const db = await getDb();
  const [u] = await db.select().from(users).where(eq(users.email, str(form, "email").toLowerCase()));
  if (u) await manualCheckIn(db, Number(str(form, "eventId")), u.id);
  revalidatePath(`/admin/events/${str(form, "eventId")}`);
}

export async function undo(form: FormData) {
  await requireStaff();
  await undoCheckIn(await getDb(), Number(str(form, "eventId")), Number(str(form, "userId")));
  revalidatePath(`/admin/events/${str(form, "eventId")}`);
}

export async function scanPass(eventId: number, token: string) {
  await requireStaff();
  const r = await checkInByPass(await getDb(), secret(), eventId, token.trim());
  if (r.ok) return { ok: true as const, message: `${r.student} ${r.duplicate ? "was already checked in" : "checked in"}` };
  return { ok: false as const, message: ({ invalid_token: "Not a valid pass", not_found: "Student or event not found", closed: "Closed", full: "Event is full" } as const)[r.error] };
}

export async function saveExhibit(form: FormData) {
  await requireStaff();
  const title = str(form, "title");
  if (!title) return;
  const db = await getDb();
  const slug = slugify(str(form, "slug") || title);
  const values = { slug, title, subject: str(form, "subject") as "physics" | "cs" | "both", summary: str(form, "summary"), bodyMd: str(form, "bodyMd"), imageUrl: str(form, "imageUrl") || null };
  const [ex] = await db.insert(exhibits).values(values).onConflictDoUpdate({ target: exhibits.slug, set: values }).returning();
  const emails = str(form, "owners").split(/[,\s]+/).filter(Boolean).map((e) => e.toLowerCase());
  if (emails.length) {
    await db.delete(exhibitOwners).where(eq(exhibitOwners.exhibitId, ex.id));
    for (const email of emails) {
      const [u] = await db.select().from(users).where(eq(users.email, email));
      if (u) await db.insert(exhibitOwners).values({ exhibitId: ex.id, userId: u.id }).onConflictDoNothing();
    }
  }
  revalidatePath("/admin/exhibits");
}

export async function saveCompetition(form: FormData) {
  await requireStaff();
  const name = str(form, "name");
  if (!name) return;
  await (await getDb()).insert(competitions).values({ name, eventId: Number(str(form, "eventId")), isTeam: form.get("isTeam") === "on" });
  revalidatePath("/admin/competitions");
}

export async function saveEntry(form: FormData) {
  await requireStaff();
  const num = (k: string) => (str(form, k) === "" ? null : Number(str(form, k)));
  await updateEntry(await getDb(), Number(str(form, "id")), { status: str(form, "status") as EntryStatus, score: num("score"), rank: num("rank"), notes: str(form, "notes") || null });
  revalidatePath("/admin/competitions");
}

export async function importRosterAction(_: unknown, form: FormData) {
  await requireStaff();
  try {
    const rows = parseRosterCsv(str(form, "csv"));
    const issued = await importRoster(await getDb(), rows);
    return { error: null, issued };
  } catch (e) {
    return { error: (e as Error).message, issued: [] };
  }
}

export async function runAwardsAction() {
  const u = await requireStaff();
  await runAwards(await getDb(), u.id);
  revalidatePath("/admin/awards");
}

export async function vetoAction(form: FormData) {
  const u = await requireStaff();
  await removeDraftResult(await getDb(), Number(str(form, "id")), u.id, str(form, "reason") || "no reason given");
  revalidatePath("/admin/awards");
}

export async function publishAction() {
  const u = await requireStaff();
  await publishAwards(await getDb(), u.id);
  revalidatePath("/admin/awards");
}

export async function judgeScoreAction(form: FormData) {
  const u = await requireStaff();
  await scoreExhibit(await getDb(), u.id, Number(str(form, "exhibitId")), Number(str(form, "score")));
  revalidatePath("/admin/awards");
}

export async function setRole(form: FormData) {
  const me = await requireStaff();
  if (me.role !== "admin") return;
  const role = str(form, "role") as "student" | "teacher" | "admin";
  const db = await getDb();
  await db.update(users).set({ role }).where(eq(users.email, str(form, "email").toLowerCase()));
  await db.insert(auditLog).values({ actorId: me.id, action: "role.set", detail: { email: str(form, "email"), role } });
  revalidatePath("/admin");
}
