import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { SubjectBadge } from "@/components/ui/badge";
import { CoverImageField } from "@/components/CoverImageField";
import { QrImage } from "@/components/QrImage";
import { api, errorMessage } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { SUBJECTS } from "@/lib/subjects";
import type { Hunt, HuntResultRow, HuntStageAdmin, StudentHit, Subject } from "@/lib/types";
import { FormError, SaveButton, panel, useDraftStatus } from "./shared";

export default function AdminHunts() {
  const q = useQuery({ queryKey: ["admin-hunts"], queryFn: () => api.get<{ hunts: Hunt[] }>("/api/admin/hunts") });
  const hunts = q.data?.hunts ?? [];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Scavenger hunts</h1>
        <Button asChild><Link to="/admin/hunts/new">New scavenger hunt</Link></Button>
      </div>
      <p className="text-sm text-muted-foreground">A hunt is a list of stages. Students solve them in order by typing a code word, scanning the station's QR code, or you can tick a stage for them. The first to finish wins.</p>
      {q.data && hunts.length === 0 && <p className="text-muted-foreground">No hunts yet.</p>}
      <div className="grid gap-2 lg:grid-cols-2">
        {hunts.map((h) => (
          <div key={h.id} className="rounded-lg bg-card p-3 shadow-sm">
            <div><SubjectBadge subject={h.subject} /><b>{h.title}</b> {!h.published && <span className="rounded bg-amber-100 px-1 text-xs">Draft</span>}</div>
            <div className="text-sm text-muted-foreground">{h.stages} stages</div>
            <div className="mt-2 flex flex-wrap gap-3 text-sm">
              <Link to={`/admin/hunts/${h.id}/results`} className="underline">Who has done what</Link>
              <Link to={`/admin/hunts/${h.id}/edit`} className="underline">Edit</Link>
              <Link to={`/admin/hunts/${h.id}/signs`} className="underline">Print station signs</Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface StageDraft { key: string; id: number | null; title: string; clue: string; answers: string }
interface Draft { title: string; subject: Subject; description: string; imageUrl: string; published: boolean; stages: StageDraft[] }
let counter = 0;
const blankStage = (): StageDraft => ({ key: `n${++counter}`, id: null, title: "", clue: "", answers: "" });
const EMPTY: Draft = { title: "", subject: "chemistry", description: "", imageUrl: "", published: false, stages: [blankStage()] };

interface Loaded { hunt: Hunt; stages: HuntStageAdmin[] }
const useHunt = (id?: string) => useQuery({ queryKey: ["admin-hunt", id], enabled: !!id, queryFn: () => api.get<Loaded>(`/api/admin/hunts/${id}`) });

export function AdminHuntEdit() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const q = useHunt(id);
  const [d, setD] = useState<Draft>(EMPTY);
  const [loaded, setLoaded] = useState(!id);
  useEffect(() => {
    if (id && q.data && !loaded) {
      const { hunt: h, stages } = q.data;
      setD({ title: h.title, subject: h.subject, description: h.description, imageUrl: h.imageUrl ?? "", published: h.published, stages: stages.map((s) => ({ key: `s${s.id}`, id: s.id, title: s.title, clue: s.clue, answers: s.answers.join("\n") })) });
      setLoaded(true);
    }
  }, [id, q.data, loaded]);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const setStage = (i: number, patch: Partial<StageDraft>) => setD((x) => ({ ...x, stages: x.stages.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  const move = (i: number, by: number) => setD((x) => {
    const j = i + by;
    if (j < 0 || j >= x.stages.length) return x;
    const stages = [...x.stages];
    [stages[i], stages[j]] = [stages[j], stages[i]];
    return { ...x, stages };
  });
  const status = useDraftStatus(d, loaded);
  const sent = useRef(d);
  const refresh = () => Promise.all(["admin-hunts", "admin-hunt", "hunts", "hunt"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
  const body = () => ({
    title: d.title, subject: d.subject, description: d.description, imageUrl: d.imageUrl, published: d.published,
    stages: d.stages.map((s) => ({ id: s.id, title: s.title, clue: s.clue, answers: s.answers.split("\n").map((a) => a.trim()).filter(Boolean) })),
  });
  const save = useMutation({
    mutationFn: () => (id ? api.put<Loaded>(`/api/admin/hunts/${id}`, body()) : api.post<Loaded>("/api/admin/hunts", body())),
    onSuccess: (r) => {
      refresh();
      if (!id) { navigate(`/admin/hunts/${r.hunt.id}/edit`, { replace: true }); return; }
      // new stages now have ids; take them in so the next save keeps their progress
      const next = { ...sent.current, stages: r.stages.map((s, i) => ({ ...sent.current.stages[i], key: `s${s.id}`, id: s.id })) };
      setD(next);
      status.markSaved(next);
    },
  });
  const del = useMutation({
    mutationFn: () => api.del(`/api/admin/hunts/${id}`),
    onSuccess: () => { refresh(); navigate("/admin/hunts", { replace: true }); },
  });
  if (id && q.isError) return <p>Scavenger hunt not found.</p>;
  if (id && !loaded) return <p className="text-muted-foreground">Loading…</p>;
  return (
    <form onSubmit={(e: FormEvent) => { e.preventDefault(); sent.current = d; save.mutate(); }} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">{id ? "Edit scavenger hunt" : "New scavenger hunt"}</h1>
        {id && <span className="flex gap-3 text-sm"><Link to={`/admin/hunts/${id}/results`} className="underline">Who has done what</Link><Link to={`/admin/hunts/${id}/signs`} className="underline">Print station signs</Link></span>}
      </div>
      <section className={`${panel} space-y-3`}>
        <label className="block text-sm"><span className="mb-1 block font-medium">Title</span>
          <Input name="title" required value={d.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Chemistry Scavenger Hunt" />
        </label>
        <label className="block text-sm"><span className="mb-1 block font-medium">Subject</span>
          <Select name="subject" value={d.subject} onChange={(e) => set("subject", e.target.value as Subject)}>{SUBJECTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
        </label>
        <label className="block text-sm"><span className="mb-1 block font-medium">Introduction for students</span>
          <Textarea name="description" rows={4} value={d.description} onChange={(e) => set("description", e.target.value)} />
        </label>
        <CoverImageField name="imageUrl" value={d.imageUrl} onChange={(v) => set("imageUrl", v)} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="published" checked={d.published} onChange={(e) => set("published", e.target.checked)} />
          <span><b>Open to students.</b> Leave unticked while you are still writing it; only teachers can see a draft.</span>
        </label>
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Stages</h2>
        <p className="text-sm text-muted-foreground">Students do them in this order. Put each accepted code word or answer on its own line; capital letters and spacing don't matter. Each station also gets its own QR code (see “Print station signs” after saving).</p>
        {d.stages.map((s, i) => (
          <div key={s.key} className={`${panel} space-y-2`} role="group" aria-label={`Stage ${i + 1}`}>
            <div className="flex items-center justify-between gap-2">
              <b>Stage {i + 1}</b>
              <span className="flex gap-2 text-sm">
                <button type="button" className="underline disabled:opacity-40" disabled={i === 0} onClick={() => move(i, -1)}>Move up</button>
                <button type="button" className="underline disabled:opacity-40" disabled={i === d.stages.length - 1} onClick={() => move(i, 1)}>Move down</button>
                <button type="button" className="text-red-700 underline disabled:opacity-40" disabled={d.stages.length === 1}
                  onClick={() => { if (window.confirm(`Remove stage ${i + 1}? Students' progress on it is lost.`)) set("stages", d.stages.filter((_, j) => j !== i)); }}>Remove</button>
              </span>
            </div>
            <Input aria-label={`Stage ${i + 1} title`} required value={s.title} onChange={(e) => setStage(i, { title: e.target.value })} placeholder="Short name, e.g. The Fume Cupboard" />
            <Textarea aria-label={`Stage ${i + 1} clue`} rows={3} value={s.clue} onChange={(e) => setStage(i, { clue: e.target.value })} placeholder="The clue students see once the stage is unlocked" />
            <Textarea aria-label={`Stage ${i + 1} accepted answers`} rows={2} value={s.answers} onChange={(e) => setStage(i, { answers: e.target.value })} placeholder="Accepted code words or answers, one per line" />
          </div>
        ))}
        <Button type="button" variant="outline" disabled={d.stages.length >= 30} onClick={() => set("stages", [...d.stages, blankStage()])}>Add a stage</Button>
      </section>
      <FormError error={save.error ?? del.error} />
      <div className="sticky bottom-0 -mx-4 flex items-center justify-end gap-2 border-t bg-background/95 p-3 backdrop-blur">
        {id && (
          <button type="button" className="mr-auto text-sm text-red-700 underline" disabled={del.isPending}
            onClick={() => { if (window.confirm(`Delete “${d.title}”? All progress and photos are deleted and printed station codes stop working.`)) del.mutate(); }}>Delete this hunt</button>
        )}
        <Button asChild variant="outline"><Link to="/admin/hunts">{id && status.saved ? "Close" : "Cancel"}</Link></Button>
        <SaveButton pending={save.isPending} dirty={id ? status.dirty : undefined} saved={status.saved}>{id ? "Save changes" : "Create hunt"}</SaveButton>
      </div>
    </form>
  );
}

/** One page of signs to print and put at the stations: a QR code per stage, which completes that stage for whoever scans it. */
export function AdminHuntSigns() {
  const { id } = useParams();
  const q = useHunt(id);
  if (!q.data) return null;
  return (
    <div className="space-y-4">
      <div className="no-print flex items-center gap-3">
        <h1 className="text-2xl font-bold">Station signs: {q.data.hunt.title}</h1>
        <Button onClick={() => window.print()}>Print</Button>
      </div>
      <p className="no-print text-sm text-muted-foreground">Put each sign at its station. Scanning it completes that stage, but only for a student who has reached it. These codes never change.</p>
      <div className="grid gap-4 md:grid-cols-2">
        {q.data.stages.map((s) => (
          <div key={s.id} className="flex break-inside-avoid flex-col items-center gap-2 rounded-lg border-2 border-foreground bg-white p-6 text-center text-black">
            <div className="text-xl font-bold">Stage {s.position}: {s.title}</div>
            <QrImage text={s.url} size={220} />
            <div className="text-sm">Scan with the Spotlight app (Scan tab)</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AdminHuntResults() {
  const { id } = useParams();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin-hunt-results", id], queryFn: () => api.get<{ hunt: Hunt; results: HuntResultRow[] }>(`/api/admin/hunts/${id}/results`) });
  const [term, setTerm] = useState("");
  const [add, setAdd] = useState<StudentHit | null>(null);
  const people = useQuery({
    queryKey: ["admin-hunt-students", term],
    enabled: term.trim().length >= 2,
    queryFn: () => api.get<StudentHit[]>(`/api/admin/students?q=${encodeURIComponent(term.trim())}`),
  });
  const mark = useMutation({
    mutationFn: (v: { userId: number; stageId: number; done: boolean }) => api.post(`/api/admin/hunts/${id}/mark`, v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-hunt-results", id] }),
  });
  const delPhoto = useMutation({ mutationFn: (pid: number) => api.del(`/api/hunt-photos/${pid}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-hunt-results", id] }) });
  if (q.isError) return <p>Scavenger hunt not found.</p>;
  if (!q.data) return null;
  const rows = q.data.results;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{q.data.hunt.title}: who has done what</h1>
      <p className="text-sm text-muted-foreground">Finishers are listed first, earliest first. Tick a stage for a student who has no phone, or untick one that was recorded wrongly. Students must do stages in order, so tick them in order too.</p>
      {rows.length === 0 && <p className="text-muted-foreground">Nobody has started yet.</p>}
      <FormError error={mark.error ?? delPhoto.error} />
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.userId} className={`${panel} space-y-2`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-semibold">{r.rank ? `${r.rank}. ` : ""}{r.name}{r.className ? ` · ${r.className}` : ""}</span>
              <span className="text-sm text-muted-foreground">{r.finished && r.finishedAt ? `Finished ${fmtDateTime(r.finishedAt)}` : `${r.done} of ${r.total} stages`}</span>
            </div>
            <ul className="space-y-1 text-sm">
              {r.stages.map((s) => (
                <li key={s.stageId} className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={!!s.at} disabled={mark.isPending} aria-label={`${r.name}: stage ${s.position} ${s.title}`}
                      onChange={(e) => mark.mutate({ userId: r.userId, stageId: s.stageId, done: e.target.checked })} />
                    Stage {s.position}: {s.title}
                  </label>
                  {s.at && <span className="text-xs text-muted-foreground">{fmtDateTime(s.at)} · {s.method === "teacher" ? "by a teacher" : s.method === "qr" ? "scanned" : "typed"}</span>}
                  {s.photos.map((p) => (
                    <a key={p.id} href={p.imageUrl} target="_blank" rel="noreferrer" className="inline-block">
                      <img src={p.imageUrl} alt={p.caption || "Evidence photo"} className="size-12 rounded object-cover" />
                    </a>
                  ))}
                  {s.photos.length > 0 && (
                    <button type="button" className="text-xs text-red-700 underline" onClick={() => { if (window.confirm("Delete this student's photos for this stage?")) s.photos.forEach((p) => delPhoto.mutate(p.id)); }}>Delete photos</button>
                  )}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      <section className={`${panel} space-y-2`}>
        <h2 className="font-semibold">Record a student who isn't listed</h2>
        <p className="text-sm text-muted-foreground">For a student with no phone: search their name, then mark the stages they have done.</p>
        <Input aria-label="Search students" value={term} onChange={(e) => { setTerm(e.target.value); setAdd(null); }} placeholder="Type at least two letters of a name" />
        {!add && people.data?.map((p) => (
          <button key={p.id} type="button" onClick={() => setAdd(p)} className="block w-full rounded border bg-card px-3 py-2 text-left text-sm hover:bg-accent">
            {p.name}{p.className ? ` (${p.className})` : ""}
          </button>
        ))}
        {add && (
          <div className="space-y-1 text-sm">
            <p>Marking for <b>{add.name}</b></p>
            <ul className="space-y-1"><HuntStagePicker huntId={id!} userId={add.id} onMarked={() => qc.invalidateQueries({ queryKey: ["admin-hunt-results", id] })} /></ul>
          </div>
        )}
        {mark.isError && <p role="alert" className="text-sm text-red-700">{errorMessage(mark.error)}</p>}
      </section>
    </div>
  );
}

function HuntStagePicker({ huntId, userId, onMarked }: { huntId: string; userId: number; onMarked: () => void }) {
  const q = useHunt(huntId);
  const mark = useMutation({
    mutationFn: (stageId: number) => api.post(`/api/admin/hunts/${huntId}/mark`, { userId, stageId, done: true }),
    onSuccess: onMarked,
  });
  return (
    <>
      {q.data?.stages.map((s) => (
        <li key={s.id}><Button type="button" size="sm" variant="outline" disabled={mark.isPending} onClick={() => mark.mutate(s.id)}>Mark stage {s.position} done: {s.title}</Button></li>
      ))}
    </>
  );
}
