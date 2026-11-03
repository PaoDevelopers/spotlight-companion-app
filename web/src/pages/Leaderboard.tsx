import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { kindLabel } from "@/lib/competition";
import { cn } from "@/lib/utils";
import type { Board, BoardGroup, BoardRow } from "@/lib/types";

interface Data {
  month: { rank: number; label: string; points: number }[];
  competitions: Board[];
}

const medal = (rank: number | null) => (rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : rank ? `${rank}.` : "–");

function Row({ rank, children, score, unit, dim }: { rank: number | null; children: React.ReactNode; score?: number | null; unit?: string; dim?: boolean }) {
  return (
    <li className={cn("flex items-center gap-3 rounded-lg bg-card p-2.5 shadow-sm", dim && "opacity-80")}>
      <span className="w-8 shrink-0 text-center text-lg">{medal(rank)}</span>
      <span className="min-w-0 flex-1">{children}</span>
      {score !== null && score !== undefined && (
        <b className="shrink-0">
          {score}
          {unit && <span className="ml-0.5 text-xs font-normal text-muted-foreground">{unit}</span>}
        </b>
      )}
    </li>
  );
}

function Groups({ groups, kind }: { groups: BoardGroup[]; kind: string }) {
  return (
    <ol className="space-y-1.5">
      {groups.map((g) => (
        <Row key={g.label} rank={g.rank} score={g.score} unit="pts">
          <div className="font-semibold">{kind === "house" ? `${g.label} house` : g.label}</div>
          <div className="truncate text-xs text-muted-foreground">
            {kind === "house" ? `${g.count} ${g.count === 1 ? "entrant" : "entrants"}` : g.members?.join(", ")}
          </div>
        </Row>
      ))}
    </ol>
  );
}

function People({ rows, showHouse }: { rows: BoardRow[]; showHouse: boolean }) {
  return (
    <ol className="space-y-1.5">
      {rows.map((r) => (
        <Row key={r.id} rank={r.rank} score={r.score} unit="pts" dim={r.status === "eliminated"}>
          <span>{r.label}</span>
          <span className="ml-2 text-xs text-muted-foreground">
            {showHouse && r.house ? `${r.house} · ` : ""}
            {r.status}
          </span>
        </Row>
      ))}
    </ol>
  );
}

export default function Leaderboard() {
  const q = useQuery({ queryKey: ["leaderboard"], queryFn: () => api.get<Data>("/api/leaderboard"), refetchInterval: 30_000 });
  if (!q.data) return null;
  const boards = q.data.competitions.map((c) => ({ ...c, rows: c.rows ?? [], groups: c.groups ?? [] }));
  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">Board</h1>
      <div className="grid gap-8 lg:grid-cols-2 lg:items-start">
        <section>
          <h2 className="mb-1 text-lg font-semibold">Month leaderboard</h2>
          <p className="mb-2 text-sm text-muted-foreground">1 pt per event, 1 pt per exhibit, bonus for competition podiums. Names show only for students who opted in.</p>
          <ol className="space-y-1.5">
            {q.data.month.map((r) => (
              <Row key={r.rank} rank={r.rank} score={r.points}>
                {r.label}
              </Row>
            ))}
          </ol>
          {q.data.month.length === 0 && <p className="text-muted-foreground">No points yet.</p>}
        </section>
        <div className="space-y-8">
          {boards.map((c) => (
            <section key={c.id}>
              <h2 className="text-lg font-semibold">{c.event}</h2>
              <p className="mb-2 text-xs text-muted-foreground">🏁 {kindLabel(c.kind)} competition</p>
              {c.kind !== "individual" && c.groups.length > 0 && <Groups groups={c.groups} kind={c.kind} />}
              {c.rows.length > 0 && (
                <>
                  {c.kind !== "individual" && <h3 className="mb-1 mt-4 text-sm font-semibold text-muted-foreground">{c.kind === "house" ? "Individual results" : "Without a team"}</h3>}
                  <People rows={c.rows} showHouse={c.kind === "house"} />
                </>
              )}
              {c.rows.length === 0 && c.groups.length === 0 && <p className="text-sm text-muted-foreground">No entries yet.</p>}
            </section>
          ))}
          {boards.length === 0 && <p className="text-muted-foreground">No competitions yet.</p>}
        </div>
      </div>
    </div>
  );
}
