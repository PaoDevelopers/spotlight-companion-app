import { getDb } from "@/lib/db";
import { competitions, events } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { competitionLeaderboard, monthLeaderboard } from "@/lib/services/competitions";

export const dynamic = "force-dynamic";

export default async function Board() {
  const db = await getDb();
  const month = await monthLeaderboard(db);
  const comps = await db.select({ id: competitions.id, name: competitions.name, event: events.title }).from(competitions).innerJoin(events, eq(events.id, competitions.eventId));
  const boards = await Promise.all(comps.map(async (c) => ({ ...c, rows: await competitionLeaderboard(db, c.id) })));
  return (
    <div className="space-y-6">
      <section>
        <h1 className="mb-1 text-2xl font-bold">Month leaderboard</h1>
        <p className="mb-2 text-sm text-slate-600">1 pt per event, 1 pt per exhibit, bonus for competition podiums. Names show only for students who opted in.</p>
        <ol className="space-y-1">{month.map((r) => <li key={r.userId} className="flex justify-between rounded bg-white p-2 shadow-sm"><span>{r.rank}. {r.label}</span><b>{r.points}</b></li>)}</ol>
        {month.length === 0 && <p className="text-slate-500">No points yet.</p>}
      </section>
      {boards.map((b) => (
        <section key={b.id}>
          <h2 className="mb-2 text-lg font-semibold">{b.name}</h2>
          <ol className="space-y-1">{b.rows.map((r) => <li key={r.id} className="flex justify-between rounded bg-white p-2 shadow-sm"><span>{r.rank ?? "–"}. {r.label} <i className="text-xs text-slate-500">{r.status}</i></span><b>{r.score ?? ""}</b></li>)}</ol>
        </section>
      ))}
    </div>
  );
}
