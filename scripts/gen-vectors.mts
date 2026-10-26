// Records what the TypeScript implementation does, as JSON test vectors for the Go port.
//   npx tsx scripts/gen-vectors.mts
// The Go tests (server/internal/...) must reproduce every value, byte for byte.
import { createHmac, scryptSync } from "node:crypto";
import { writeFileSync } from "node:fs";
import { makeEventToken, makePassToken, makeTagToken, verifyEventToken, verifyPassToken, verifyTagToken, WINDOW_SECONDS } from "../lib/checkin/token";
import { createSession, readSession } from "../lib/services/auth";
import { computeAwards, type AwardInput } from "../lib/awards/compute";

const OUT = "server/testdata";
const write = (name: string, data: unknown) => writeFileSync(`${OUT}/${name}`, JSON.stringify(data, null, 1) + "\n");

// ---- tokens ----
const SECRET = "vector-secret";
const t0 = 1_700_000_000_000;
const ev = makeEventToken(SECRET, 7, t0);
const tag = makeTagToken(SECRET, "exhibit", 3);
const pass = makePassToken(SECRET, 42);
write("token_vectors.json", {
  secret: SECRET,
  windowSeconds: WINDOW_SECONDS,
  eventTokens: [
    { eventId: 7, nowMs: t0, token: ev },
    { eventId: 1, nowMs: t0 + 12_345, token: makeEventToken(SECRET, 1, t0 + 12_345) },
    { eventId: 99999, nowMs: t0 + 86_400_000, token: makeEventToken(SECRET, 99999, t0 + 86_400_000) },
  ],
  // verifyEventToken(secret, token, nowMs) -> eventId | null
  verifyEvent: [
    { token: ev, nowMs: t0, want: verifyEventToken(SECRET, ev, t0) },
    { token: ev, nowMs: t0 + WINDOW_SECONDS * 1000, want: verifyEventToken(SECRET, ev, t0 + WINDOW_SECONDS * 1000) },
    { token: ev, nowMs: t0 + 3 * WINDOW_SECONDS * 1000, want: verifyEventToken(SECRET, ev, t0 + 3 * WINDOW_SECONDS * 1000) },
    { token: ev, nowMs: t0 - 5 * WINDOW_SECONDS * 1000, want: verifyEventToken(SECRET, ev, t0 - 5 * WINDOW_SECONDS * 1000) },
    { token: ev.replace(/^7\./, "8."), nowMs: t0, want: verifyEventToken(SECRET, ev.replace(/^7\./, "8."), t0) },
    { token: "garbage", nowMs: t0, want: verifyEventToken(SECRET, "garbage", t0) },
    { token: "", nowMs: t0, want: verifyEventToken(SECRET, "", t0) },
  ],
  tagTokens: [
    { kind: "exhibit", id: 3, token: tag },
    { kind: "event", id: 12, token: makeTagToken(SECRET, "event", 12) },
  ],
  verifyTag: [
    { token: tag, want: verifyTagToken(SECRET, tag) },
    { token: makeTagToken(SECRET, "event", 12), want: verifyTagToken(SECRET, makeTagToken(SECRET, "event", 12)) },
    { token: tag.replace("exhibit.3", "exhibit.4"), want: verifyTagToken(SECRET, tag.replace("exhibit.3", "exhibit.4")) },
    { token: "nope", want: verifyTagToken(SECRET, "nope") },
  ],
  passTokens: [{ userId: 42, token: pass }, { userId: 1, token: makePassToken(SECRET, 1) }],
  verifyPass: [
    { token: pass, want: verifyPassToken(SECRET, pass) },
    { token: pass.replace("pass.42", "pass.43"), want: verifyPassToken(SECRET, pass.replace("pass.42", "pass.43")) },
    { token: "x", want: verifyPassToken(SECRET, "x") },
  ],
});

// ---- sessions ----
const s = createSession(SECRET, 5, 0);
write("session_vectors.json", {
  secret: SECRET,
  create: [{ userId: 5, nowMs: 0, token: s }, { userId: 77, nowMs: 1_700_000_000_000, token: createSession(SECRET, 77, 1_700_000_000_000) }],
  read: [
    { token: s, nowMs: 1000, want: readSession(SECRET, s, 1000) },
    { token: s, nowMs: 1e12, want: readSession(SECRET, s, 1e12) },
    { token: s.replace(/^5/, "6"), nowMs: 1000, want: readSession(SECRET, s.replace(/^5/, "6"), 1000) },
    { token: "", nowMs: 1000, want: readSession(SECRET, "", 1000) },
  ],
});

// ---- login code hashing: "salt:hex(scrypt(CODE_UPPERCASED, salt, 32))" ----
const code = "ABCD2345", salt = "00112233445566ff";
write("code_vectors.json", { code, salt, hash: `${salt}:${scryptSync(code, salt, 32).toString("hex")}`, lowercaseInputAlsoVerifies: true });

// ---- awards: hand-written edge cases + seeded random scenarios ----
type J = { userId: number; eventId: number; at: string };
const d = (day: number) => new Date(Date.UTC(2026, 10, day)).toISOString();
const run = (name: string, checkins: J[], rest: Omit<AwardInput, "checkins">) => {
  const input: AwardInput = { ...rest, checkins: checkins.map((c) => ({ ...c, at: new Date(c.at) })) };
  return { name, input: { ...rest, checkins }, want: computeAwards(input) };
};
const empty = { visits: [], totalExhibits: 2, votes: [], judgeScores: [], exhibitOwners: [] };
const scenarios = [
  run("empty", [], empty),
  run("double scans do not inflate", [{ userId: 1, eventId: 1, at: d(1) }, { userId: 1, eventId: 1, at: d(2) }, { userId: 2, eventId: 1, at: d(1) }, { userId: 2, eventId: 2, at: d(3) }], empty),
  run("ties: who reached the count first", [{ userId: 5, eventId: 1, at: d(1) }, { userId: 5, eventId: 2, at: d(9) }, { userId: 3, eventId: 1, at: d(1) }, { userId: 3, eventId: 2, at: d(4) }], empty),
  run("creative blend", [], { ...empty, exhibitOwners: [{ exhibitId: 1, userIds: [10] }, { exhibitId: 2, userIds: [20, 21] }], votes: [{ voterId: 1, exhibitId: 1 }, { voterId: 2, exhibitId: 1 }, { voterId: 3, exhibitId: 2 }], judgeScores: [{ exhibitId: 1, score: 60 }, { exhibitId: 2, score: 90 }] }),
  run("creative judge only weights", [], { ...empty, creativeWeights: { peer: 0, judge: 1 }, exhibitOwners: [{ exhibitId: 1, userIds: [10] }, { exhibitId: 2, userIds: [20] }], votes: [{ voterId: 1, exhibitId: 1 }], judgeScores: [{ exhibitId: 1, score: 60 }, { exhibitId: 2, score: 90 }] }),
  run("user owning two exhibits appears twice (current behaviour)", [], { ...empty, exhibitOwners: [{ exhibitId: 1, userIds: [10] }, { exhibitId: 2, userIds: [10] }], votes: [{ voterId: 1, exhibitId: 1 }], judgeScores: [{ exhibitId: 1, score: 50 }, { exhibitId: 2, score: 70 }] }),
  run("explorer completed all", [], { ...empty, totalExhibits: 2, visits: [{ userId: 1, exhibitId: 1 }, { userId: 1, exhibitId: 2 }, { userId: 2, exhibitId: 1 }] }),
  run("explorer with zero exhibits", [], { ...empty, totalExhibits: 0, visits: [{ userId: 1, exhibitId: 1 }] }),
];

let seed = 20261022;
const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
for (let i = 0; i < 60; i++) {
  const users = int(2, 12), events = int(1, 6), exhibits = int(0, 5);
  const checkins: J[] = [];
  for (let n = int(0, 40); n > 0; n--) checkins.push({ userId: int(1, users), eventId: int(1, events), at: d(int(1, 28)) });
  const visits = Array.from({ length: int(0, 25) }, () => ({ userId: int(1, users), exhibitId: int(1, Math.max(1, exhibits)) }));
  const exhibitOwners = Array.from({ length: exhibits }, (_, k) => ({ exhibitId: k + 1, userIds: Array.from({ length: int(1, 2) }, () => int(1, users)) }));
  const votes = Array.from({ length: int(0, 30) }, () => ({ voterId: int(1, users), exhibitId: int(1, Math.max(1, exhibits)) }));
  const judgeScores = Array.from({ length: int(0, 12) }, () => ({ exhibitId: int(1, Math.max(1, exhibits)), score: int(0, 100) }));
  const w = rnd() < 0.5 ? undefined : { peer: int(0, 4) / 2, judge: int(0, 4) / 2 };
  scenarios.push(run(`random ${i}`, checkins, { visits, totalExhibits: exhibits, votes, judgeScores, exhibitOwners, creativeWeights: w }));
}
write("awards_vectors.json", scenarios);
console.log("wrote vectors:", scenarios.length, "award scenarios");
