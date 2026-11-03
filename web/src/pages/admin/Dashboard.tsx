import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { ApiError, api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Link } from "react-router-dom";
import { SubjectBadge } from "@/components/ui/badge";
import { checkinState, inWords } from "@/lib/checkin";
import { fmtDateTime } from "@/lib/format";
import type { Event, StudentHit } from "@/lib/types";
import { FormError, SaveButton } from "./shared";

interface ImportReport {
  read: number;
  added: number;
  existing: number;
  classFilled: number;
  skipped: number;
}

/** Load the school's student list (students.db or a CSV). It checks the file first and shows counts, never names. */
function LoadStudents() {
  const qc = useQueryClient();
  const picker = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportReport | null>(null);
  const [done, setDone] = useState<ImportReport | null>(null);
  const send = async (f: File, dryRun: boolean) => {
    const res = await fetch(`/api/admin/students/import${dryRun ? "?dryRun=1" : ""}`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: f, credentials: "same-origin" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, data.code ?? "error", data.error ?? "Could not read that file.");
    return data as ImportReport;
  };
  const check = useMutation({ mutationFn: (f: File) => send(f, true), onSuccess: (r) => { setPreview(r); setDone(null); } });
  const load = useMutation({
    mutationFn: (f: File) => send(f, false),
    onSuccess: (r) => { setDone(r); setPreview(null); setFile(null); qc.invalidateQueries({ queryKey: ["admin-stats"] }); qc.invalidateQueries({ queryKey: ["admin-students"] }); },
  });
  return (
    <section className="space-y-2 rounded-lg bg-card p-4 shadow-sm">
      <b>Load the school's student list</b>
      <p className="text-sm text-muted-foreground">
        So teachers can find students who have not signed in yet (to check them in, enter them in a competition or give an award). Choose the school's
        <code> students.db</code> or a CSV with the columns <code>id,name,class</code>. Nothing is overwritten and no login codes are made; it is safe to load again.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" onClick={() => picker.current?.click()}>
          {file ? "Choose another file" : "Choose a file…"}
        </Button>
        <input
          ref={picker}
          type="file"
          aria-label="Student list file"
          hidden
          accept=".db,.csv,.sqlite,application/x-sqlite3,text/csv"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            e.target.value = ""; // so choosing the same file again (after fixing it, or to re-check) fires another change
            setFile(f);
            setPreview(null);
            setDone(null);
            check.reset();
            load.reset();
            if (f) check.mutate(f);
          }}
        />
        {file && <span className="text-sm text-muted-foreground">{file.name}</span>}
        {check.isPending && <span className="text-sm text-muted-foreground">Checking…</span>}
      </div>
      <FormError error={check.error ?? load.error} />
      {preview && file && (
        <div role="status" className="space-y-2 text-sm">
          <p>
            Found <b>{preview.read}</b> students: <b>{preview.added}</b> would be added, {preview.existing} already have an account
            {preview.classFilled > 0 && <>, {preview.classFilled} would get a class</>}
            {preview.skipped > 0 && <>, <span className="text-red-700">{preview.skipped} cannot be used (no id or name)</span></>}.
          </p>
          <SaveButton pending={load.isPending} pendingText="Loading…" onClick={() => load.mutate(file)} disabled={preview.added + preview.classFilled === 0}>
            {preview.added + preview.classFilled === 0 ? "Nothing new to load" : `Load ${preview.added} students`}
          </SaveButton>
        </div>
      )}
      {done && (
        <p role="status" className="text-sm text-emerald-700">
          Loaded: {done.added} added, {done.existing} already had an account{done.classFilled > 0 ? `, ${done.classFilled} got a class` : ""}.
        </p>
      )}
    </section>
  );
}

/** For the one admin allowed to test the app as a student: pick a student and look through their eyes. */
function ViewAsStudent() {
  const [text, setText] = useState("");
  const term = text.trim();
  const hits = useQuery({
    queryKey: ["admin-students", term],
    queryFn: () => api.get<{ id: number; name: string; className: string }[]>(`/api/admin/students?q=${encodeURIComponent(term)}`),
    enabled: term.length >= 2,
    placeholderData: (prev) => prev,
  });
  const start = useMutation({
    mutationFn: (userId: number) => api.post("/api/admin/impersonate", { userId }),
    onSuccess: () => window.location.assign("/"), // a full reload: the whole app starts again as that student
  });
  return (
    <section className="space-y-2 rounded-lg bg-card p-4 shadow-sm">
      <b>View the app as a student</b>
      <p className="text-sm text-muted-foreground">
        To test what a student sees and does: check-in, sign-up, competitions, awards. A yellow bar stays on screen with an <b>Exit</b> button. It lasts an hour.
        What you do is recorded as that student, so on the real server use a test student rather than a real one.
      </p>
      <Input type="search" name="viewas" autoComplete="off" placeholder="Search students by name, class or email…" value={text} onChange={(e) => setText(e.target.value)} />
      <FormError error={start.error} />
      {term.length >= 2 && hits.data && (
        <ul className="divide-y rounded-md border" aria-label="Students to view as">
          {hits.data.length === 0 && <li className="p-2 text-sm text-muted-foreground">No student matches “{term}”.</li>}
          {hits.data.map((h) => (
            <li key={h.id} className="flex items-center justify-between gap-2 p-2 text-sm">
              <span>{h.name} <span className="text-muted-foreground">{h.className}</span></span>
              <Button size="sm" variant="outline" disabled={start.isPending} onClick={() => start.mutate(h.id)}>View as</Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The next events, with the two things a teacher needs on the day one tap away. */
function Today() {
  const q = useQuery({ queryKey: ["admin-events"], queryFn: () => api.get<Event[]>("/api/admin/events") });
  if (!q.data) return null;
  const now = Date.now();
  const next = q.data.filter((e) => new Date(e.endsAt).getTime() >= now).slice(0, 3);
  if (next.length === 0) {
    return (
      <section className="rounded-lg bg-card p-4 shadow-sm">
        <h2 className="font-semibold">Events</h2>
        <p className="text-sm text-muted-foreground">No upcoming events yet. <Link to="/admin/events/new" className="underline">Create the first one</Link>.</p>
      </section>
    );
  }
  return (
    <section className="space-y-2" aria-label="Next events">
      <h2 className="font-semibold">Next events</h2>
      <div className="grid gap-2 lg:grid-cols-2">
        {next.map((e) => {
          const c = checkinState(e.startsAt, e.endsAt, now);
          return (
            <div key={e.id} className="space-y-2 rounded-lg bg-card p-3 shadow-sm">
              <div>
                <SubjectBadge subject={e.subject} />
                <b>{e.title}</b>
                <div className="text-sm text-muted-foreground">{fmtDateTime(e.startsAt)}{e.venue && ` · ${e.venue}`}</div>
              </div>
              <p className={`text-sm ${c.state === "open" ? "font-medium text-emerald-700" : "text-muted-foreground"}`}>
                {c.state === "open" ? "✅ Check-in is open now" : `Check-in opens ${inWords(c.opensAt, now)} (${fmtDateTime(c.opensAt.toISOString())})`}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm"><Link to={`/admin/events/${e.id}/display`}>Show check-in QR</Link></Button>
                <Button asChild size="sm" variant="outline"><Link to={`/admin/events/${e.id}`}>Check people in</Link></Button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function TaskCard({ to, title, text, note }: { to: string; title: string; text: string; note?: string }) {
  return (
    <Link to={to} className="block rounded-lg bg-card p-4 shadow-sm hover:bg-accent">
      <div className="font-semibold">{title}</div>
      <div className="text-sm text-muted-foreground">{text}</div>
      {note && <div className="mt-1 text-xs text-emerald-700">{note}</div>}
    </Link>
  );
}

interface MergeReport {
  moved: Record<string, number>;
  duplicate: Record<string, number>;
}
const THINGS: [string, string, string][] = [
  ["checkins", "check-in", "check-ins"],
  ["event_signups", "sign-up", "sign-ups"],
  ["competition_entries", "competition entry", "competition entries"],
  ["exhibit_visits", "exhibit visit", "exhibit visits"],
  ["student_awards", "award", "awards"],
];

/** Choose one student from a search. Shows the address too, because duplicates often have the same name. */
function PickStudent({ label, chosen, onChoose }: { label: string; chosen: StudentHit | null; onChoose: (s: StudentHit | null) => void }) {
  const [text, setText] = useState("");
  const term = text.trim();
  const hits = useQuery({
    queryKey: ["admin-students", term],
    queryFn: () => api.get<StudentHit[]>(`/api/admin/students?q=${encodeURIComponent(term)}`),
    enabled: term.length >= 2 && !chosen,
    placeholderData: (prev) => prev,
  });
  return (
    <div className="space-y-1 text-sm">
      <span className="block font-medium">{label}</span>
      {chosen ? (
        <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/40 p-2">
          <span>{chosen.name} <span className="text-muted-foreground">{chosen.className} · {chosen.email}</span></span>
          <button type="button" className="underline" onClick={() => { onChoose(null); setText(""); }}>Change</button>
        </div>
      ) : (
        <>
          <Input type="search" aria-label={label} autoComplete="off" placeholder="Search by name or address…" value={text} onChange={(e) => setText(e.target.value)} />
          {term.length >= 2 && hits.data && (
            <ul className="divide-y rounded-md border bg-card" aria-label={`${label}: results`}>
              {hits.data.length === 0 && <li className="p-2 text-muted-foreground">No student matches “{term}”.</li>}
              {hits.data.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-2 p-2">
                  <span>{h.name} <span className="text-muted-foreground">{h.className} · {h.email}</span></span>
                  <Button type="button" size="sm" variant="outline" onClick={() => onChoose(h)}>Choose</Button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/**
 * For a student who ended up with two accounts (for example the record loaded from the school's list, and the account made
 * when they first signed in). Everything recorded on the old record moves to the real account, and the real account's name stays.
 */
function MergeDuplicates() {
  const qc = useQueryClient();
  const [keep, setKeep] = useState<StudentHit | null>(null);
  const [drop, setDrop] = useState<StudentHit | null>(null);
  const [done, setDone] = useState(false);
  const ready = keep && drop && keep.id !== drop.id;
  const preview = useQuery({
    queryKey: ["merge-preview", keep?.id, drop?.id],
    queryFn: () => api.post<MergeReport>("/api/admin/users/merge", { keepId: keep!.id, dropId: drop!.id, dryRun: true }),
    enabled: !!ready,
    retry: false,
    gcTime: 0,
  });
  const merge = useMutation({
    mutationFn: () => api.post<MergeReport>("/api/admin/users/merge", { keepId: keep!.id, dropId: drop!.id }),
    onSuccess: () => { setDone(true); setKeep(null); setDrop(null); qc.invalidateQueries(); },
  });
  const list = (r: Record<string, number>) => THINGS.filter(([k]) => r[k] > 0).map(([k, one, many]) => `${r[k]} ${r[k] === 1 ? one : many}`).join(", ");
  return (
    <section className="space-y-3 rounded-lg bg-card p-4 shadow-sm">
      <b>Merge a student's two accounts</b>
      <p className="text-sm text-muted-foreground">
        Use this when one student appears twice: the record loaded from the school's list, and the account made when they signed in. Everything recorded on the old
        record (check-ins, sign-ups, results, awards) moves to the real account, which keeps its name. It also stops a re-import from bringing the old record back.
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        <PickStudent label="The real account (the one they sign in with)" chosen={keep} onChoose={(s) => { setKeep(s); setDone(false); merge.reset(); }} />
        <PickStudent label="The old record to replace" chosen={drop} onChoose={(s) => { setDrop(s); setDone(false); merge.reset(); }} />
      </div>
      {keep && drop && keep.id === drop.id && <p role="alert" className="text-sm text-red-700">Choose two different accounts.</p>}
      <FormError error={preview.error ?? merge.error} />
      {ready && preview.data && (
        <div role="status" className="space-y-2 text-sm">
          <p>
            <b>{drop.name}</b> ({drop.email}) will be replaced by <b>{keep.name}</b> ({keep.email}).{" "}
            {list(preview.data.moved) ? <>Moving over: {list(preview.data.moved)}.</> : <>There is nothing recorded on the old record.</>}{" "}
            {list(preview.data.duplicate) && <>Already on both, so not counted twice: {list(preview.data.duplicate)}.</>} The address {drop.email} will lead to {keep.name} from now on.
            This cannot be undone.
          </p>
          <SaveButton pending={merge.isPending} pendingText="Merging…" onClick={() => merge.mutate()} type="button">Merge these two accounts</SaveButton>
        </div>
      )}
      {done && <p role="status" className="text-sm text-emerald-700">Merged. The old record is gone and its history is on the real account.</p>}
    </section>
  );
}

export default function Dashboard() {
  const { me } = useAuth();
  const q = useQuery({ queryKey: ["admin-stats"], queryFn: () => api.get<{ events: number; checkins: number; users: number; exhibits: number }>("/api/admin/stats") });
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("teacher");
  const set = useMutation({ mutationFn: () => api.post("/api/admin/users/role", { email, role }) });
  const s = q.data;
  const n = (count: number | undefined, one: string, many: string) => (count ? `${count} ${count === 1 ? one : many} so far` : undefined);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Teacher portal</h1>
        <p className="text-sm text-muted-foreground">Welcome{me ? `, ${me.name}` : ""}. Pick what you want to do. New here? <Link to="/admin/help" className="underline">Read the short guide</Link>.</p>
      </div>

      <Today />

      <section className="space-y-2" aria-label="What would you like to do?">
        <h2 className="font-semibold">What would you like to do?</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <TaskCard to="/admin/events/new" title="Set up an event" text="Date, place, description and a picture. Optionally sign-up and a competition." note={n(s?.events, "event", "events")} />
          <TaskCard to="/admin/exhibits" title="Add exhibits" text="One page and a printable QR sign for each installation, grouped into exhibitions." note={n(s?.exhibits, "exhibit", "exhibits")} />
          <TaskCard to="/admin/competitions" title="Record competition results" text="Scores, ranks and who is in each competition." />
          <TaskCard to="/admin/awards" title="Give awards" text="Choose students, write a reason, then publish when you are ready." />
          <TaskCard to="/admin/events" title="See all events" text="Edit, copy or delete an event, and see who came." />
          <TaskCard to="/admin/help" title="How does it work?" text="A short guide for the day of an event, with answers to common questions." />
        </div>
      </section>

      {s && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(
            [["Events", s.events], ["Check-ins", s.checkins], ["Users", s.users], ["Exhibits", s.exhibits]] as const
          ).map(([l, c]) => (
            <Card key={l} className="p-4 text-center">
              <div className="text-3xl font-bold">{c}</div>
              {l}
            </Card>
          ))}
        </div>
      )}
      {me?.canImpersonate && <ViewAsStudent />}
      {me?.role === "admin" && <LoadStudents />}
      {me?.role === "admin" && <MergeDuplicates />}
      {me?.role === "admin" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            set.mutate();
          }}
          className="flex flex-wrap gap-2 rounded-lg bg-card p-4 shadow-sm"
        >
          <b className="w-full">Set a user&apos;s role</b>
          <p className="w-full text-sm text-muted-foreground">Make someone a teacher (can use this portal) or an admin (can also change roles and load the student list).</p>
          <Input name="email" type="email" placeholder="user email" required className="w-auto" value={email} onChange={(e) => { setEmail(e.target.value); set.reset(); }} />
          <Select name="role" className="w-auto" value={role} onChange={(e) => { setRole(e.target.value); set.reset(); }}>
            <option>student</option>
            <option>teacher</option>
            <option>admin</option>
          </Select>
          <SaveButton pending={set.isPending} dirty={set.isSuccess ? false : undefined} saved={set.isSuccess}>Save</SaveButton>
          <FormError error={set.error} />
        </form>
      )}
    </div>
  );
}
