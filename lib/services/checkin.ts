import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db";
import { checkins, events, exhibitVisits, exhibits, users } from "../db/schema";
import { verifyEventToken, verifyPassToken, verifyTagToken } from "../checkin/token";

export type CheckinResult =
  | { ok: true; eventId: number; title: string; duplicate: boolean }
  | { ok: false; error: "invalid_token" | "not_found" | "closed" | "full" };

// Check-in opens an hour before the start and closes when the event ends.
const EARLY_MS = 60 * 60 * 1000;

async function record(db: Db, userId: number, eventId: number, method: "qr" | "nfc" | "pass" | "manual", now: Date): Promise<CheckinResult> {
  const [ev] = await db.select().from(events).where(eq(events.id, eventId));
  if (!ev) return { ok: false, error: "not_found" };
  if (method !== "manual" && (now.getTime() < ev.startsAt.getTime() - EARLY_MS || now > ev.endsAt)) return { ok: false, error: "closed" };

  const [existing] = await db.select().from(checkins).where(and(eq(checkins.eventId, eventId), eq(checkins.userId, userId)));
  if (existing) return { ok: true, eventId, title: ev.title, duplicate: true };

  if (ev.capacity != null) {
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(checkins).where(eq(checkins.eventId, eventId));
    if (n >= ev.capacity && method !== "manual") return { ok: false, error: "full" };
  }
  const inserted = await db.insert(checkins).values({ eventId, userId, method, at: now }).onConflictDoNothing().returning();
  return { ok: true, eventId, title: ev.title, duplicate: inserted.length === 0 };
}

/** Student scans a rotating screen QR (method qr) or taps a static NFC/printed tag (method nfc). */
export async function checkInStudent(db: Db, secret: string, userId: number, token: string, now = new Date()): Promise<CheckinResult> {
  const rotating = verifyEventToken(secret, token, now.getTime());
  if (rotating != null) return record(db, userId, rotating, "qr", now);
  const tag = verifyTagToken(secret, token);
  if (tag?.kind === "event") return record(db, userId, tag.id, "nfc", now);
  return { ok: false, error: "invalid_token" };
}

/** Teacher scans a student's personal pass for a given event. */
export async function checkInByPass(db: Db, secret: string, eventId: number, passToken: string, now = new Date()) {
  const userId = verifyPassToken(secret, passToken);
  if (userId == null) return { ok: false as const, error: "invalid_token" as const };
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u) return { ok: false as const, error: "not_found" as const };
  const r = await record(db, userId, eventId, "pass", now);
  return r.ok ? { ...r, student: u.name } : r;
}

export async function manualCheckIn(db: Db, eventId: number, userId: number) {
  return record(db, userId, eventId, "manual", new Date());
}

export async function undoCheckIn(db: Db, eventId: number, userId: number) {
  await db.delete(checkins).where(and(eq(checkins.eventId, eventId), eq(checkins.userId, userId)));
}

export async function attendees(db: Db, eventId: number) {
  return db
    .select({ userId: users.id, name: users.name, className: users.className, method: checkins.method, at: checkins.at })
    .from(checkins)
    .innerJoin(users, eq(users.id, checkins.userId))
    .where(eq(checkins.eventId, eventId))
    .orderBy(checkins.at);
}

/** Student scans an exhibit's QR/NFC tag. */
export async function visitExhibit(db: Db, secret: string, userId: number, token: string) {
  const tag = verifyTagToken(secret, token);
  if (tag?.kind !== "exhibit") return { ok: false as const, error: "invalid_token" as const };
  const [ex] = await db.select().from(exhibits).where(eq(exhibits.id, tag.id));
  if (!ex) return { ok: false as const, error: "not_found" as const };
  await db.insert(exhibitVisits).values({ exhibitId: ex.id, userId }).onConflictDoNothing();
  return { ok: true as const, slug: ex.slug };
}
