import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../db";
import { createTestDb } from "../db/testdb";
import { checkins, competitions, events, exhibitOwners, exhibits, users } from "../db/schema";
import { importRoster, loginWithCode, parseRosterCsv, createSession, readSession } from "./auth";
import { checkInByPass, checkInStudent, visitExhibit } from "./checkin";
import { makeEventToken, makeTagToken, makePassToken } from "../checkin/token";
import { competitionLeaderboard, monthLeaderboard, register, updateEntry } from "./competitions";
import { awardResultsFor, castVote, publishAwards, removeDraftResult, runAwards, scoreExhibit } from "./awards";

const S = "secret";
let db: Db;
const start = new Date("2026-11-05T10:00:00Z");
const during = new Date("2026-11-05T10:30:00Z");

async function mkUser(name: string, email: string, show = false) {
  const [u] = await db.insert(users).values({ name, email, showOnLeaderboard: show, className: "10A" }).returning();
  return u;
}
async function mkEvent(title = "Robotics Demo") {
  const [e] = await db.insert(events).values({ title, subject: "cs", startsAt: start, endsAt: new Date(start.getTime() + 7200_000), capacity: 2 }).returning();
  return e;
}

beforeEach(async () => { db = await createTestDb(); });

describe("auth", () => {
  it("imports a roster and logs in with the printed code", async () => {
    const rows = parseRosterCsv("name,email,class\nAda,Ada@School.edu,10A\nbad,nomail,10B");
    expect(rows).toHaveLength(1);
    const [issued] = await importRoster(db, rows);
    expect((await loginWithCode(db, "ada@school.edu", issued.code.toLowerCase()))?.name).toBe("Ada");
    expect(await loginWithCode(db, "ada@school.edu", "WRONGCODE")).toBeNull();
  });
  it("sessions verify, expire, and resist tampering", () => {
    const t = createSession(S, 4, 0);
    expect(readSession(S, t, 1000)).toBe(4);
    expect(readSession(S, t, 1e12)).toBeNull();
    expect(readSession(S, t.replace(/^4/, "5"), 1000)).toBeNull();
  });
});

describe("check-in", () => {
  it("checks in once, treats repeats as duplicates, enforces window and capacity", async () => {
    const e = await mkEvent(); const [a, b, c] = [await mkUser("A", "a@x"), await mkUser("B", "b@x"), await mkUser("C", "c@x")];
    const tok = makeEventToken(S, e.id, during.getTime());
    expect(await checkInStudent(db, S, a.id, tok, during)).toMatchObject({ ok: true, duplicate: false });
    expect(await checkInStudent(db, S, a.id, tok, during)).toMatchObject({ ok: true, duplicate: true });
    expect(await checkInStudent(db, S, b.id, tok, during)).toMatchObject({ ok: true });
    expect(await checkInStudent(db, S, c.id, tok, during)).toEqual({ ok: false, error: "full" });
    const late = new Date(start.getTime() + 3 * 3600_000);
    expect(await checkInStudent(db, S, c.id, makeEventToken(S, e.id, late.getTime()), late)).toEqual({ ok: false, error: "closed" });
    expect(await checkInStudent(db, S, c.id, "junk", during)).toEqual({ ok: false, error: "invalid_token" });
  });
  it("supports NFC tag tokens and teacher pass scans", async () => {
    const e = await mkEvent(); const a = await mkUser("A", "a@x"); const b = await mkUser("B", "b@x");
    await checkInStudent(db, S, a.id, makeTagToken(S, "event", e.id), during);
    const r = await checkInByPass(db, S, e.id, makePassToken(S, b.id), during);
    expect(r).toMatchObject({ ok: true, student: "B" });
    const rows = await db.select().from(checkins);
    expect(rows.map((x) => x.method).sort()).toEqual(["nfc", "pass"]);
  });
  it("records exhibit visits from tag tokens only", async () => {
    const [ex] = await db.insert(exhibits).values({ slug: "pendulum", title: "Pendulum", subject: "physics" }).returning();
    const u = await mkUser("A", "a@x");
    expect(await visitExhibit(db, S, u.id, makeTagToken(S, "event", ex.id))).toMatchObject({ ok: false });
    expect(await visitExhibit(db, S, u.id, makeTagToken(S, "exhibit", ex.id))).toEqual({ ok: true, slug: "pendulum" });
  });
});

describe("leaderboards", () => {
  it("hides names of students who haven't opted in", async () => {
    const e = await mkEvent(); const pub = await mkUser("Pat", "p@x", true); const priv = await mkUser("Sam", "s@x");
    const [c] = await db.insert(competitions).values({ eventId: e.id, name: "Hackathon" }).returning();
    await register(db, c.id, pub.id); await register(db, c.id, priv.id);
    const entries = await competitionLeaderboard(db, c.id);
    for (const en of entries) await updateEntry(db, en.id, { rank: en.userId === pub.id ? 2 : 1, score: 10, status: "finished" });
    const lb = await competitionLeaderboard(db, c.id);
    expect(lb.map((x) => x.label)).toEqual(["Student, 10A", "Pat"]);
    const month = await monthLeaderboard(db);
    expect(month[0].points).toBe(10);
    expect(JSON.stringify(month)).not.toContain("Sam");
  });
});

describe("awards workflow", () => {
  it("drafts, vetoes, publishes, and never rewrites published results", async () => {
    const e1 = await mkEvent("E1"); const e2 = await mkEvent("E2");
    const [a, b, judge] = [await mkUser("A", "a@x"), await mkUser("B", "b@x"), await mkUser("J", "j@x")];
    for (const e of [e1, e2]) await db.insert(checkins).values({ eventId: e.id, userId: a.id, method: "qr", at: during });
    await db.insert(checkins).values({ eventId: e1.id, userId: b.id, method: "qr", at: during });
    const [ex] = await db.insert(exhibits).values({ slug: "x", title: "X", subject: "cs" }).returning();
    await db.insert(exhibitOwners).values({ exhibitId: ex.id, userId: b.id });
    expect(await castVote(db, b.id, ex.id)).toEqual({ ok: false, error: "own_exhibit" });
    expect((await castVote(db, a.id, ex.id)).ok).toBe(true);
    await scoreExhibit(db, judge.id, ex.id, 150);

    const res = await runAwards(db, judge.id);
    expect(res.participation[0].userId).toBe(a.id);
    expect(res.creative[0]).toMatchObject({ userId: b.id, metrics: { judge: 100, peer: 100 } });

    const drafts = await awardResultsFor(db, { published: false });
    expect(await awardResultsFor(db, { published: true })).toHaveLength(0); // students see nothing yet
    const creative = drafts.find((d) => d.key === "creative")!;
    expect(await removeDraftResult(db, creative.id, judge.id, "ineligible")).toBe(true);

    expect(await publishAwards(db, judge.id)).toBeGreaterThan(0);
    const before = await awardResultsFor(db, { published: true });
    await runAwards(db, judge.id); // re-run must not alter published rows
    expect(await awardResultsFor(db, { published: true })).toEqual(before);
    expect(before.some((r) => r.key === "creative")).toBe(false);
  });
});
