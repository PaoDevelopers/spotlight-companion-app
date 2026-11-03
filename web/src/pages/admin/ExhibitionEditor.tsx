import { useEffect, useRef, useState, type FormEvent } from "react";
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
import type { Exhibition, Subject } from "@/lib/types";
import { useAdminExhibitions } from "./ExhibitEditor";
import { FormError, SaveButton, panel, useDraftStatus } from "./shared";

interface Draft {
  title: string;
  subject: Subject;
  summary: string;
  bodyMd: string;
  imageUrl: string;
}
const EMPTY: Draft = { title: "", subject: "physics", summary: "", bodyMd: "", imageUrl: "" };

/** Create or edit an exhibition: the group that installations are placed in, such as "Physics Exhibition". */
export function AdminExhibitionEdit() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const list = useAdminExhibitions();
  const existing = id ? list.data?.find((e) => String(e.id) === id) : undefined;
  const [d, setD] = useState<Draft>(EMPTY);
  const [loaded, setLoaded] = useState(!id);
  useEffect(() => {
    if (id && existing && !loaded) {
      setD({ title: existing.title, subject: existing.subject, summary: existing.summary, bodyMd: existing.bodyMd, imageUrl: existing.imageUrl ?? "" });
      setLoaded(true);
    }
  }, [id, existing, loaded]);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const status = useDraftStatus(d, loaded);
  const sent = useRef(d);
  const refresh = () => {
    for (const k of ["admin-exhibitions", "admin-exhibits", "exhibitions", "exhibits"]) qc.invalidateQueries({ queryKey: [k] });
  };
  const save = useMutation({
    mutationFn: () => (id ? api.put<Exhibition>(`/api/admin/exhibitions/${id}`, d) : api.post<Exhibition>("/api/admin/exhibitions", d)),
    onSuccess: () => {
      refresh();
      status.markSaved(sent.current);
      if (!id) navigate("/admin/exhibits"); // the new exhibition appears on the list, ready for installations
    },
  });
  const del = useMutation({
    mutationFn: () => api.del(`/api/admin/exhibitions/${id}`),
    onSuccess: () => { refresh(); navigate("/admin/exhibits", { replace: true }); },
  });
  if (id && list.data && !existing) return <p>Exhibition not found.</p>;
  if (id && !loaded) return <p className="text-muted-foreground">Loading…</p>;
  return (
    <form onSubmit={(e: FormEvent) => { e.preventDefault(); sent.current = d; save.mutate(); }} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">{id ? "Edit exhibition" : "New exhibition"}</h1>
        <Link to="/admin/exhibits" className="text-sm underline">Cancel</Link>
      </div>
      <p className="text-sm text-muted-foreground">
        An exhibition is a group of installations that belong together, for example a <b>Physics Exhibition</b> and a <b>Chemistry Exhibition</b>.
        After saving, add installations to it from the Exhibits page.
      </p>
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <section className={cn(panel, "space-y-3")}>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Name</span>
              <Input name="title" required maxLength={100} value={d.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Physics Exhibition" />
            </label>
            <div className="text-sm">
              <span className="mb-1 block font-medium">Subject</span>
              <div role="group" aria-label="Subject" className="flex gap-2">
                {SUBJECTS.map(([v, l]) => (
                  <button key={v} type="button" aria-pressed={d.subject === v} onClick={() => set("subject", v)} className={cn("flex-1 rounded-md border px-3 py-2 text-sm", d.subject === v ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-accent")}>
                    {l}
                  </button>
                ))}
              </div>
              <span className="mt-1 block text-muted-foreground">New installations you add to it start with this subject. “Mixed” leaves the choice to each installation.</span>
            </div>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">One-line summary</span>
              <Input name="summary" value={d.summary} maxLength={160} onChange={(e) => set("summary", e.target.value)} placeholder="e.g. Forces, waves and light" />
            </label>
          </section>
          <section className={cn(panel, "space-y-3")}>
            <div>
              <h2 className="font-semibold">Introduction (optional)</h2>
              <p className="text-sm text-muted-foreground">Students can open this above the list of installations: where it is, what to expect.</p>
            </div>
            <MarkdownEditor name="bodyMd" value={d.bodyMd} onChange={(v) => set("bodyMd", v)} rows={8} placeholder={"Open 10:00–16:00 in the Main Hall.\n\nStart with the pendulum, then try the wave tank."} />
          </section>
          <section className={cn(panel, "space-y-3")}>
            <h2 className="font-semibold">Cover picture (optional)</h2>
            <CoverImageField name="imageUrl" value={d.imageUrl} onChange={(v) => set("imageUrl", v)} />
          </section>
        </div>
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">What students will see</p>
          <article className={cn(panel, "space-y-2 overflow-hidden p-0")} aria-label="Preview">
            {d.imageUrl.trim() && <img src={d.imageUrl} alt="" className="h-32 w-full object-cover" onError={(e) => (e.currentTarget.style.display = "none")} />}
            <div className="space-y-2 p-4">
              <div><SubjectBadge subject={d.subject} /></div>
              <h2 className="text-xl font-bold">{d.title || "Untitled exhibition"}</h2>
              {d.summary && <p className="text-sm text-muted-foreground">{d.summary}</p>}
              {d.bodyMd.trim() && <Prose className="text-sm">{d.bodyMd}</Prose>}
            </div>
          </article>
        </aside>
      </div>
      <FormError error={save.error ?? del.error} />
      {id && status.saved && (
        <p role="status" className="text-sm text-emerald-700">
          Saved. <Link to="/admin/exhibits" className="underline">Back to the exhibits</Link>
        </p>
      )}
      <div className="sticky bottom-0 -mx-4 flex items-center justify-end gap-2 border-t bg-background/95 p-3 backdrop-blur">
        {id && existing && (
          <button
            type="button"
            className="mr-auto text-sm text-red-700 underline"
            disabled={del.isPending}
            onClick={() => {
              const n = existing.total;
              const keep = n === 0 ? "" : ` Its ${n} ${n === 1 ? "installation is" : "installations are"} kept and will no longer belong to an exhibition.`;
              if (window.confirm(`Delete the exhibition “${d.title}”?${keep}`)) del.mutate();
            }}
          >
            Delete this exhibition
          </button>
        )}
        <Button asChild variant="outline"><Link to="/admin/exhibits">{id && status.saved ? "Close" : "Cancel"}</Link></Button>
        <SaveButton pending={save.isPending} dirty={id ? status.dirty : undefined} saved={status.saved}>{id ? "Save changes" : "Create exhibition"}</SaveButton>
      </div>
    </form>
  );
}
