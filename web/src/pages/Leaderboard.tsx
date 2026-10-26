import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

interface Board {
  month: { rank: number; label: string; points: number }[];
  competitions: { id: number; name: string; event: string; rows: { id: number; label: string; status: string; score: number | null; rank: number | null }[] }[];
}

export default function Leaderboard() {
  const q = useQuery({ queryKey: ["leaderboard"], queryFn: () => api.get<Board>("/api/leaderboard"), refetchInterval: 30_000 });
  if (!q.data) return null;
  return (
    <div className="space-y-6">
      <section>
        <h1 className="mb-1 text-2xl font-bold">Month leaderboard</h1>
        <p className="mb-2 text-sm text-muted-foreground">1 pt per event, 1 pt per exhibit, bonus for competition podiums. Names show only for students who opted in.</p>
        <ol className="space-y-1">
          {q.data.month.map((r) => (
            <li key={r.rank} className="flex justify-between rounded bg-card p-2 shadow-sm">
              <span>{r.rank}. {r.label}</span>
              <b>{r.points}</b>
            </li>
          ))}
        </ol>
        {q.data.month.length === 0 && <p className="text-muted-foreground">No points yet.</p>}
      </section>
      {q.data.competitions.map((c) => (
        <section key={c.id}>
          <h2 className="mb-2 text-lg font-semibold">{c.name}</h2>
          <ol className="space-y-1">
            {c.rows.map((r) => (
              <li key={r.id} className="flex justify-between rounded bg-card p-2 shadow-sm">
                <span>
                  {r.rank ?? "–"}. {r.label} <i className="text-xs text-muted-foreground">{r.status}</i>
                </span>
                <b>{r.score ?? ""}</b>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
