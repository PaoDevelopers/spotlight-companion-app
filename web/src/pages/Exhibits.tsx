import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Prose } from "@/components/Prose";
import { SubjectBadge } from "@/components/ui/badge";
import { SUBJECTS } from "@/lib/subjects";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import type { Exhibit, Exhibition } from "@/lib/types";

type Listed = Exhibit & { visited: boolean };

function ExhibitCard({ x }: { x: Listed }) {
  return (
    <Link to={`/exhibits/${x.slug}`} className="block rounded-lg bg-card p-3 shadow-sm">
      <SubjectBadge subject={x.subject} />
      <span className="font-semibold">
        {x.visited ? "✅ " : ""}
        {x.title}
      </span>
      <div className="text-sm text-muted-foreground">{x.summary}</div>
    </Link>
  );
}

export function Exhibits() {
  const [params] = useSearchParams();
  const subject = params.get("subject") ?? "";
  const q = useQuery({ queryKey: ["exhibits"], queryFn: () => api.get<Listed[]>("/api/exhibits") });
  const groups = useQuery({ queryKey: ["exhibitions"], queryFn: () => api.get<Exhibition[]>("/api/exhibitions") });
  const list = q.data ?? [];
  const seen = list.filter((x) => x.visited).length;
  const matches = (x: Listed) => !subject || x.subject === subject || x.subject === "both";
  const shown = list.filter(matches);
  const known = new Set((groups.data ?? []).map((g) => g.id));
  const loose = shown.filter((x) => x.exhibitionId === null || !known.has(x.exhibitionId));
  const visibleGroups = (groups.data ?? []).filter((g) => shown.some((x) => x.exhibitionId === g.id) || (!subject && g.total === 0));
  return (
    <div className="space-y-4">
      <div>
        <h1 className="mb-1 text-2xl font-bold">Exhibits</h1>
        {q.data && (
          <p className="text-muted-foreground">
            {seen} of {list.length} visited. Scan the code at each installation to log it.
          </p>
        )}
      </div>
      <div className="flex gap-2 text-sm">
        {[["", "All"], ...SUBJECTS.filter(([v]) => v !== "both")].map(([v, l]) => (
          <Link key={v} to={v ? `/exhibits?subject=${v}` : "/exhibits"} replace className={cn("rounded-full border px-3 py-1", subject === v ? "bg-primary text-primary-foreground" : "bg-card")}>
            {l}
          </Link>
        ))}
      </div>
      {visibleGroups.map((g) => (
        <section key={g.id} aria-label={g.title} className="space-y-2">
          <div className="border-b pb-1">
            <h2 className="text-lg font-semibold">
              <SubjectBadge subject={g.subject} />
              {g.title}
            </h2>
            <p className="text-sm text-muted-foreground">
              {g.visited} of {g.total} visited{g.summary ? ` · ${g.summary}` : ""}
            </p>
          </div>
          {g.bodyMd.trim() && (
            <details className="rounded-lg bg-card p-3 text-sm shadow-sm">
              <summary className="cursor-pointer font-medium">About this exhibition</summary>
              {g.imageUrl && <img src={g.imageUrl} alt="" className="my-2 max-h-56 w-full rounded-lg object-cover" />}
              <Prose className="mt-2">{g.bodyMd}</Prose>
            </details>
          )}
          <div className="grid gap-2 md:grid-cols-2">{shown.filter((x) => x.exhibitionId === g.id).map((x) => <ExhibitCard key={x.id} x={x} />)}</div>
        </section>
      ))}
      {loose.length > 0 && (
        <section aria-label="More installations" className="space-y-2">
          {visibleGroups.length > 0 && <h2 className="border-b pb-1 text-lg font-semibold">More installations</h2>}
          <div className="grid gap-2 md:grid-cols-2">{loose.map((x) => <ExhibitCard key={x.id} x={x} />)}</div>
        </section>
      )}
      {q.data && shown.length === 0 && <p className="text-muted-foreground">No exhibits {subject ? "for this subject " : ""}yet.</p>}
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
  const groups = useQuery({ queryKey: ["exhibitions"], queryFn: () => api.get<Exhibition[]>("/api/exhibitions") });
  if (q.isError) return <p>Exhibit not found.</p>;
  if (!q.data) return null;
  const { exhibit: x } = q.data;
  const group = groups.data?.find((g) => g.id === x.exhibitionId);
  return (
    <article className="space-y-3">
      <div>
        <SubjectBadge subject={x.subject} />
        {group && <Link to="/exhibits" className="text-sm text-muted-foreground underline">{group.title}</Link>}
      </div>
      <h1 className="text-2xl font-bold">{x.title}</h1>
      <p className="text-muted-foreground">{x.summary}</p>
      {x.imageUrl && <img src={x.imageUrl} alt={x.title} className="w-full rounded-lg md:max-h-96 md:object-cover" />}
      <Prose>{x.bodyMd}</Prose>
    </article>
  );
}
