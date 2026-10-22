import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { checkins, competitionEntries, competitions, events } from "@/lib/db/schema";
import { requireUser } from "@/lib/session";
import { registerForCompetition } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const user = await requireUser();
  const db = await getDb();
  const [e] = await db.select().from(events).where(eq(events.id, id));
  if (!e) notFound();
  const [mine] = await db.select().from(checkins).where(and(eq(checkins.eventId, id), eq(checkins.userId, user.id)));
  const comps = await db.select().from(competitions).where(eq(competitions.eventId, id));
  const myEntries = await db.select().from(competitionEntries).where(eq(competitionEntries.userId, user.id));
  const entryFor = (competitionId: number) => myEntries.find((x) => x.competitionId === competitionId);
  return (
    <article className="space-y-3">
      <h1 className="text-2xl font-bold">{e.title}</h1>
      <p className="text-slate-600">{e.startsAt.toLocaleString("en-GB", { dateStyle: "full", timeStyle: "short" })} · {e.venue}</p>
      <p>{e.description}</p>
      <div className={`rounded-lg p-3 ${mine ? "bg-emerald-100" : "bg-white shadow-sm"}`}>
        {mine ? "✅ You're checked in" : "Scan the QR at the venue (Scan tab) or tap the NFC tag to check in."}
      </div>
      {comps.map((c) => entryFor(c.id) ? (
        <div key={c.id} className="rounded-lg bg-emerald-100 p-3">✅ Registered for {c.name} · <b>{entryFor(c.id)!.status}</b></div>
      ) : (
        <form key={c.id} action={registerForCompetition} className="space-y-2 rounded-lg bg-white p-3 shadow-sm">
          <input type="hidden" name="competitionId" value={c.id} />
          <div className="font-semibold">Competition: {c.name}</div>
          {c.isTeam && <input name="team" placeholder="Team name" className="w-full rounded border p-2" />}
          <button className="rounded bg-slate-900 px-3 py-2 text-white">Register</button>
        </form>
      ))}
    </article>
  );
}
