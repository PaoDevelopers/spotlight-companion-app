import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";
import type { AwardResult, Event, MyCompetition } from "@/lib/types";

interface HomeData {
  stats: { attended: number; visited: number; totalExhibits: number };
  upcoming: Event[];
  competitions: MyCompetition[];
  awards: AwardResult[];
}

export default function Home() {
  const { me } = useAuth();
  const q = useQuery({ queryKey: ["home"], queryFn: () => api.get<HomeData>("/api/home") });
  const d = q.data;
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Hi {me?.name.split(" ")[0]}</h1>
      {d?.awards.map((a) => (
        <div key={a.id} className="rounded-lg bg-amber-100 p-4 font-semibold">
          🏆 {a.award}: #{a.rank}
        </div>
      ))}
      {d && (
        <>
          <div className="grid grid-cols-2 gap-3 text-center">
            <Card><CardContent className="p-4"><div className="text-3xl font-bold">{d.stats.attended}</div>events attended</CardContent></Card>
            <Card><CardContent className="p-4"><div className="text-3xl font-bold">{d.stats.visited}/{d.stats.totalExhibits}</div>exhibits visited</CardContent></Card>
          </div>
          {d.competitions.length > 0 && (
            <section>
              <h2 className="mb-2 font-semibold">My competitions</h2>
              {d.competitions.map((c) => (
                <Card key={c.entryId} className="mb-2">
                  <CardContent>
                    {c.competition} · <b>{c.status}</b>
                    {c.rank ? ` · rank ${c.rank}` : ""}
                  </CardContent>
                </Card>
              ))}
            </section>
          )}
          <section>
            <h2 className="mb-2 font-semibold">Coming up</h2>
            {d.upcoming.length === 0 && <p className="text-muted-foreground">No upcoming events.</p>}
            {d.upcoming.map((e) => (
              <Link key={e.id} to={`/events/${e.id}`} className="mb-2 block rounded-lg bg-card p-3 shadow-sm">
                <div className="font-semibold">{e.title}</div>
                <div className="text-sm text-muted-foreground">
                  {fmtDateTime(e.startsAt)} · {e.venue}
                </div>
              </Link>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
