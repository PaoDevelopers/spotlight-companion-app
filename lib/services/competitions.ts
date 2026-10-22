import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db";
import { checkins, competitionEntries, competitions, events, exhibitVisits, users } from "../db/schema";

export type EntryStatus = "registered" | "competing" | "advanced" | "eliminated" | "finished";

export async function register(db: Db, competitionId: number, userId: number, teamName?: string) {
  await db.insert(competitionEntries).values({ competitionId, userId, teamName: teamName || null }).onConflictDoNothing();
}

export async function updateEntry(db: Db, entryId: number, patch: { status?: EntryStatus; score?: number | null; rank?: number | null; notes?: string | null }) {
  await db.update(competitionEntries).set(patch).where(eq(competitionEntries.id, entryId));
}

export async function myCompetitions(db: Db, userId: number) {
  return db
    .select({ entryId: competitionEntries.id, competition: competitions.name, event: events.title, status: competitionEntries.status, score: competitionEntries.score, rank: competitionEntries.rank })
    .from(competitionEntries)
    .innerJoin(competitions, eq(competitions.id, competitionEntries.competitionId))
    .innerJoin(events, eq(events.id, competitions.eventId))
    .where(eq(competitionEntries.userId, userId));
}

/** Public label: real name only for students who opted in, otherwise class (or "Anonymous"). */
export function publicName(u: { name: string; className: string | null; showOnLeaderboard: boolean }) {
  return u.showOnLeaderboard ? u.name : u.className ? `Student, ${u.className}` : "Anonymous";
}

export async function competitionLeaderboard(db: Db, competitionId: number) {
  const rows = await db
    .select({ id: competitionEntries.id, userId: users.id, name: users.name, className: users.className, show: users.showOnLeaderboard, teamName: competitionEntries.teamName, status: competitionEntries.status, score: competitionEntries.score, rank: competitionEntries.rank })
    .from(competitionEntries)
    .innerJoin(users, eq(users.id, competitionEntries.userId))
    .where(eq(competitionEntries.competitionId, competitionId));
  return rows
    .map((r) => ({ ...r, label: r.teamName ?? publicName({ name: r.name, className: r.className, showOnLeaderboard: r.show }) }))
    .sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || (b.score ?? -1) - (a.score ?? -1));
}

const PLACE_POINTS: Record<number, number> = { 1: 10, 2: 6, 3: 3 };

/** Month leaderboard: 1pt per event attended + 1pt per exhibit visited + placement bonus. */
export async function monthLeaderboard(db: Db, limit = 20) {
  const [att, vis, comp, us] = await Promise.all([
    db.select({ userId: checkins.userId, n: sql<number>`count(*)::int` }).from(checkins).groupBy(checkins.userId),
    db.select({ userId: exhibitVisits.userId, n: sql<number>`count(*)::int` }).from(exhibitVisits).groupBy(exhibitVisits.userId),
    db.select({ userId: competitionEntries.userId, rank: competitionEntries.rank }).from(competitionEntries).where(sql`${competitionEntries.rank} is not null`),
    db.select().from(users).where(and(eq(users.role, "student"))),
  ]);
  const pts = new Map<number, number>();
  const add = (id: number, n: number) => pts.set(id, (pts.get(id) ?? 0) + n);
  att.forEach((r) => add(r.userId, r.n));
  vis.forEach((r) => add(r.userId, r.n));
  comp.forEach((r) => add(r.userId, PLACE_POINTS[r.rank!] ?? 0));
  return us
    .map((u) => ({ userId: u.id, points: pts.get(u.id) ?? 0, label: publicName(u) }))
    .filter((r) => r.points > 0)
    .sort((a, b) => b.points - a.points || a.userId - b.userId)
    .slice(0, limit)
    .map((r, i) => ({ ...r, rank: i + 1 }));
}
