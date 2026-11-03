import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { Prose } from "@/components/Prose";
import { api } from "@/lib/api";
import type { Exhibit } from "@/lib/types";

export function Exhibits() {
  const q = useQuery({ queryKey: ["exhibits"], queryFn: () => api.get<(Exhibit & { visited: boolean })[]>("/api/exhibits") });
  const list = q.data ?? [];
  const seen = list.filter((x) => x.visited).length;
  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold">Exhibits</h1>
      {q.data && (
        <p className="mb-3 text-muted-foreground">
          {seen} of {list.length} visited. Scan the code at each installation to log it.
        </p>
      )}
      {list.map((x) => (
        <Link key={x.id} to={`/exhibits/${x.slug}`} className="mb-2 block rounded-lg bg-card p-3 shadow-sm">
          <span className="font-semibold">
            {x.visited ? "✅ " : ""}
            {x.title}
          </span>
          <div className="text-sm text-muted-foreground">{x.summary}</div>
        </Link>
      ))}
    </div>
  );
}

interface ExhibitView {
  exhibit: Exhibit;
  visited: boolean;
}

export function ExhibitDetail() {
  const { slug } = useParams();
  const q = useQuery({ queryKey: ["exhibit", slug], queryFn: () => api.get<ExhibitView>(`/api/exhibits/${slug}`) });
  if (q.isError) return <p>Exhibit not found.</p>;
  if (!q.data) return null;
  const { exhibit: x } = q.data;
  return (
    <article className="space-y-3">
      <h1 className="text-2xl font-bold">{x.title}</h1>
      <p className="text-muted-foreground">{x.summary}</p>
      {x.imageUrl && <img src={x.imageUrl} alt={x.title} className="w-full rounded-lg" />}
      <Prose>{x.bodyMd}</Prose>
    </article>
  );
}
