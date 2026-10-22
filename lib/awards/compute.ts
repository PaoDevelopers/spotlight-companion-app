export type Checkin = { userId: number; eventId: number; at: Date };
export type Visit = { userId: number; exhibitId: number };
export type Vote = { voterId: number; exhibitId: number };
export type JudgeScore = { exhibitId: number; score: number }; // 0-100
export type ExhibitOwner = { exhibitId: number; userIds: number[] };

export type AwardInput = {
  checkins: Checkin[];
  visits: Visit[];
  totalExhibits: number;
  votes: Vote[];
  judgeScores: JudgeScore[];
  exhibitOwners: ExhibitOwner[];
  creativeWeights?: { peer: number; judge: number }; // default 50/50
};

export type Ranked = { userId: number; rank: number; metrics: Record<string, number> };

/** Rank by score desc; ties broken deterministically by earliest time, then lowest userId. */
function rankBy(rows: { userId: number; score: number; tie: number }[], limit: number): Ranked[] {
  return rows
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.tie - b.tie || a.userId - b.userId)
    .slice(0, limit)
    .map((r, i) => ({ userId: r.userId, rank: i + 1, metrics: { score: r.score } }));
}

/** Most Participation: distinct events attended. Tie-break: who reached their count first. */
export function mostParticipation(input: AwardInput, limit = 3): Ranked[] {
  const per = new Map<number, Map<number, Date>>();
  for (const c of input.checkins) {
    const m = per.get(c.userId) ?? new Map<number, Date>();
    if (!m.has(c.eventId)) m.set(c.eventId, c.at);
    per.set(c.userId, m);
  }
  const rows = [...per].map(([userId, m]) => ({
    userId,
    score: m.size,
    tie: Math.max(...[...m.values()].map((d) => d.getTime())), // time of their last counted event
  }));
  return rankBy(rows, limit);
}

/** Explorer: distinct exhibits visited. Awarded for any visits; completing all is surfaced in metrics. */
export function explorer(input: AwardInput, limit = 3): Ranked[] {
  const per = new Map<number, Set<number>>();
  for (const v of input.visits) {
    const s = per.get(v.userId) ?? new Set<number>();
    s.add(v.exhibitId);
    per.set(v.userId, s);
  }
  const ranked = rankBy(
    [...per].map(([userId, s]) => ({ userId, score: s.size, tie: 0 })),
    limit,
  );
  return ranked.map((r) => ({
    ...r,
    metrics: { ...r.metrics, completedAll: r.metrics.score >= input.totalExhibits && input.totalExhibits > 0 ? 1 : 0 },
  }));
}

/**
 * Most Creative: per exhibit, peer-vote share and mean judge score are each normalised to 0-100
 * (votes relative to the leading exhibit, judges as their mean) then blended by weight.
 * The prize goes to the exhibit's owners.
 */
export function mostCreative(input: AwardInput, limit = 3): Ranked[] {
  const { peer, judge } = input.creativeWeights ?? { peer: 0.5, judge: 0.5 };
  const total = peer + judge || 1;

  const voteCount = new Map<number, number>();
  for (const v of input.votes) voteCount.set(v.exhibitId, (voteCount.get(v.exhibitId) ?? 0) + 1);
  const maxVotes = Math.max(0, ...voteCount.values());

  const judgeSum = new Map<number, { sum: number; n: number }>();
  for (const j of input.judgeScores) {
    const a = judgeSum.get(j.exhibitId) ?? { sum: 0, n: 0 };
    a.sum += j.score;
    a.n += 1;
    judgeSum.set(j.exhibitId, a);
  }

  const rows: { userId: number; score: number; tie: number }[] = [];
  const peerPart = new Map<number, number>();
  const judgePart = new Map<number, number>();
  for (const o of input.exhibitOwners) {
    const p = maxVotes ? ((voteCount.get(o.exhibitId) ?? 0) / maxVotes) * 100 : 0;
    const js = judgeSum.get(o.exhibitId);
    const j = js ? js.sum / js.n : 0;
    const combined = Math.round(((p * peer + j * judge) / total) * 100) / 100;
    for (const userId of o.userIds) {
      rows.push({ userId, score: combined, tie: -j }); // tie-break: higher judge score first
      peerPart.set(userId, p);
      judgePart.set(userId, j);
    }
  }
  return rankBy(rows, limit).map((r) => ({
    ...r,
    metrics: { ...r.metrics, peer: peerPart.get(r.userId) ?? 0, judge: judgePart.get(r.userId) ?? 0 },
  }));
}

export function computeAwards(input: AwardInput) {
  return {
    participation: mostParticipation(input),
    explorer: explorer(input),
    creative: mostCreative(input),
  };
}
