import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SubjectBadge } from "@/components/ui/badge";
import { CoverImageField } from "@/components/CoverImageField";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import { Prose } from "@/components/Prose";
import { api } from "@/lib/api";
import { SUBJECTS } from "@/lib/subjects";
import { cn } from "@/lib/utils";
import type { Subject } from "@/lib/types";
import { useAdminExhibits, type AdminExhibit } from "./Exhibits";
import { FormError, SaveButton, panel } from "./shared";

interface Draft {
  title: string;
  subject: Subject;
  summary: string;
  imageUrl: string;
  bodyMd: string;
}
const EMPTY: Draft = { title: "", subject: "physics", summary: "", imageUrl: "", bodyMd: "" };

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className={cn(panel, "space-y-3")}>
      <div>
        <h2 className="font-semibold">{title}</h2>
        {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

const TEMPLATE = "## What you're seeing\n\n## How it works\n\n## Try this\n";

/** Create or edit an exhibit. The right-hand card shows what students will see. */
export function AdminExhibitEdit() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const list = useAdminExhibits();
  const existing = id ? list.data?.find((e) => String(e.id) === id) : undefined;
  const [d, setD] = useState<Draft>(EMPTY);
  const [loaded, setLoaded] = useState(!id);
  useEffect(() => {
    if (id && existing && !loaded) {
      setD({ title: existing.title, subject: existing.subject, summary: existing.summary, imageUrl: existing.imageUrl ?? "", bodyMd: existing.bodyMd });
      setLoaded(true);
    }
  }, [id, existing, loaded]);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["admin-exhibits"] });
    qc.invalidateQueries({ queryKey: ["exhibits"] });
    qc.invalidateQueries({ queryKey: ["exhibit"] });
  };
  const save = useMutation({
    mutationFn: () => (id ? api.put<AdminExhibit>(`/api/admin/exhibits/${id}`, d) : api.post<AdminExhibit>("/api/admin/exhibits", d)),
    onSuccess: (x) => { refresh(); navigate(`/admin/exhibits/${x.id}`); },
  });
  const del = useMutation({
    mutationFn: () => api.del(`/api/admin/exhibits/${id}`),
    onSuccess: () => { refresh(); navigate("/admin/exhibits", { replace: true }); },
  });

  if (id && list.data && !existing) return <p>Exhibit not found.</p>;
  if (id && !loaded) return <p className="text-muted-foreground">Loading…</p>;
  const back = id ? `/admin/exhibits/${id}` : "/admin/exhibits";
  return (
    <form onSubmit={(e: FormEvent) => { e.preventDefault(); save.mutate(); }} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">{id ? "Edit exhibit" : "New exhibit"}</h1>
        <Link to={back} className="text-sm underline">Cancel</Link>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <Section title="The basics">
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Title</span>
              <Input name="title" required value={d.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Double Pendulum" />
            </label>
            <div role="group" aria-label="Subject" className="flex gap-2">
              {SUBJECTS.map(([v, l]) => (
                <button key={v} type="button" aria-pressed={d.subject === v} onClick={() => set("subject", v)} className={cn("flex-1 rounded-md border px-3 py-2 text-sm", d.subject === v ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-accent")}>
                  {l}
                </button>
              ))}
            </div>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">One-line summary</span>
              <Input name="summary" value={d.summary} maxLength={160} onChange={(e) => set("summary", e.target.value)} placeholder="Shown in the list, e.g. Chaos you can see." />
            </label>
          </Section>

          <Section title="About this installation" hint="Students read this when they scan the code. Use the toolbar for headings, lists, links and pictures (you can also paste or drop pictures into the text). Preview shows the result.">
            <MarkdownEditor name="bodyMd" value={d.bodyMd} onChange={(v) => set("bodyMd", v)} rows={12} placeholder={TEMPLATE} />
            {!d.bodyMd.trim() && (
              <button type="button" className="text-sm underline" onClick={() => set("bodyMd", TEMPLATE)}>
                Start from the usual headings
              </button>
            )}
          </Section>

          <Section title="Cover picture (optional)">
            <CoverImageField name="imageUrl" value={d.imageUrl} onChange={(v) => set("imageUrl", v)} />
          </Section>
        </div>

        <aside className="lg:sticky lg:top-4 lg:self-start">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">What students will see</p>
          <article className={cn(panel, "space-y-2 overflow-hidden p-0")} aria-label="Preview">
            {d.imageUrl.trim() && <img src={d.imageUrl} alt="" className="h-36 w-full object-cover" onError={(e) => (e.currentTarget.style.display = "none")} />}
            <div className="space-y-2 p-4">
              <div><SubjectBadge subject={d.subject} /></div>
              <h2 className="text-xl font-bold">{d.title || "Untitled exhibit"}</h2>
              {d.summary && <p className="text-sm text-muted-foreground">{d.summary}</p>}
              {d.bodyMd.trim() && <Prose className="text-sm">{d.bodyMd}</Prose>}
            </div>
          </article>
        </aside>
      </div>
      <FormError error={save.error ?? del.error} />
      <div className="sticky bottom-0 -mx-4 flex items-center justify-end gap-2 border-t bg-background/95 p-3 backdrop-blur">
        {id && (
          <button
            type="button"
            className="mr-auto text-sm text-red-700 underline"
            disabled={del.isPending}
            onClick={() => { if (window.confirm(`Delete “${d.title}”? Its printed QR code will stop working and its visits are forgotten.`)) del.mutate(); }}
          >
            Delete this exhibit
          </button>
        )}
        <Button asChild variant="outline"><Link to={back}>Cancel</Link></Button>
        <SaveButton pending={save.isPending}>{id ? "Save changes" : "Create exhibit"}</SaveButton>
      </div>
    </form>
  );
}
