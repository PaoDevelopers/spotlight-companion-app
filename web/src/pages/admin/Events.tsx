import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SubjectBadge } from "@/components/ui/badge";
import { QrImage } from "@/components/QrImage";
import { Scanner } from "@/components/Scanner";
import { api } from "@/lib/api";
import { fmtDateTime, fmtLongDateTime } from "@/lib/format";
import type { Attendee, Event, ScanResult, Signup, StudentHit } from "@/lib/types";
import { FormError, panel } from "./shared";

export function AdminEvents() {
  const q = useQuery({ queryKey: ["admin-events"], queryFn: () => api.get<Event[]>("/api/admin/events") });
  const now = Date.now();
  const upcoming = q.data?.filter((e) => new Date(e.endsAt).getTime() >= now) ?? [];
  const past = (q.data?.filter((e) => new Date(e.endsAt).getTime() < now) ?? []).reverse();
  const row = (e: Event) => (
    <Link key={e.id} to={`/admin/events/${e.id}`} className="flex items-center gap-3 rounded-lg bg-card p-3 shadow-sm hover:bg-accent">
      {e.imageUrl ? <img src={e.imageUrl} alt="" className="size-12 rounded object-cover" /> : <div className="size-12 rounded bg-muted" aria-hidden />}
      <div className="min-w-0 flex-1">
        <div className="truncate">
          <SubjectBadge subject={e.subject} />
          <b>{e.title}</b>
        </div>
        <div className="text-sm text-muted-foreground">
          {fmtDateTime(e.startsAt)}
          {e.venue && ` · ${e.venue}`}
        </div>
      </div>
      <div className="text-right text-sm text-muted-foreground">
        {e.signupEnabled ? `${e.signupCount}${e.capacity ? ` / ${e.capacity}` : ""} signed up` : "no sign-up"}
      </div>
    </Link>
  );
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Events</h1>
        <Button asChild><Link to="/admin/events/new">New event</Link></Button>
      </div>
      {q.data && q.data.length === 0 && <p className="text-muted-foreground">No events yet. Create the first one.</p>}
      {upcoming.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-semibold">Upcoming and happening now</h2>
          <div className="grid gap-2 lg:grid-cols-2">{upcoming.map(row)}</div>
        </section>
      )}
      {past.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-semibold text-muted-foreground">Past</h2>
          <div className="grid gap-2 lg:grid-cols-2">{past.map(row)}</div>
        </section>
      )}
    </div>
  );
}

interface AdminEventView {
  event: Event;
  attendees: Attendee[];
  signups: Signup[];
  tagToken: string;
  tagUrl: string;
}

/** Find a student by name, class or email and check them in or sign them up: for anyone who has no phone with them. */
function StudentDesk({ eventId, signedUp, arrived, onChange }: { eventId: string; signedUp: Set<number>; arrived: Set<number>; onChange: () => void }) {
  const [text, setText] = useState("");
  const term = text.trim();
  const hits = useQuery({
    queryKey: ["admin-students", term],
    queryFn: () => api.get<StudentHit[]>(`/api/admin/students?q=${encodeURIComponent(term)}`),
    enabled: term.length >= 2,
    placeholderData: (prev) => prev,
  });
  const checkIn = useMutation({ mutationFn: (userId: number) => api.post(`/api/admin/events/${eventId}/attendees`, { userId }), onSuccess: () => { onChange(); setText(""); } });
  const signUp = useMutation({ mutationFn: (userId: number) => api.post(`/api/admin/events/${eventId}/signups`, { userId }), onSuccess: onChange });
  return (
    <section className={panel}>
      <h2 className="font-semibold">Student has no phone?</h2>
      <p className="mb-2 text-sm text-muted-foreground">Search by name, class or email. Check them in on the spot, or sign them up beforehand.</p>
      <Input type="search" name="search" autoComplete="off" placeholder="Search students…" value={text} onChange={(e) => setText(e.target.value)} />
      <FormError error={checkIn.error ?? signUp.error} />
      {term.length >= 2 && hits.data && (
        <ul className="mt-2 divide-y" aria-label="Search results">
          {hits.data.length === 0 && <li className="py-2 text-sm text-muted-foreground">No student matches “{term}”.</li>}
          {hits.data.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                {h.name} <span className="text-sm text-muted-foreground">{h.className}</span>
              </span>
              <span className="flex gap-2">
                {arrived.has(h.id) ? (
                  <span className="text-sm text-emerald-700">✓ Checked in</span>
                ) : (
                  <Button size="sm" disabled={checkIn.isPending} onClick={() => checkIn.mutate(h.id)}>Check in</Button>
                )}
                {!arrived.has(h.id) && !signedUp.has(h.id) && (
                  <Button size="sm" variant="outline" disabled={signUp.isPending} onClick={() => signUp.mutate(h.id)}>Sign up</Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function AdminEventDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin-event", id], queryFn: () => api.get<AdminEventView>(`/api/admin/events/${id}`), refetchInterval: 10_000 });
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-event", id] });
  const checkIn = useMutation({ mutationFn: (userId: number) => api.post(`/api/admin/events/${id}/attendees`, { userId }), onSuccess: refresh });
  const undo = useMutation({ mutationFn: (userId: number) => api.del(`/api/admin/events/${id}/attendees/${userId}`), onSuccess: refresh });
  const drop = useMutation({ mutationFn: (userId: number) => api.del(`/api/admin/events/${id}/signups/${userId}`), onSuccess: refresh });
  const del = useMutation({
    mutationFn: () => api.del(`/api/admin/events/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-events"] }); navigate("/admin/events", { replace: true }); },
  });
  if (q.isError) return <p>Event not found.</p>;
  if (!q.data) return null;
  const { event: e, attendees, signups, tagUrl } = q.data;
  const waiting = signups.filter((s) => !s.checkedIn);
  const arrivedIds = new Set(attendees.map((a) => a.userId));
  const signedIds = new Set(signups.map((s) => s.userId));
  const stat = (label: string, value: string) => (
    <div className="rounded-lg bg-card p-3 text-center shadow-sm">
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        {e.imageUrl && <img src={e.imageUrl} alt="" className="h-32 w-full rounded-lg object-cover" />}
        <div>
          <SubjectBadge subject={e.subject} />
          <h1 className="inline text-2xl font-bold">{e.title}</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          {fmtLongDateTime(e.startsAt)}
          {e.venue && ` · ${e.venue}`}
          {e.host && ` · hosted by ${e.host}`}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button asChild><Link to={`/admin/events/${id}/display`}>Display check-in QR</Link></Button>
          <Button asChild variant="outline"><Link to={`/admin/events/${id}/scan`}>Scan student passes</Link></Button>
          <Button asChild variant="outline"><Link to={`/admin/events/${id}/edit`}>Edit event</Link></Button>
          <Button asChild variant="outline"><Link to={`/admin/events/new?from=${id}`}>Duplicate</Link></Button>
        </div>
      </header>

      <div className="grid grid-cols-3 gap-3">
        {stat("Signed up", e.capacity ? `${signups.length} / ${e.capacity}` : String(signups.length))}
        {stat("Here now", e.capacity ? `${attendees.length} / ${e.capacity}` : String(attendees.length))}
        {stat("Still expected", String(waiting.length))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <div className="space-y-6">
      <StudentDesk eventId={id!} signedUp={signedIds} arrived={arrivedIds} onChange={refresh} />

      <section className={panel}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Signed up, not here yet ({waiting.length})</h2>
          <Button asChild size="sm" variant="outline"><Link to={`/admin/events/${id}/sheet`}>Print sign-in sheet</Link></Button>
        </div>
        <FormError error={checkIn.error ?? drop.error} />
        {waiting.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{signups.length === 0 ? "Nobody has signed up." : "Everyone who signed up has arrived."}</p>
        ) : (
          <ul className="divide-y">
            {waiting.map((s) => (
              <li key={s.userId} className="flex items-center justify-between gap-2 py-2">
                <span>
                  {s.name} <span className="text-sm text-muted-foreground">{s.className}</span>
                </span>
                <span className="flex items-center gap-3">
                  <Button size="sm" disabled={checkIn.isPending} onClick={() => checkIn.mutate(s.userId)}>Check in</Button>
                  <button className="text-sm text-red-700 underline" onClick={() => drop.mutate(s.userId)}>Remove</button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

        </div>
        <div className="space-y-6">
      <section className={panel}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Checked in ({attendees.length}{e.capacity ? ` / ${e.capacity}` : ""})</h2>
          <Button asChild size="sm" variant="outline"><a href={`/api/admin/events/${id}/attendees.csv`}>Export CSV</a></Button>
        </div>
        <ul className="divide-y">
          {attendees.map((a) => (
            <li key={a.userId} className="flex items-center justify-between py-1">
              <span>{a.name} <span className="text-sm text-muted-foreground">{a.className} · {a.method}{!signedIds.has(a.userId) && " · walk-in"}</span></span>
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
        </div>
      </div>

      <button
        className="text-red-700 underline"
        onClick={() => { if (window.confirm(`Delete “${e.title}” and its check-ins, sign-ups and competitions? This cannot be undone.`)) del.mutate(); }}
        disabled={del.isPending}
      >
        Delete event
      </button>
    </div>
  );
}

/** A paper sheet for the door: everyone signed up, a box to tick, and blank lines for walk-ins. Then tick them off in the desk. */
export function AdminSheet() {
  const { id } = useParams();
  const q = useQuery({ queryKey: ["admin-event", id], queryFn: () => api.get<AdminEventView>(`/api/admin/events/${id}`) });
  if (!q.data) return null;
  const { event: e, signups } = q.data;
  return (
    <div className="space-y-3">
      <div className="no-print flex gap-2">
        <Button onClick={() => window.print()}>Print</Button>
        <Button asChild variant="outline"><Link to={`/admin/events/${id}`}>Back</Link></Button>
      </div>
      <h1 className="text-2xl font-bold">{e.title}: sign-in sheet</h1>
      <p>{fmtLongDateTime(e.startsAt)}{e.venue && ` · ${e.venue}`}</p>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 text-left">
            <th className="w-10 py-1">Here</th><th>Name</th><th>Class</th>
          </tr>
        </thead>
        <tbody>
          {signups.map((s) => (
            <tr key={s.userId} className="border-b">
              <td className="py-2"><span className="inline-block size-5 border-2 border-black align-middle" />{s.checkedIn && " ✓"}</td>
              <td>{s.name}</td>
              <td>{s.className}</td>
            </tr>
          ))}
          {Array.from({ length: 8 }, (_, i) => (
            <tr key={`blank${i}`} className="border-b">
              <td className="py-3"><span className="inline-block size-5 border-2 border-black align-middle" /></td>
              <td className="text-muted-foreground">{i === 0 ? "Walk-ins (write name and class)" : ""}</td>
              <td />
            </tr>
          ))}
        </tbody>
      </table>
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
