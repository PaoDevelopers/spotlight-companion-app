import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SubjectBadge } from "@/components/ui/badge";
import { Prose } from "@/components/Prose";
import { api, errorMessage } from "@/lib/api";
import { fmtDateTime, fmtLongDateTime } from "@/lib/format";
import { SUBJECTS } from "@/lib/subjects";
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
        {[["", "All"], ...SUBJECTS.filter(([v]) => v !== "both")].map(([v, l]) => (
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
            {fmtDateTime(e.startsAt)}
            {e.venue && ` · ${e.venue}`}
          </div>
        </Link>
      ))}
    </div>
  );
}

interface EventView {
  event: Event;
  checkedIn: boolean;
  signedUp: boolean;
  competitions: { id: number; name: string; isTeam: boolean; myStatus: string | null }[];
}

export function EventDetail() {
  const { id } = useParams();
  const q = useQuery({ queryKey: ["event", id], queryFn: () => api.get<EventView>(`/api/events/${id}`) });
  if (q.isError) return <p>Event not found.</p>;
  if (!q.data) return null;
  const { event: e, checkedIn, signedUp, competitions } = q.data;
  return (
    <article className="space-y-3">
      {e.imageUrl && <img src={e.imageUrl} alt="" className="h-44 w-full rounded-lg object-cover" onError={(ev) => (ev.currentTarget.style.display = "none")} />}
      <h1 className="text-2xl font-bold">{e.title}</h1>
      <p className="text-muted-foreground">
        {fmtLongDateTime(e.startsAt)}
        {e.venue && ` · ${e.venue}`}
      </p>
      {e.host && <p className="text-sm">Hosted by {e.host}</p>}
      {e.description && <Prose>{e.description}</Prose>}
      <SignupBox event={e} signedUp={signedUp} checkedIn={checkedIn} />
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

/** Reserve a place ahead of time. A student without a phone on the day is still found on the teacher's list. */
function SignupBox({ event: e, signedUp, checkedIn }: { event: Event; signedUp: boolean; checkedIn: boolean }) {
  const qc = useQueryClient();
  const done = () => Promise.all([qc.invalidateQueries({ queryKey: ["event", String(e.id)] }), qc.invalidateQueries({ queryKey: ["events"] })]);
  const join = useMutation({ mutationFn: () => api.put(`/api/events/${e.id}/signup`, {}), onSuccess: done });
  const leave = useMutation({ mutationFn: () => api.del(`/api/events/${e.id}/signup`), onSuccess: done });
  if (checkedIn || !e.signupEnabled) return null;
  const over = new Date(e.endsAt).getTime() < Date.now();
  const left = e.capacity ? Math.max(0, e.capacity - e.signupCount) : null;
  if (signedUp) {
    return (
      <div className="space-y-2 rounded-lg bg-emerald-100 p-3">
        <div>✅ You're signed up. Your place is saved.</div>
        <p className="text-sm">Forgot or don't have your phone? Just give your name to the teacher at the door: you're on their list.</p>
        {leave.isError && <p role="alert" className="text-red-700">{errorMessage(leave.error)}</p>}
        {!over && <Button variant="outline" size="sm" disabled={leave.isPending} onClick={() => leave.mutate()}>Cancel my sign-up</Button>}
      </div>
    );
  }
  if (over) return null;
  return (
    <div className="space-y-2 rounded-lg bg-card p-3 shadow-sm">
      <div className="font-semibold">{left === null ? "Sign up for this event" : left > 0 ? `${left} ${left === 1 ? "place" : "places"} left` : "Sign-up is full"}</div>
      {join.isError && <p role="alert" className="text-red-700">{errorMessage(join.error)}</p>}
      <Button disabled={join.isPending || left === 0} onClick={() => join.mutate()}>Sign up</Button>
    </div>
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
