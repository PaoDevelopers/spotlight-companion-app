import type { Db } from "./db";
import { users, events, exhibits, competitions } from "./db/schema";
import { ensureAwards } from "./services/awards";
import { generateLoginCode, hashCode } from "./services/auth";

/** Dev/demo data only. Prints codes so you can log in. Never run against real student data. */
export async function seedDemo(db: Db) {
  const [{ n }] = await db.select({ n: users.id }).from(users).limit(1).then((r) => (r.length ? [{ n: 1 }] : [{ n: 0 }]));
  if (n) return null;
  await ensureAwards(db);
  const codes: Record<string, string> = {};
  for (const [name, email, role] of [["Ms Teacher", "teacher@demo.school", "teacher"], ["Demo Student", "student@demo.school", "student"]] as const) {
    const code = process.env.DEMO_LOGIN_CODE ?? generateLoginCode(); // fixed code only for e2e/dev
    codes[email] = code;
    await db.insert(users).values({ name, email, role, className: role === "student" ? "10A" : null, loginCodeHash: hashCode(code) });
  }
  const day = (d: number, h: number) => new Date(Date.now() + d * 86400_000 + h * 3600_000);
  const [e] = await db.insert(events).values([
    { title: "Opening Assembly: Physics Meets CS", subject: "both", venue: "Main Hall", description: "Kick-off with live demos.", startsAt: day(0, -1), endsAt: day(0, 3), capacity: 400 },
    { title: "Hackathon", subject: "cs", venue: "Lab 2", description: "4-hour build challenge.", startsAt: day(3, 0), endsAt: day(3, 4) },
    { title: "Rube Goldberg Contest", subject: "physics", venue: "Gym", description: "Chain reactions.", startsAt: day(7, 0), endsAt: day(7, 2) },
  ]).returning();
  await db.insert(competitions).values({ eventId: e.id, name: "Hackathon" });
  await db.insert(exhibits).values([
    { slug: "double-pendulum", title: "Double Pendulum", subject: "physics", summary: "Chaos you can see.", bodyMd: "## What you're seeing\nTwo linked pendulums. Tiny changes in the start give wildly different paths.\n\n## Try this\nRelease it twice from *almost* the same angle." },
    { slug: "sorting-wall", title: "Sorting Wall", subject: "cs", summary: "Algorithms as motion.", bodyMd: "## How it works\n1. Bars represent numbers.\n2. Each algorithm swaps them differently.\n\n## Try this\nWhich algorithm finishes first on a nearly sorted list?" },
  ]);
  return codes;
}
