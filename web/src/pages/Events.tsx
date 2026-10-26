import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SubjectBadge } from "@/components/ui/badge";
import { api, errorMessage } from "@/lib/api";
import { fmtDateTime, fmtLongDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Event } from "@/lib/types";

export function Events() {
  const [params] = useSearchParams();
  const subject = params.get("subject") ?? "";
  const q = useQuery({ queryKey: ["events", subject], queryFn: () => api.get<Event[]>(`/api/events${subject ? `?subject=${subject}` : ""}`) });
  return (
    <div>
      <h1 className="mb-3 text-2xl font-bold">Events</h1>
      <div className="mb-4 flex gap-2 text-sm">
        {[["", "All"], ["physics", "Physics"], ["cs", "CS"]].map(([v, l]) => (
          <Link key={v} to={v ? `/events?subject=${v}` : "/events"} className={cn("rounded-full border px-3 py-1", subject === v ? "bg-primary text-primary-foreground" : "bg-card")}>
            {l}
          </Link>
        ))}
      </div>
      {q.data?.map((e) => (
        <Link key={e.id} to={`/events/${e.id}`} className="mb-2 block rounded-lg bg-card p-3 shadow-sm">
          <SubjectBadge subject={e.subject} />
          <span className="font-semibold">{e.title}</span>
          <div className="text-sm text-muted-foreground">
            {fmtDateTime(e.startsAt)} · {e.venue}
          </div>
        </Link>
      ))}
    </div>
  );
}

interface EventView {
  event: Event;
  checkedIn: boolean;
  competitions: { id: number; name: string; isTeam: boolean; myStatus: string | null }[];
}

export function EventDetail() {
  const { id } = useParams();
  const q = useQuery({ queryKey: ["event", id], queryFn: () => api.get<EventView>(`/api/events/${id}`) });
  if (q.isError) return <p>Event not found.</p>;
  if (!q.data) return null;
  const { event: e, checkedIn, competitions } = q.data;
  return (
    <article className="space-y-3">
      <h1 className="text-2xl font-bold">{e.title}</h1>
      <p className="text-muted-foreground">
        {fmtLongDateTime(e.startsAt)} · {e.venue}
      </p>
      <p>{e.description}</p>
      <div className={cn("rounded-lg p-3", checkedIn ? "bg-emerald-100" : "bg-card shadow-sm")}>
        {checkedIn ? "✅ You're checked in" : "Scan the QR at the venue (Scan tab) or tap the NFC tag to check in."}
      </div>
      {competitions.map((c) =>
        c.myStatus ? (
          <div key={c.id} className="rounded-lg bg-emerald-100 p-3">
            ✅ Registered for {c.name} · <b>{c.myStatus}</b>
          </div>
        ) : (
          <RegisterForm key={c.id} id={c.id} name={c.name} isTeam={c.isTeam} eventId={e.id} />
        ),
      )}
    </article>
  );
}

function RegisterForm({ id, name, isTeam, eventId }: { id: number; name: string; isTeam: boolean; eventId: number }) {
  const qc = useQueryClient();
  const [team, setTeam] = useState("");
  const m = useMutation({
    mutationFn: () => api.post(`/api/competitions/${id}/register`, { team }),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ["event", String(eventId)] }), qc.invalidateQueries({ queryKey: ["home"] })]),
  });
  return (
    <form
      onSubmit={(ev) => {
        ev.preventDefault();
        m.mutate();
      }}
      className="space-y-2 rounded-lg bg-card p-3 shadow-sm"
    >
      <div className="font-semibold">Competition: {name}</div>
      {isTeam && <Input value={team} onChange={(e) => setTeam(e.target.value)} placeholder="Team name" />}
      {m.isError && <p role="alert" className="text-red-700">{errorMessage(m.error)}</p>}
      <Button disabled={m.isPending}>Register</Button>
    </form>
  );
}
