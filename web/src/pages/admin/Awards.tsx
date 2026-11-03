import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { api } from "@/lib/api";
import type { Award, StudentHit } from "@/lib/types";
import { FormError, SaveButton, panel } from "./shared";

const MAX_REASON = 500;

/** Pick students by searching; the chosen ones appear as chips that can be removed. */
function StudentPicker({ chosen, onChange }: { chosen: StudentHit[]; onChange: (s: StudentHit[]) => void }) {
  const [text, setText] = useState("");
  const term = text.trim();
  const hits = useQuery({
    queryKey: ["admin-students", term],
    queryFn: () => api.get<StudentHit[]>(`/api/admin/students?q=${encodeURIComponent(term)}`),
    enabled: term.length >= 2,
    placeholderData: (prev) => prev,
  });
  const ids = new Set(chosen.map((c) => c.id));
  return (
    <div className="space-y-2">
      {chosen.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Chosen students">
          {chosen.map((c) => (
            <li key={c.id} className="flex items-center gap-1 rounded-full bg-muted py-1 pl-3 pr-1 text-sm">
              {c.name} <span className="text-muted-foreground">{c.className}</span>
              <button type="button" aria-label={`Remove ${c.name}`} className="rounded-full px-2 hover:bg-accent" onClick={() => onChange(chosen.filter((x) => x.id !== c.id))}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <Input type="search" name="search" autoComplete="off" placeholder="Search students by name, class or email…" value={text} onChange={(e) => setText(e.target.value)} />
      {term.length >= 2 && hits.data && (
        <ul className="divide-y rounded-md border bg-card" aria-label="Search results">
          {hits.data.length === 0 && <li className="p-2 text-sm text-muted-foreground">No student matches “{term}”.</li>}
          {hits.data.map((h) => (
            <li key={h.id} className="flex items-center justify-between gap-2 p-2 text-sm">
              <span>{h.name} <span className="text-muted-foreground">{h.className}</span></span>
              {ids.has(h.id) ? (
                <span className="text-emerald-700">✓ Chosen</span>
              ) : (
                <Button type="button" size="sm" variant="outline" onClick={() => { onChange([...chosen, h]); setText(""); }}>
                  Choose
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function GiveAward({ titles }: { titles: string[] }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [reason, setReason] = useState("");
  const [students, setStudents] = useState<StudentHit[]>([]);
  const [done, setDone] = useState("");
  const add = useMutation({
    mutationFn: () => api.post<{ created: number }>("/api/admin/awards", { title, reason, userIds: students.map((s) => s.id) }),
    onSuccess: (r) => {
      setDone(`Added “${title.trim()}” for ${r.created} ${r.created === 1 ? "student" : "students"}. It is a draft until you publish it.`);
      setReason("");
      setStudents([]);
      qc.invalidateQueries({ queryKey: ["admin-awards"] });
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    setDone("");
    add.mutate();
  }
  return (
    <form onSubmit={submit} className={`${panel} space-y-3`}>
      <h2 className="font-semibold">Give an award</h2>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Award</span>
        <Input name="title" required maxLength={80} list="award-titles" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Most Creative Exhibit" />
        <datalist id="award-titles">{titles.map((t) => <option key={t} value={t} />)}</datalist>
      </label>
      <div className="text-sm">
        <span className="mb-1 block font-medium">Students <span className="font-normal text-muted-foreground">(you can choose several for the same award)</span></span>
        <StudentPicker chosen={students} onChange={setStudents} />
      </div>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Reason <span className="font-normal text-muted-foreground">(optional; the student sees it)</span></span>
        <Textarea name="reason" rows={3} maxLength={MAX_REASON} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Built a working chain-reaction machine from recycled parts." />
        <span className="text-xs text-muted-foreground">{reason.length}/{MAX_REASON}</span>
      </label>
      <FormError error={add.error} />
      {done && <p role="status" className="text-sm text-emerald-700">{done}</p>}
      <SaveButton pending={add.isPending} disabled={!title.trim() || students.length === 0} pendingText="Adding…">
        Add award
      </SaveButton>
    </form>
  );
}

function AwardRow({ a }: { a: Award }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(a.title);
  const [reason, setReason] = useState(a.reason);
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-awards"] });
  const save = useMutation({ mutationFn: () => api.put(`/api/admin/awards/${a.id}`, { title, reason }), onSuccess: () => { setEditing(false); refresh(); } });
  const del = useMutation({ mutationFn: () => api.del(`/api/admin/awards/${a.id}`), onSuccess: refresh });
  if (editing) {
    return (
      <li className="space-y-2 py-2">
        <b>{a.name}</b> <span className="text-sm text-muted-foreground">{a.className}</span>
        <Input aria-label="Award" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
        <Textarea aria-label="Reason" rows={2} value={reason} maxLength={MAX_REASON} onChange={(e) => setReason(e.target.value)} />
        <FormError error={save.error} />
        <div className="flex gap-2">
          <SaveButton pending={save.isPending} size="sm" disabled={!title.trim()}>Save</SaveButton>
          <Button type="button" size="sm" variant="outline" onClick={() => { setEditing(false); setTitle(a.title); setReason(a.reason); }}>Cancel</Button>
        </div>
      </li>
    );
  }
  return (
    <li className="flex flex-wrap items-start justify-between gap-2 py-2">
      <div className="min-w-0 flex-1">
        <b>{a.name}</b> <span className="text-sm text-muted-foreground">{a.className}</span>
        <span className={`ml-2 rounded px-1.5 py-0.5 text-xs ${a.published ? "bg-emerald-100" : "bg-amber-100"}`}>{a.published ? "published" : "draft"}</span>
        {a.reason && <p className="text-sm text-muted-foreground">“{a.reason}”</p>}
      </div>
      <span className="flex gap-3 text-sm">
        <button type="button" className="underline" onClick={() => setEditing(true)}>Edit</button>
        <button
          type="button"
          className="text-red-700 underline"
          disabled={del.isPending}
          onClick={() => { if (window.confirm(`Remove “${a.title}” from ${a.name}?${a.published ? " Students can already see it." : ""}`)) del.mutate(); }}
        >
          Remove
        </button>
      </span>
      <FormError error={del.error} />
    </li>
  );
}

export default function AdminAwards() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin-awards"], queryFn: () => api.get<{ awards: Award[] }>("/api/admin/awards") });
  const publish = useMutation({
    mutationFn: (v: { ids: number[]; published: boolean }) => api.post<{ changed: number }>("/api/admin/awards/publish", v),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-awards"] }); qc.invalidateQueries({ queryKey: ["leaderboard"] }); qc.invalidateQueries({ queryKey: ["home"] }); },
  });
  const awards = q.data?.awards ?? [];
  const titles = useMemo(() => [...new Set(awards.map((a) => a.title))], [awards]);
  const groups = useMemo(() => {
    const m = new Map<string, Award[]>();
    for (const a of awards) m.set(a.title, [...(m.get(a.title) ?? []), a]);
    return [...m.entries()];
  }, [awards]);
  const drafts = awards.filter((a) => !a.published);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Awards</h1>
      <p className="text-sm text-muted-foreground">
        You choose who receives each award. New awards are drafts that only teachers can see. When you publish them, each student sees their award
        (with your reason) on their Home page, and the Board lists the winners.
      </p>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:items-start">
        <GiveAward titles={titles} />
        <div className="space-y-4">
          <div className={`${panel} flex flex-wrap items-center justify-between gap-2`}>
            <span className="text-sm">
              {drafts.length === 0 ? "No drafts waiting." : <><b>{drafts.length}</b> {drafts.length === 1 ? "award is" : "awards are"} still a draft: students can't see {drafts.length === 1 ? "it" : "them"} yet.</>}
            </span>
            <Button disabled={drafts.length === 0 || publish.isPending} onClick={() => { if (window.confirm(`Publish ${drafts.length} ${drafts.length === 1 ? "award" : "awards"} to students?`)) publish.mutate({ ids: [], published: true }); }}>
              Publish all drafts
            </Button>
          </div>
          <FormError error={publish.error} />
          {q.data && awards.length === 0 && <p className="text-muted-foreground">No awards yet.</p>}
          {groups.map(([title, rows]) => {
            const draftIds = rows.filter((r) => !r.published).map((r) => r.id);
            const pubIds = rows.filter((r) => r.published).map((r) => r.id);
            return (
              <section key={title} className={panel}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-semibold">🏆 {title} <span className="text-sm font-normal text-muted-foreground">({rows.length})</span></h2>
                  <span className="flex gap-2">
                    {draftIds.length > 0 && <Button size="sm" variant="outline" disabled={publish.isPending} onClick={() => publish.mutate({ ids: draftIds, published: true })}>Publish</Button>}
                    {pubIds.length > 0 && <Button size="sm" variant="outline" disabled={publish.isPending} onClick={() => { if (window.confirm(`Hide “${title}” from students again?`)) publish.mutate({ ids: pubIds, published: false }); }}>Hide</Button>}
                  </span>
                </div>
                <ul className="divide-y">{rows.map((a) => <AwardRow key={a.id} a={a} />)}</ul>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
