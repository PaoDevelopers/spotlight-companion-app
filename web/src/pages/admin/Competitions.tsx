import { useEffect, useId, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ApiError, api } from "@/lib/api";
import { kindLabel } from "@/lib/competition";
import { setUnsaved } from "@/lib/unsaved";
import { cn } from "@/lib/utils";
import type { CompetitionKind, Entry, StudentHit } from "@/lib/types";
import { FormError, SaveButton, panel } from "./shared";

const STATUSES = ["registered", "competing", "advanced", "eliminated", "finished"];

interface Comp {
  id: number;
  eventId: number;
  name: string;
  kind: CompetitionKind;
  houses?: string[];
  entries: Entry[];
}
interface Data {
  competitions: Comp[];
}

/** What a teacher edits for one student. Kept as text while typing. */
interface Fields {
  status: string;
  score: string;
  rank: string;
  notes: string;
}
const fromEntry = (e: Entry): Fields => ({ status: e.status, score: e.score === null ? "" : String(e.score), rank: e.rank === null ? "" : String(e.rank), notes: e.notes ?? "" });
const num = (v: string) => (v.trim() === "" ? null : Number(v));

// One grid for the header and every row, so the columns line up. On a phone each row becomes a small card with its own labels.
const GRID = "md:grid md:grid-cols-[minmax(0,2fr)_8.5rem_5.5rem_5.5rem_minmax(0,2fr)_auto] md:items-center md:gap-3";

function Cell({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div role="cell" className={className}>
      <span className="mb-0.5 block text-xs text-muted-foreground md:hidden">{label}</span>
      {children}
    </div>
  );
}

function ResultsCard({ c }: { c: Comp }) {
  const qc = useQueryClient();
  const [edits, setEdits] = useState<Record<number, Partial<Fields>>>({});
  const [justSaved, setJustSaved] = useState(false);
  const [filter, setFilter] = useState("");
  const key = useId();

  const current = (e: Entry): Fields => ({ ...fromEntry(e), ...edits[e.id] });
  const changed = (e: Entry) => {
    const now = current(e), was = fromEntry(e);
    return (Object.keys(now) as (keyof Fields)[]).some((k) => now[k] !== was[k]);
  };
  const changedEntries = c.entries.filter(changed);
  const n = changedEntries.length;
  useEffect(() => {
    setUnsaved(n > 0, key);
    return () => setUnsaved(false, key);
  }, [n, key]);

  // a steady order (class, then name) that does not jump around while ranks are being typed
  const rows = useMemo(() => [...c.entries].sort((a, b) => a.className.localeCompare(b.className) || a.name.localeCompare(b.name)), [c.entries]);
  const shown = filter.trim() ? rows.filter((e) => `${e.name} ${e.className}`.toLowerCase().includes(filter.trim().toLowerCase())) : rows;

  const edit = (e: Entry, k: keyof Fields, v: string) => {
    setEdits((prev) => ({ ...prev, [e.id]: { ...prev[e.id], [k]: v } }));
    setJustSaved(false);
  };

  const save = useMutation({
    mutationFn: async () => {
      const results = await Promise.allSettled(
        changedEntries.map((e) => {
          const v = current(e);
          return api.put(`/api/admin/entries/${e.id}`, { status: v.status, score: num(v.score), rank: num(v.rank), notes: v.notes.trim() || null });
        }),
      );
      const savedIds = changedEntries.filter((_, i) => results[i].status === "fulfilled").map((e) => e.id);
      await qc.refetchQueries({ queryKey: ["admin-competitions"] });
      setEdits((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => !savedIds.includes(Number(id)))));
      const failed = results.length - savedIds.length;
      if (failed > 0) throw new ApiError(0, "partial", `${failed} of ${results.length} could not be saved (a rank must be 1 or more). The rows still marked “edited” were not saved: fix them and press Save again.`);
    },
    onSuccess: () => { setJustSaved(true); qc.invalidateQueries({ queryKey: ["leaderboard"] }); },
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.del(`/api/admin/entries/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-competitions"] }); qc.invalidateQueries({ queryKey: ["leaderboard"] }); },
  });

  // Highest score is rank 1; equal scores share a rank (1, 2, 2, 4). Only students who have a score get one.
  const scored = c.entries.filter((e) => Number.isFinite(num(current(e).score) ?? NaN));
  const fillRanks = () => {
    for (const e of scored) {
      const s = num(current(e).score)!;
      const rank = 1 + scored.filter((o) => num(current(o).score)! > s).length;
      edit(e, "rank", String(rank));
    }
  };

  return (
    <section className={cn(panel, "p-0")} aria-label={c.name}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b p-4">
        <h2 className="text-lg font-semibold">
          <Link to={`/admin/events/${c.eventId}`} className="hover:underline">{c.name}</Link>
        </h2>
        <span className="text-sm text-muted-foreground">
          {kindLabel(c.kind)} competition · {c.entries.length} {c.entries.length === 1 ? "entry" : "entries"} ·{" "}
          <Link to={`/admin/events/${c.eventId}/edit`} className="underline">change type</Link>
        </span>
      </div>

      {c.entries.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">Nobody has entered yet. Students enter from the event page in the app, or you can add them below.</p>
      ) : (
        <div className="p-4 pt-3">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="outline" disabled={scored.length === 0} onClick={fillRanks} title="Highest score gets rank 1; equal scores share a rank">
              Fill ranks from scores
            </Button>
            {c.entries.length > 8 && <Input type="search" aria-label="Find a student" placeholder="Find a student…" value={filter} onChange={(ev) => setFilter(ev.target.value)} className="w-48" />}
            <span className="text-xs text-muted-foreground">Type a score and a rank for each student, then press Save once.</span>
          </div>
          <div role="table" aria-label={`Results for ${c.name}`}>
            <div role="row" className={cn("hidden border-b pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground", GRID)}>
              <div role="columnheader">Student</div>
              <div role="columnheader">Status</div>
              <div role="columnheader">Score</div>
              <div role="columnheader">Rank</div>
              <div role="columnheader">Notes</div>
              <div role="columnheader" className="w-16"><span className="sr-only">Actions</span></div>
            </div>
            {shown.map((e) => {
              const v = current(e);
              const isEdited = changed(e);
              return (
                <div key={e.id} role="row" aria-label={e.name} className={cn("grid gap-2 border-b py-3 last:border-b-0 sm:grid-cols-2", GRID, isEdited && "bg-amber-50")}>
                  <div role="cell" className="sm:col-span-2 md:col-span-1">
                    <b>{e.name}</b> <span className="text-sm text-muted-foreground">{e.className}</span>
                    {(e.teamName || e.house) && <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-xs">{e.teamName ?? `${e.house} house`}</span>}
                    {isEdited && <span className="ml-2 text-xs font-medium text-amber-700">edited</span>}
                  </div>
                  <Cell label="Status">
                    <Select name="status" value={v.status} onChange={(ev) => edit(e, "status", ev.target.value)} aria-label={`Status for ${e.name}`}>
                      {STATUSES.map((s) => <option key={s}>{s}</option>)}
                    </Select>
                  </Cell>
                  <Cell label="Score">
                    <Input name="score" type="number" inputMode="decimal" value={v.score} onChange={(ev) => edit(e, "score", ev.target.value)} aria-label={`Score for ${e.name}`} />
                  </Cell>
                  <Cell label="Rank">
                    <Input name="rank" type="number" min="1" inputMode="numeric" value={v.rank} onChange={(ev) => edit(e, "rank", ev.target.value)} aria-label={`Rank for ${e.name}`} />
                  </Cell>
                  <Cell label="Notes" className="sm:col-span-2 md:col-span-1">
                    <Input name="notes" value={v.notes} onChange={(ev) => edit(e, "notes", ev.target.value)} aria-label={`Notes for ${e.name}`} placeholder="optional" />
                  </Cell>
                  <div role="cell" className="text-right sm:col-span-2 md:col-span-1">
                    <button
                      type="button"
                      className="text-sm text-red-700 underline"
                      aria-label={`Remove ${e.name}`}
                      disabled={remove.isPending}
                      onClick={() => { if (window.confirm(`Remove ${e.name} from this competition? Their score is lost.`)) remove.mutate(e.id); }}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              );
            })}
            {shown.length === 0 && <p className="py-3 text-sm text-muted-foreground">No student matches “{filter}”.</p>}
          </div>
          <FormError error={save.error ?? remove.error} />
        </div>
      )}

      {c.entries.length > 0 && (
        <form
          onSubmit={(ev) => { ev.preventDefault(); save.mutate(); }}
          className="sticky bottom-0 flex flex-wrap items-center justify-between gap-2 rounded-b-lg border-t bg-card/95 p-3 backdrop-blur"
        >
          <span role="status" className={cn("text-sm", n > 0 ? "font-medium text-amber-700" : justSaved ? "text-emerald-700" : "text-muted-foreground")}>
            {n > 0 ? `${n} ${n === 1 ? "row has" : "rows have"} changes that are not saved yet` : justSaved ? "All changes are saved." : "Nothing to save yet."}
          </span>
          <span className="flex gap-2">
            {n > 0 && !save.isPending && <Button type="button" variant="outline" onClick={() => { setEdits({}); save.reset(); }}>Discard changes</Button>}
            <SaveButton pending={save.isPending} dirty={n > 0} saved={justSaved && n === 0} savedText="✓ All saved">
              {`Save ${n} ${n === 1 ? "change" : "changes"}`}
            </SaveButton>
          </span>
        </form>
      )}
      <div className="px-4 pb-4"><AddEntry c={c} /></div>
    </section>
  );
}

/** Enter a student by hand: for someone without a phone, or who signed up on paper. */
function AddEntry({ c }: { c: Comp }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [extra, setExtra] = useState(c.kind === "house" ? c.houses?.[0] ?? "" : "");
  const term = text.trim();
  const hits = useQuery({
    queryKey: ["admin-students", term],
    queryFn: () => api.get<StudentHit[]>(`/api/admin/students?q=${encodeURIComponent(term)}`),
    enabled: term.length >= 2,
    placeholderData: (prev) => prev,
  });
  const add = useMutation({
    mutationFn: (userId: number) => api.post(`/api/admin/competitions/${c.id}/entries`, { userId, team: c.kind === "team" ? extra : "", house: c.kind === "house" ? extra : "" }),
    onSuccess: () => { setText(""); qc.invalidateQueries({ queryKey: ["admin-competitions"] }); qc.invalidateQueries({ queryKey: ["leaderboard"] }); },
  });
  const have = new Set(c.entries.map((e) => e.userId));
  return (
    <details className="mt-3 text-sm">
      <summary className="inline-flex cursor-pointer items-center rounded-md border border-input bg-card px-3 py-2 font-medium hover:bg-accent">＋ Add a student by hand</summary>
      <div className="mt-2 flex flex-wrap gap-2">
        <Input type="search" name="search" autoComplete="off" placeholder="Search students by name or class…" value={text} onChange={(e) => setText(e.target.value)} className="min-w-48 flex-1" aria-label={`Search students for ${c.name}`} />
        {c.kind === "house" && (
          <Select value={extra} onChange={(e) => setExtra(e.target.value)} className="w-auto" aria-label="House">
            {c.houses?.map((h) => <option key={h}>{h}</option>)}
          </Select>
        )}
        {c.kind === "team" && <Input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="Team name" className="w-40" aria-label="Team name" />}
      </div>
      <FormError error={add.error} />
      {term.length >= 2 && hits.data && (
        <ul className="mt-1 divide-y">
          {hits.data.length === 0 && <li className="py-1 text-muted-foreground">No student matches “{term}”.</li>}
          {hits.data.map((h) => (
            <li key={h.id} className="flex items-center justify-between py-1">
              <span>{h.name} <span className="text-muted-foreground">{h.className}</span></span>
              {have.has(h.id) ? <span className="text-emerald-700">✓ Entered</span> : <Button size="sm" variant="outline" disabled={add.isPending} onClick={() => add.mutate(h.id)}>Add</Button>}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

export default function AdminCompetitions() {
  const q = useQuery({ queryKey: ["admin-competitions"], queryFn: () => api.get<Data>("/api/admin/competitions") });
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Competition results</h1>
        <p className="text-sm text-muted-foreground">
          A competition belongs to its event. To start one, open the event, choose <b>Edit event</b> and tick <b>This event is a competition</b>.
        </p>
      </div>
      {q.data && q.data.competitions.length === 0 && (
        <p role="status" className={`${panel} text-sm`}>
          No competitions yet. <Link to="/admin/events" className="underline">Go to Events</Link>.
        </p>
      )}
      {q.data?.competitions.map((c) => <ResultsCard key={c.id} c={c} />)}
    </div>
  );
}
