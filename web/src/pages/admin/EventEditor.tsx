import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SubjectBadge } from "@/components/ui/badge";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import { Prose } from "@/components/Prose";
import { api } from "@/lib/api";
import { fmtLongDateTime, fromLocalInput, toLocalInput } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Event, Subject } from "@/lib/types";
import { FormError, SaveButton, panel } from "./shared";

interface Draft {
  title: string;
  subject: Subject;
  host: string;
  venue: string;
  startsAt: string; // datetime-local value
  endsAt: string;
  capacity: string;
  signupEnabled: boolean;
  imageUrl: string;
  description: string;
}

const EMPTY: Draft = { title: "", subject: "both", host: "", venue: "", startsAt: "", endsAt: "", capacity: "", signupEnabled: true, imageUrl: "", description: "" };

const fromEvent = (e: Event): Draft => ({
  title: e.title, subject: e.subject, host: e.host ?? "", venue: e.venue ?? "", startsAt: toLocalInput(e.startsAt), endsAt: toLocalInput(e.endsAt),
  capacity: e.capacity ? String(e.capacity) : "", signupEnabled: e.signupEnabled, imageUrl: e.imageUrl ?? "", description: e.description,
});

const minutesBetween = (a: string, b: string) => (a && b ? Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000) : 0);
const addMinutes = (local: string, m: number) => (local ? toLocalInput(new Date(new Date(local).getTime() + m * 60000).toISOString()) : "");

const SUBJECTS: [Subject, string][] = [["physics", "Physics"], ["cs", "CS"], ["both", "Both"]];
const DURATIONS: [number, string][] = [[30, "30 min"], [60, "1 h"], [90, "90 min"], [120, "2 h"], [180, "3 h"]];

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className={cn(panel, "space-y-3")}>
      <div>
        <h2 className="font-semibold">{title}</h2>
        {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

const Label = ({ text, children, className }: { text: string; children: ReactNode; className?: string }) => (
  <label className={cn("block text-sm", className)}>
    <span className="mb-1 block font-medium">{text}</span>
    {children}
  </label>
);

/** Create, edit or duplicate (?from=<id>) an event. The right-hand card shows what students will see. */
export function AdminEventEdit() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const sourceId = id ?? params.get("from");
  const navigate = useNavigate();
  const qc = useQueryClient();
  const source = useQuery({ queryKey: ["admin-event", sourceId], queryFn: () => api.get<{ event: Event }>(`/api/admin/events/${sourceId}`), enabled: !!sourceId });
  const [d, setD] = useState<Draft>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (source.data && !loaded) {
      const draft = fromEvent(source.data.event);
      setD(id ? draft : { ...draft, title: `${draft.title} (copy)`, startsAt: "", endsAt: "" }); // a duplicate needs new dates
      setLoaded(true);
    }
  }, [source.data, loaded, id]);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  function setStart(v: string) {
    setD((x) => {
      const len = minutesBetween(x.startsAt, x.endsAt);
      // keep the length the teacher already chose; a fresh form defaults to one hour
      return { ...x, startsAt: v, endsAt: x.endsAt && len > 0 ? addMinutes(v, len) : addMinutes(v, 60) };
    });
  }

  const bad = d.startsAt && d.endsAt && minutesBetween(d.startsAt, d.endsAt) <= 0 ? "The event must end after it starts." : "";
  const save = useMutation({
    mutationFn: (body: object) => (id ? api.put<Event>(`/api/admin/events/${id}`, body) : api.post<Event>("/api/admin/events", body)),
    onSuccess: (e) => {
      qc.invalidateQueries({ queryKey: ["admin-events"] });
      qc.invalidateQueries({ queryKey: ["admin-event"] });
      qc.invalidateQueries({ queryKey: ["events"] });
      qc.invalidateQueries({ queryKey: ["event"] });
      navigate(`/admin/events/${e.id}`);
    },
  });
  function submit(ev: FormEvent) {
    ev.preventDefault();
    if (bad) return;
    save.mutate({
      title: d.title, subject: d.subject, host: d.host, venue: d.venue, description: d.description, imageUrl: d.imageUrl,
      startsAt: fromLocalInput(d.startsAt), endsAt: fromLocalInput(d.endsAt), capacity: d.capacity.trim() ? Number(d.capacity) : null, signupEnabled: d.signupEnabled,
    });
  }

  if (sourceId && source.isError) return <p>Event not found.</p>;
  if (sourceId && !loaded) return <p className="text-muted-foreground">Loading…</p>;

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">{id ? "Edit event" : params.get("from") ? "Duplicate event" : "New event"}</h1>
        <Link to={id ? `/admin/events/${id}` : "/admin/events"} className="text-sm underline">Cancel</Link>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <Section title="The basics">
            <Label text="Title">
              <Input name="title" required value={d.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Robotics Showcase" />
            </Label>
            <div role="group" aria-label="Subject" className="flex gap-2">
              {SUBJECTS.map(([v, l]) => (
                <button key={v} type="button" aria-pressed={d.subject === v} onClick={() => set("subject", v)} className={cn("flex-1 rounded-md border px-3 py-2 text-sm", d.subject === v ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-accent")}>
                  {l}
                </button>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Label text="Hosted by (optional)">
                <Input name="host" value={d.host} onChange={(e) => set("host", e.target.value)} placeholder="e.g. Ms Chen, Physics Society" />
              </Label>
              <Label text="Venue">
                <Input name="venue" value={d.venue} onChange={(e) => set("venue", e.target.value)} placeholder="e.g. Lab 1" />
              </Label>
            </div>
          </Section>

          <Section title="When" hint="Check-in opens an hour before the start and closes when the event ends.">
            <div className="grid gap-3 sm:grid-cols-2">
              <Label text="Starts">
                <Input name="startsAt" type="datetime-local" required value={d.startsAt} onChange={(e) => setStart(e.target.value)} />
              </Label>
              <Label text="Ends">
                <Input name="endsAt" type="datetime-local" required value={d.endsAt} min={d.startsAt} onChange={(e) => set("endsAt", e.target.value)} />
              </Label>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Length:</span>
              {DURATIONS.map(([m, l]) => (
                <button key={m} type="button" disabled={!d.startsAt} onClick={() => set("endsAt", addMinutes(d.startsAt, m))} className={cn("rounded-full border px-3 py-1 disabled:opacity-50", minutesBetween(d.startsAt, d.endsAt) === m ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-accent")}>
                  {l}
                </button>
              ))}
            </div>
            {bad && <p role="alert" className="text-sm text-red-700">{bad}</p>}
          </Section>

          <Section title="About this event" hint="Students read this on the event page. Use the toolbar for headings, lists and links; Preview shows the result.">
            <MarkdownEditor name="description" value={d.description} onChange={(v) => set("description", v)} placeholder={"## What to expect\nTell students what happens, what to bring and who it is for."} />
            <Label text="Cover image address (optional)">
              <Input name="imageUrl" type="text" inputMode="url" value={d.imageUrl} onChange={(e) => set("imageUrl", e.target.value)} placeholder="https://…" />
            </Label>
          </Section>

          <Section title="Places and sign-up">
            <Label text="Capacity (leave empty for no limit)">
              <Input name="capacity" type="number" min="1" value={d.capacity} onChange={(e) => set("capacity", e.target.value)} className="sm:w-48" />
            </Label>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="signupEnabled" checked={d.signupEnabled} onChange={(e) => set("signupEnabled", e.target.checked)} className="mt-1" />
              <span>
                <b>Let students sign up in advance</b>
                <span className="block text-muted-foreground">
                  Signed-up students keep their place and appear on your check-in list, so you can tick off anyone without a phone. Walk-ins still work while there is room.
                </span>
              </span>
            </label>
          </Section>
        </div>

        <aside className="lg:sticky lg:top-4 lg:self-start">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">What students will see</p>
          <article className={cn(panel, "space-y-2 overflow-hidden p-0")} aria-label="Preview">
            {d.imageUrl.trim() && <img src={d.imageUrl} alt="" className="h-36 w-full object-cover" onError={(e) => (e.currentTarget.style.display = "none")} />}
            <div className="space-y-2 p-4">
              <div>
                <SubjectBadge subject={d.subject} />
              </div>
              <h2 className="text-xl font-bold">{d.title || "Untitled event"}</h2>
              <p className="text-sm text-muted-foreground">
                {d.startsAt ? fmtLongDateTime(new Date(d.startsAt).toISOString()) : "Date and time to be set"}
                {d.venue && ` · ${d.venue}`}
              </p>
              {d.host && <p className="text-sm">Hosted by {d.host}</p>}
              {d.description.trim() && <Prose className="text-sm">{d.description}</Prose>}
              <p className="text-xs text-muted-foreground">
                {d.signupEnabled ? (d.capacity ? `Sign-up open · ${d.capacity} places` : "Sign-up open") : "No sign-up needed: just turn up"}
              </p>
            </div>
          </article>
        </aside>
      </div>
      <FormError error={save.error} />
      <div className="sticky bottom-0 -mx-4 flex justify-end gap-2 border-t bg-background/95 p-3 backdrop-blur">
        <Button asChild variant="outline"><Link to={id ? `/admin/events/${id}` : "/admin/events"}>Cancel</Link></Button>
        <SaveButton pending={save.isPending} disabled={!!bad}>{id ? "Save changes" : "Create event"}</SaveButton>
      </div>
    </form>
  );
}
