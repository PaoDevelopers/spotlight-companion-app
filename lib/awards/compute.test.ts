import { describe, expect, it } from "vitest";
import { computeAwards, mostParticipation, mostCreative, type AwardInput } from "./compute";

const d = (day: number) => new Date(Date.UTC(2026, 10, day));
const base: AwardInput = {
  checkins: [], visits: [], totalExhibits: 2, votes: [], judgeScores: [], exhibitOwners: [],
};

describe("mostParticipation", () => {
  it("counts distinct events only (double scans don't inflate)", () => {
    const r = mostParticipation({
      ...base,
      checkins: [
        { userId: 1, eventId: 1, at: d(1) },
        { userId: 1, eventId: 1, at: d(2) },
        { userId: 2, eventId: 1, at: d(1) },
        { userId: 2, eventId: 2, at: d(3) },
      ],
    });
    expect(r.map((x) => x.userId)).toEqual([2, 1]);
  });
  it("breaks ties by who reached the count first, deterministically", () => {
    const checkins = [
      { userId: 5, eventId: 1, at: d(1) }, { userId: 5, eventId: 2, at: d(9) },
      { userId: 3, eventId: 1, at: d(1) }, { userId: 3, eventId: 2, at: d(4) },
    ];
    expect(mostParticipation({ ...base, checkins })[0].userId).toBe(3);
    expect(mostParticipation({ ...base, checkins: [...checkins].reverse() })[0].userId).toBe(3);
  });
  it("returns nothing with no attendance", () => {
    expect(computeAwards(base)).toEqual({ participation: [], explorer: [], creative: [] });
  });
});

describe("mostCreative", () => {
  const input: AwardInput = {
    ...base,
    exhibitOwners: [{ exhibitId: 1, userIds: [10] }, { exhibitId: 2, userIds: [20, 21] }],
    votes: [{ voterId: 1, exhibitId: 1 }, { voterId: 2, exhibitId: 1 }, { voterId: 3, exhibitId: 2 }],
    judgeScores: [{ exhibitId: 1, score: 60 }, { exhibitId: 2, score: 90 }],
  };
  it("blends peer votes and judge scores 50/50 by default", () => {
    const r = mostCreative(input);
    // ex1: peer 100, judge 60 -> 80 ; ex2: peer 50, judge 90 -> 70
    expect(r[0]).toMatchObject({ userId: 10, rank: 1, metrics: { score: 80 } });
    expect(r.slice(1).map((x) => x.userId)).toEqual([20, 21]);
  });
  it("respects custom weights", () => {
    const r = mostCreative({ ...input, creativeWeights: { peer: 0, judge: 1 } });
    expect(r[0].userId).toBe(20);
  });
});
