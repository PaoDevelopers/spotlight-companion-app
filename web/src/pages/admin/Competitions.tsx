import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { kindLabel } from "@/lib/competition";
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

function EntryRow({ e }: { e: Entry }) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-competitions"] });
  const save = useMutation({ mutationFn: (body: object) => api.put(`/api/admin/entries/${e.id}`, body), onSuccess: refresh });
  const remove = useMutation({ mutationFn: () => api.del(`/api/admin/entries/${e.id}`), onSuccess: () => { refresh(); qc.invalidateQueries({ queryKey: ["leaderboard"] }); } });
  const input = "w-auto p-1";
  return (
    <form
      className="flex flex-wrap items-center gap-2 border-t py-2 text-sm"
      onSubmit={(ev) => {
        ev.preventDefault();
        const f = new FormData(ev.currentTarget);
        const num = (k: string) => (String(f.get(k) ?? "") === "" ? null : Number(f.get(k)));
        save.mutate({ status: String(f.get("status")), score: num("score"), rank: num("rank"), notes: String(f.get("notes") ?? "") || null });
      }}
    >
      <span className="min-w-40 flex-1 basis-40">
        <b>{e.name}</b> <i className="text-muted-foreground">{e.className}</i>
        {(e.teamName || e.house) && <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-xs">{e.teamName ?? `${e.house} house`}</span>}
      </span>
      <Select name="status" defaultValue={e.status} className={input} aria-label="Status">
        {STATUSES.map((s) => <option key={s}>{s}</option>)}
      </Select>
      <Input name="score" type="number" defaultValue={e.score ?? ""} placeholder="score" className={`${input} w-20`} aria-label="Score" />
      <Input name="rank" type="number" min="1" defaultValue={e.rank ?? ""} placeholder="rank" className={`${input} w-16`} aria-label="Rank" />
      <Input name="notes" defaultValue={e.notes ?? ""} placeholder="notes" className={`${input} min-w-24 flex-1`} aria-label="Notes" />
      <SaveButton pending={save.isPending} variant="outline" size="sm">Save</SaveButton>
      <button type="button" className="text-red-700 underline" disabled={remove.isPending} onClick={() => { if (window.confirm(`Remove ${e.name} from this competition?`)) remove.mutate(); }}>
        Remove
      </button>
      <FormError error={save.error ?? remove.error} />
    </form>
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
    <details className="mt-2 text-sm">
      <summary className="cursor-pointer font-medium">Add a student by hand</summary>
      <div className="mt-2 flex flex-wrap gap-2">
        <Input type="search" name="search" autoComplete="off" placeholder="Search students…" value={text} onChange={(e) => setText(e.target.value)} className="min-w-48 flex-1" aria-label={`Search students for ${c.name}`} />
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
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Competition results</h1>
      <p className="text-sm text-muted-foreground">
        A competition belongs to its event. To start one, open the event, choose <b>Edit event</b> and tick <b>This event is a competition</b>.
      </p>
      {q.data && q.data.competitions.length === 0 && (
        <p role="status" className={`${panel} text-sm`}>
          No competitions yet. <Link to="/admin/events" className="underline">Go to Events</Link>.
        </p>
      )}
      <div className="grid gap-4 xl:grid-cols-2 xl:items-start">
        {q.data?.competitions.map((c) => (
          <section key={c.id} className={panel}>
            <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-semibold">{c.name}</h2>
              <span className="text-sm text-muted-foreground">
                {kindLabel(c.kind)} · {c.entries.length} {c.entries.length === 1 ? "entry" : "entries"} ·{" "}
                <Link to={`/admin/events/${c.eventId}/edit`} className="underline">change type</Link>
              </span>
            </div>
            {c.entries.map((e) => <EntryRow key={`${e.id}-${e.status}-${e.score}-${e.rank}`} e={e} />)}
            {c.entries.length === 0 && <p className="border-t py-2 text-sm text-muted-foreground">Nobody has entered yet.</p>}
            <AddEntry c={c} />
          </section>
        ))}
      </div>
    </div>
  );
}
