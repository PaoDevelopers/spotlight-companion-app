import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { QrImage } from "@/components/QrImage";
import { Scanner } from "@/components/Scanner";
import { api } from "@/lib/api";
import { fmtDateTime, fromLocalInput, toLocalInput } from "@/lib/format";
import type { Attendee, Event, ScanResult } from "@/lib/types";
import { FormError, SaveButton, panel } from "./shared";

function EventForm({ event, label, onSaved }: { event?: Event; label: string; onSaved?: (e: Event) => void }) {
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (body: object) => (event ? api.put<Event>(`/api/admin/events/${event.id}`, body) : api.post<Event>("/api/admin/events", body)),
    onSuccess: (e) => {
      qc.invalidateQueries({ queryKey: ["admin-events"] });
      qc.invalidateQueries({ queryKey: ["admin-event"] });
      onSaved?.(e);
    },
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const cap = String(f.get("capacity") ?? "").trim();
    save.mutate({
      title: String(f.get("title")), subject: String(f.get("subject")), venue: String(f.get("venue")), description: String(f.get("description")),
      startsAt: fromLocalInput(String(f.get("startsAt"))), endsAt: fromLocalInput(String(f.get("endsAt"))), capacity: cap ? Number(cap) : null,
    });
    if (!event) e.currentTarget.reset();
  }
  return (
    <form onSubmit={submit} className={`${panel} grid gap-2 sm:grid-cols-2`}>
      <Input name="title" required placeholder="Title" defaultValue={event?.title} className="sm:col-span-2" />
      <Select name="subject" defaultValue={event?.subject ?? "both"}>
        <option value="physics">Physics</option>
        <option value="cs">CS</option>
        <option value="both">Both</option>
      </Select>
      <Input name="venue" placeholder="Venue" defaultValue={event?.venue ?? ""} />
      <label className="text-sm">
        Starts
        <Input name="startsAt" type="datetime-local" required defaultValue={toLocalInput(event?.startsAt)} />
      </label>
      <label className="text-sm">
        Ends
        <Input name="endsAt" type="datetime-local" required defaultValue={toLocalInput(event?.endsAt)} />
      </label>
      <Input name="capacity" type="number" min="1" placeholder="Capacity (optional)" defaultValue={event?.capacity ?? ""} />
      <Textarea name="description" placeholder="Description" defaultValue={event?.description} className="sm:col-span-2" />
      <FormError error={save.error} />
      <SaveButton pending={save.isPending} className="sm:col-span-2">
        {label}
      </SaveButton>
    </form>
  );
}

export function AdminEvents() {
  const q = useQuery({ queryKey: ["admin-events"], queryFn: () => api.get<Event[]>("/api/admin/events") });
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Events</h1>
      <EventForm label="Create event" />
      {q.data?.map((e) => (
        <Link key={e.id} to={`/admin/events/${e.id}`} className="block rounded-lg bg-card p-3 shadow-sm">
          <b>{e.title}</b> <span className="text-sm text-muted-foreground">{fmtDateTime(e.startsAt)}</span>
        </Link>
      ))}
    </div>
  );
}

interface AdminEventView {
  event: Event;
  attendees: Attendee[];
  tagToken: string;
  tagUrl: string;
}

export function AdminEventDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin-event", id], queryFn: () => api.get<AdminEventView>(`/api/admin/events/${id}`), refetchInterval: 10_000 });
  const [email, setEmail] = useState("");
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-event", id] });
  const add = useMutation({ mutationFn: () => api.post(`/api/admin/events/${id}/attendees`, { email }), onSuccess: () => { setEmail(""); refresh(); } });
  const undo = useMutation({ mutationFn: (userId: number) => api.del(`/api/admin/events/${id}/attendees/${userId}`), onSuccess: refresh });
  const del = useMutation({
    mutationFn: () => api.del(`/api/admin/events/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-events"] }); navigate("/admin/events", { replace: true }); },
  });
  if (q.isError) return <p>Event not found.</p>;
  if (!q.data) return null;
  const { event: e, attendees, tagUrl } = q.data;
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{e.title}</h1>
      <div className="flex flex-wrap gap-3">
        <Button asChild><Link to={`/admin/events/${id}/display`}>Display check-in QR</Link></Button>
        <Button asChild variant="outline"><Link to={`/admin/events/${id}/scan`}>Scan student passes</Link></Button>
        <Button asChild variant="outline"><a href={`/api/admin/events/${id}/attendees.csv`}>Export CSV</a></Button>
      </div>
      <section className={panel}>
        <h2 className="font-semibold">
          Attendees ({attendees.length}
          {e.capacity ? ` / ${e.capacity}` : ""})
        </h2>
        <form onSubmit={(ev) => { ev.preventDefault(); add.mutate(); }} className="my-2 flex gap-2">
          <Input type="email" name="email" placeholder="Add by student email" value={email} onChange={(x) => setEmail(x.target.value)} className="flex-1" />
          <Button variant="outline" disabled={add.isPending}>Add</Button>
        </form>
        <FormError error={add.error} />
        <ul className="divide-y">
          {attendees.map((a) => (
            <li key={a.userId} className="flex items-center justify-between py-1">
              <span>{a.name} <span className="text-sm text-muted-foreground">{a.className} · {a.method}</span></span>
              <button className="text-sm text-red-700 underline" onClick={() => undo.mutate(a.userId)}>Undo</button>
            </li>
          ))}
        </ul>
      </section>
      <section className={panel}>
        <h2 className="font-semibold">NFC tag / printable QR</h2>
        <p className="mb-2 break-all text-sm text-muted-foreground">Write this URL to an NFC tag (or print the QR). It is permanent, so only use it at the venue.</p>
        <code className="block break-all text-xs">{tagUrl}</code>
        <div className="mt-2"><QrImage text={tagUrl} size={160} /></div>
      </section>
      <details>
        <summary className="cursor-pointer font-semibold">Edit event</summary>
        <EventForm event={e} label="Save changes" />
      </details>
      <button className="text-red-700 underline" onClick={() => del.mutate()} disabled={del.isPending}>Delete event</button>
    </div>
  );
}

/** Fullscreen rotating QR for a projector. Refreshes every 10 s; each code lasts about a minute. */
export function AdminDisplay() {
  const { id } = useParams();
  const q = useQuery({
    queryKey: ["admin-token", id],
    queryFn: () => api.get<{ token: string; url: string }>(`/api/admin/events/${id}/token`),
    refetchInterval: 10_000,
    gcTime: 0,
  });
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4">
      <h1 className="text-3xl font-bold">Scan to check in</h1>
      {q.data && <QrImage text={q.data.url} size={Math.min(480, window.innerWidth - 48)} />}
      {q.isError && <p role="alert" className="text-red-700">Connection lost, retrying… (the code on screen may expire)</p>}
      <p className="text-muted-foreground">Open the Spotlight app → Scan, or use your phone camera.</p>
    </div>
  );
}

export function AdminScanPasses() {
  const { id } = useParams();
  const [log, setLog] = useState<ScanResult[]>([]);
  const scan = useMutation({
    mutationFn: (token: string) => api.post<ScanResult>(`/api/admin/events/${id}/scan-pass`, { token }),
    onSuccess: (r) => setLog((l) => [r, ...l].slice(0, 8)),
  });
  return (
    <div className="mx-auto max-w-md space-y-3">
      <h1 className="text-2xl font-bold">Scan student passes</h1>
      <Scanner onScan={(t) => scan.mutate(t)} />
      <ul aria-live="polite">
        {log.map((l, i) => (
          <li key={i} className={`mb-1 rounded p-2 ${l.ok ? "bg-emerald-100" : "bg-red-100"}`}>{l.message}</li>
        ))}
      </ul>
    </div>
  );
}
