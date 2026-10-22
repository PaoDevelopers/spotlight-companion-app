import Link from "next/link";
import { and, eq, gte, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { checkins, events, exhibitVisits, exhibits } from "@/lib/db/schema";
import { requireUser } from "@/lib/session";
import { myCompetitions } from "@/lib/services/competitions";
import { awardResultsFor } from "@/lib/services/awards";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await requireUser();
  const db = await getDb();
  const [[att], [vis], [totalEx], upcoming, comps, awards] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(checkins).where(eq(checkins.userId, user.id)),
    db.select({ n: sql<number>`count(*)::int` }).from(exhibitVisits).where(eq(exhibitVisits.userId, user.id)),
    db.select({ n: sql<number>`count(*)::int` }).from(exhibits),
    db.select().from(events).where(gte(events.endsAt, new Date())).orderBy(events.startsAt).limit(3),
    myCompetitions(db, user.id),
    awardResultsFor(db, { published: true, userId: user.id }),
  ]);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Hi {user.name.split(" ")[0]}</h1>
      {awards.map((a) => (
        <div key={a.id} className="rounded-lg bg-amber-100 p-4 font-semibold">🏆 {a.award}: #{a.rank}</div>
      ))}
      <div className="grid grid-cols-2 gap-3 text-center">
        <div className="rounded-lg bg-white p-4 shadow-sm"><div className="text-3xl font-bold">{att.n}</div>events attended</div>
        <div className="rounded-lg bg-white p-4 shadow-sm"><div className="text-3xl font-bold">{vis.n}/{totalEx.n}</div>exhibits visited</div>
      </div>
      {comps.length > 0 && (
        <section><h2 className="mb-2 font-semibold">My competitions</h2>
          {comps.map((c) => <div key={c.entryId} className="mb-2 rounded-lg bg-white p-3 shadow-sm">{c.competition} · <b>{c.status}</b>{c.rank ? ` · rank ${c.rank}` : ""}</div>)}
        </section>
      )}
      <section><h2 className="mb-2 font-semibold">Coming up</h2>
        {upcoming.length === 0 && <p className="text-slate-500">No upcoming events.</p>}
        {upcoming.map((e) => (
          <Link key={e.id} href={`/events/${e.id}`} className="mb-2 block rounded-lg bg-white p-3 shadow-sm">
            <div className="font-semibold">{e.title}</div>
            <div className="text-sm text-slate-600">{e.startsAt.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })} · {e.venue}</div>
          </Link>
        ))}
      </section>
    </div>
  );
}
