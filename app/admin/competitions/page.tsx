import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { competitionEntries, competitions, events, users } from "@/lib/db/schema";
import { SubmitButton } from "@/components/SubmitButton";
import { saveCompetition, saveEntry } from "../actions";

const STATUSES = ["registered", "competing", "advanced", "eliminated", "finished"];

export default async function AdminCompetitions() {
  const db = await getDb();
  const [evs, comps, entries] = await Promise.all([
    db.select().from(events).orderBy(events.startsAt),
    db.select().from(competitions),
    db.select({ e: competitionEntries, name: users.name, className: users.className }).from(competitionEntries).innerJoin(users, eq(users.id, competitionEntries.userId)),
  ]);
  const i = "rounded border p-1";
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Competitions</h1>
      <form action={saveCompetition} className="flex flex-wrap items-center gap-2 rounded-lg bg-white p-4 shadow-sm">
        <input name="name" required placeholder="Competition name" className="rounded border p-2" />
        <select name="eventId" className="rounded border p-2">{evs.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}</select>
        <label><input type="checkbox" name="isTeam" /> Team</label>
        <button className="rounded bg-slate-900 px-3 py-2 text-white">Create</button>
      </form>
      {comps.map((c) => (
        <section key={c.id} className="rounded-lg bg-white p-4 shadow-sm">
          <h2 className="mb-2 font-semibold">{c.name}</h2>
          {entries.filter((x) => x.e.competitionId === c.id).map(({ e, name, className }) => (
            <form key={e.id} action={saveEntry} className="mb-2 flex flex-wrap items-center gap-2 border-t pt-2 text-sm">
              <input type="hidden" name="id" value={e.id} />
              <span className="w-40">{e.teamName ? `${e.teamName} (${name})` : name} <i className="text-slate-500">{className}</i></span>
              <select name="status" defaultValue={e.status} className={i}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
              <input name="score" type="number" defaultValue={e.score ?? ""} placeholder="score" className={`${i} w-20`} />
              <input name="rank" type="number" min="1" defaultValue={e.rank ?? ""} placeholder="rank" className={`${i} w-16`} />
              <input name="notes" defaultValue={e.notes ?? ""} placeholder="notes" className={`${i} flex-1`} />
              <SubmitButton className="rounded border px-2 py-1">Save</SubmitButton>
            </form>
          ))}
        </section>
      ))}
    </div>
  );
}
