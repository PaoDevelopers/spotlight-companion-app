import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import Markdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api";
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
  votedForThis: boolean;
  visited: boolean;
}

export function ExhibitDetail() {
  const { slug } = useParams();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["exhibit", slug], queryFn: () => api.get<ExhibitView>(`/api/exhibits/${slug}`) });
  const vote = useMutation({
    mutationFn: (exhibitId: number) => api.put("/api/vote", { exhibitId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["exhibit"] }),
  });
  if (q.isError) return <p>Exhibit not found.</p>;
  if (!q.data) return null;
  const { exhibit: x, votedForThis } = q.data;
  return (
    <article className="space-y-3">
      <h1 className="text-2xl font-bold">{x.title}</h1>
      <p className="text-muted-foreground">{x.summary}</p>
      {x.imageUrl && <img src={x.imageUrl} alt={x.title} className="w-full rounded-lg" />}
      {/* react-markdown does not render raw HTML, so exhibit text can't inject scripts or styles */}
      <div className="space-y-2 [&_h2]:mt-4 [&_h2]:text-lg [&_h2]:font-semibold [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5">
        <Markdown>{x.bodyMd}</Markdown>
      </div>
      <div className="rounded-lg bg-card p-3 shadow-sm">
        <Button variant="vote" disabled={vote.isPending} onClick={() => vote.mutate(x.id)}>
          {votedForThis ? "⭐ Your creative vote" : "Vote Most Creative"}
        </Button>
        {vote.isError && <p role="alert" className="mt-1 text-sm text-red-700">{errorMessage(vote.error)}</p>}
        <p className="mt-1 text-xs text-muted-foreground">One vote per student; you can change it until voting closes. You can't vote for your own project.</p>
      </div>
    </article>
  );
}
