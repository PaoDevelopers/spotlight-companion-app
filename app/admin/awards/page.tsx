import { getDb } from "@/lib/db";
import { exhibits } from "@/lib/db/schema";
import { awardResultsFor, previewAwards } from "@/lib/services/awards";
import { judgeScoreAction, publishAction, runAwardsAction, vetoAction } from "../actions";

export default async function AdminAwards() {
  const db = await getDb();
  const [drafts, published, ex] = await Promise.all([awardResultsFor(db, { published: false }), awardResultsFor(db, { published: true }), db.select().from(exhibits)]);
  const live = await previewAwards(db);
  const liveCount = Object.values(live).reduce((n, v) => n + v.length, 0);
  const group = <T extends { award: string }>(rows: T[]) => Object.entries(Object.groupBy(rows, (r) => r.award));
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Awards</h1>
      <p className="text-slate-600">Workflow: judges score → <b>compute drafts</b> → review/veto → <b>publish</b>. Students only see published results, and published results are never changed by re-running.</p>
      <section className="rounded-lg bg-white p-4 shadow-sm">
        <h2 className="mb-2 font-semibold">Judge scoring (Most Creative, 0–100)</h2>
        {ex.map((x) => (
          <form key={x.id} action={judgeScoreAction} className="mb-1 flex items-center gap-2">
            <input type="hidden" name="exhibitId" value={x.id} /><span className="w-56">{x.title}</span>
            <input name="score" type="number" min="0" max="100" required className="w-20 rounded border p-1" /><button className="rounded border px-2 py-1 text-sm">Score</button>
          </form>
        ))}
      </section>
      <form action={runAwardsAction}><button className="rounded bg-slate-900 px-4 py-2 font-semibold text-white">Compute drafts</button> <span className="text-sm text-slate-600">Current standings would yield {liveCount} winners.</span></form>
      <section>
        <h2 className="mb-2 font-semibold">Drafts</h2>
        {group(drafts).map(([award, rows]) => (
          <div key={award} className="mb-3 rounded-lg bg-white p-3 shadow-sm"><b>{award}</b>
            {rows!.map((r) => (
              <form key={r.id} action={vetoAction} className="flex items-center gap-2 border-t py-1 text-sm">
                <input type="hidden" name="id" value={r.id} /><span className="flex-1">#{r.rank} {r.name} <i className="text-slate-500">{r.className} · {JSON.stringify(r.metrics)}</i></span>
                <input name="reason" placeholder="Veto reason" className="rounded border p-1" /><button className="text-red-700 underline">Remove</button>
              </form>
            ))}
          </div>
        ))}
        {drafts.length === 0 && <p className="text-slate-500">No drafts.</p>}
        {drafts.length > 0 && <form action={publishAction}><button className="rounded bg-emerald-700 px-4 py-2 font-semibold text-white">Publish to students</button></form>}
      </section>
      <section>
        <h2 className="mb-2 font-semibold">Published</h2>
        {group(published).map(([award, rows]) => <div key={award} className="mb-2"><b>{award}</b>: {rows!.map((r) => `#${r.rank} ${r.name}`).join(", ")}</div>)}
      </section>
    </div>
  );
}
