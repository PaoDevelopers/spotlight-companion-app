import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../db";
import { auditLog, awardResults, awards, checkins, exhibitOwners, exhibitVisits, exhibits, judgeScores, users, votes } from "../db/schema";
import { computeAwards, type AwardInput } from "../awards/compute";

export const CREATIVE = "creative";

export const DEFAULT_AWARDS = [
  { key: "participation", title: "Most Participation", config: {} },
  { key: "explorer", title: "Explorer", config: {} },
  { key: "creative", title: "Most Creative", config: { peer: 0.5, judge: 0.5 } },
];

export async function ensureAwards(db: Db) {
  for (const a of DEFAULT_AWARDS) await db.insert(awards).values(a).onConflictDoNothing();
}

/** One vote per student per category; owners can't vote for their own exhibit. */
export async function castVote(db: Db, voterId: number, exhibitId: number) {
  const owners = await db.select().from(exhibitOwners).where(and(eq(exhibitOwners.exhibitId, exhibitId), eq(exhibitOwners.userId, voterId)));
  if (owners.length) return { ok: false as const, error: "own_exhibit" as const };
  await db.insert(votes).values({ category: CREATIVE, exhibitId, voterId }).onConflictDoUpdate({ target: [votes.category, votes.voterId], set: { exhibitId } });
  return { ok: true as const };
}

export async function scoreExhibit(db: Db, judgeId: number, exhibitId: number, score: number) {
  const s = Math.max(0, Math.min(100, Math.round(score)));
  await db.insert(judgeScores).values({ category: CREATIVE, exhibitId, judgeId, score: s }).onConflictDoUpdate({ target: [judgeScores.category, judgeScores.exhibitId, judgeScores.judgeId], set: { score: s } });
}

async function gather(db: Db): Promise<{ input: AwardInput; weights: { peer: number; judge: number } }> {
  const [cs, vs, ex, vo, js, ow, cfg] = await Promise.all([
    db.select().from(checkins),
    db.select().from(exhibitVisits),
    db.select({ id: exhibits.id }).from(exhibits),
    db.select().from(votes).where(eq(votes.category, CREATIVE)),
    db.select().from(judgeScores).where(eq(judgeScores.category, CREATIVE)),
    db.select().from(exhibitOwners),
    db.select().from(awards).where(eq(awards.key, "creative")),
  ]);
  const owners = new Map<number, number[]>();
  ow.forEach((o) => owners.set(o.exhibitId, [...(owners.get(o.exhibitId) ?? []), o.userId]));
  const c = (cfg[0]?.config ?? {}) as { peer?: number; judge?: number };
  const weights = { peer: c.peer ?? 0.5, judge: c.judge ?? 0.5 };
  return {
    weights,
    input: {
      checkins: cs.map((x) => ({ userId: x.userId, eventId: x.eventId, at: x.at })),
      visits: vs.map((x) => ({ userId: x.userId, exhibitId: x.exhibitId })),
      totalExhibits: ex.length,
      votes: vo.map((x) => ({ voterId: x.voterId, exhibitId: x.exhibitId })),
      judgeScores: js.map((x) => ({ exhibitId: x.exhibitId, score: x.score })),
      exhibitOwners: [...owners].map(([exhibitId, userIds]) => ({ exhibitId, userIds })),
      creativeWeights: weights,
    },
  };
}

/** Dry run: pure computation, nothing written. */
export async function previewAwards(db: Db) {
  const { input } = await gather(db);
  return computeAwards(input);
}

/**
 * Compute and store results as drafts (published=false), replacing earlier drafts.
 * Published results are never touched, so re-running after publishing can't change what students saw.
 */
export async function runAwards(db: Db, actorId: number | null) {
  await ensureAwards(db);
  const result = await previewAwards(db);
  const defs = await db.select().from(awards);
  for (const def of defs) {
    const rows = result[def.key as keyof typeof result] ?? [];
    const alreadyPublished = await db.select().from(awardResults).where(and(eq(awardResults.awardId, def.id), eq(awardResults.published, true)));
    if (alreadyPublished.length) continue;
    await db.delete(awardResults).where(eq(awardResults.awardId, def.id));
    if (rows.length) await db.insert(awardResults).values(rows.map((r) => ({ awardId: def.id, userId: r.userId, rank: r.rank, metrics: r.metrics })));
  }
  await db.insert(auditLog).values({ actorId, action: "awards.run", detail: result });
  return result;
}

/** Teacher veto/adjust: remove a draft winner (ranks below move up). */
export async function removeDraftResult(db: Db, resultId: number, actorId: number, reason: string) {
  const [r] = await db.select().from(awardResults).where(eq(awardResults.id, resultId));
  if (!r || r.published) return false;
  await db.delete(awardResults).where(eq(awardResults.id, resultId));
  const rest = await db.select().from(awardResults).where(and(eq(awardResults.awardId, r.awardId), eq(awardResults.published, false)));
  for (const [i, x] of rest.sort((a, b) => a.rank - b.rank).entries()) await db.update(awardResults).set({ rank: i + 1 }).where(eq(awardResults.id, x.id));
  await db.insert(auditLog).values({ actorId, action: "awards.veto", detail: { resultId, userId: r.userId, awardId: r.awardId, reason } });
  return true;
}

export async function publishAwards(db: Db, actorId: number) {
  const drafts = await db.select({ id: awardResults.id }).from(awardResults).where(eq(awardResults.published, false));
  if (drafts.length) await db.update(awardResults).set({ published: true }).where(inArray(awardResults.id, drafts.map((d) => d.id)));
  await db.insert(auditLog).values({ actorId, action: "awards.publish", detail: { count: drafts.length } });
  return drafts.length;
}

export async function awardResultsFor(db: Db, opts: { published: boolean; userId?: number }) {
  const rows = await db
    .select({ id: awardResults.id, award: awards.title, key: awards.key, rank: awardResults.rank, metrics: awardResults.metrics, userId: users.id, name: users.name, className: users.className, published: awardResults.published })
    .from(awardResults)
    .innerJoin(awards, eq(awards.id, awardResults.awardId))
    .innerJoin(users, eq(users.id, awardResults.userId))
    .where(eq(awardResults.published, opts.published));
  return (opts.userId ? rows.filter((r) => r.userId === opts.userId) : rows).sort((a, b) => a.award.localeCompare(b.award) || a.rank - b.rank);
}
