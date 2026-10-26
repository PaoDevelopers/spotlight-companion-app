import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { Entry, Event } from "@/lib/types";
import { FormError, SaveButton, panel } from "./shared";

const STATUSES = ["registered", "competing", "advanced", "eliminated", "finished"];

interface Data {
  events: Event[];
  competitions: { id: number; eventId: number; name: string; isTeam: boolean; entries: Entry[] }[];
}

function EntryRow({ e }: { e: Entry }) {
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (body: object) => api.put(`/api/admin/entries/${e.id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-competitions"] }),
  });
  const input = "w-auto p-1";
  return (
    <form
      className="mb-2 flex flex-wrap items-center gap-2 border-t pt-2 text-sm"
      onSubmit={(ev) => {
        ev.preventDefault();
        const f = new FormData(ev.currentTarget);
        const num = (k: string) => (String(f.get(k) ?? "") === "" ? null : Number(f.get(k)));
        save.mutate({ status: String(f.get("status")), score: num("score"), rank: num("rank"), notes: String(f.get("notes") ?? "") || null });
      }}
    >
      <span className="w-40">
        {e.teamName ? `${e.teamName} (${e.name})` : e.name} <i className="text-muted-foreground">{e.className}</i>
      </span>
      <Select name="status" defaultValue={e.status} className={input}>
        {STATUSES.map((s) => <option key={s}>{s}</option>)}
      </Select>
      <Input name="score" type="number" defaultValue={e.score ?? ""} placeholder="score" className={`${input} w-20`} />
      <Input name="rank" type="number" min="1" defaultValue={e.rank ?? ""} placeholder="rank" className={`${input} w-16`} />
      <Input name="notes" defaultValue={e.notes ?? ""} placeholder="notes" className={`${input} flex-1`} />
      <SaveButton pending={save.isPending} variant="outline" size="sm">Save</SaveButton>
      <FormError error={save.error} />
    </form>
  );
}

export default function AdminCompetitions() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin-competitions"], queryFn: () => api.get<Data>("/api/admin/competitions") });
  const create = useMutation({
    mutationFn: (body: object) => api.post("/api/admin/competitions", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-competitions"] }),
  });
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Competitions</h1>
      <form
        className={`${panel} flex flex-wrap items-center gap-2`}
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          create.mutate({ name: String(f.get("name")), eventId: Number(f.get("eventId")), isTeam: f.get("isTeam") === "on" });
          e.currentTarget.reset();
        }}
      >
        <Input name="name" required placeholder="Competition name" className="w-auto" />
        <Select name="eventId" className="w-auto">
          {q.data?.events.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
        </Select>
        <label><input type="checkbox" name="isTeam" /> Team</label>
        <Button disabled={create.isPending}>Create</Button>
        <FormError error={create.error} />
      </form>
      {q.data?.competitions.map((c) => (
        <section key={c.id} className={panel}>
          <h2 className="mb-2 font-semibold">{c.name}</h2>
          {c.entries.map((e) => <EntryRow key={`${e.id}-${e.status}-${e.score}-${e.rank}`} e={e} />)}
        </section>
      ))}
    </div>
  );
}
