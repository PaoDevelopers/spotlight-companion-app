// datetime-local has no zone, so format in the server's local time.
const local = (d?: Date) => (d ? new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "");

type Ev = { id: number; title: string; subject: "physics" | "cs" | "both"; venue: string | null; description: string; startsAt: Date; endsAt: Date; capacity: number | null };

export function EventForm({ action, label, event }: { action: (f: FormData) => Promise<void>; label: string; event?: Ev }) {
  const i = "rounded border p-2";
  return (
    <form action={action} className="grid gap-2 rounded-lg bg-white p-4 shadow-sm sm:grid-cols-2">
      {event && <input type="hidden" name="id" value={event.id} />}
      <input name="title" required placeholder="Title" defaultValue={event?.title} className={`${i} sm:col-span-2`} />
      <select name="subject" defaultValue={event?.subject ?? "both"} className={i}><option value="physics">Physics</option><option value="cs">CS</option><option value="both">Both</option></select>
      <input name="venue" placeholder="Venue" defaultValue={event?.venue ?? ""} className={i} />
      <label className="text-sm">Starts<input name="startsAt" type="datetime-local" required defaultValue={local(event?.startsAt)} className={`${i} block w-full`} /></label>
      <label className="text-sm">Ends<input name="endsAt" type="datetime-local" required defaultValue={local(event?.endsAt)} className={`${i} block w-full`} /></label>
      <input name="capacity" type="number" min="1" placeholder="Capacity (optional)" defaultValue={event?.capacity ?? ""} className={i} />
      <textarea name="description" placeholder="Description" defaultValue={event?.description} className={`${i} sm:col-span-2`} />
      <button className="rounded bg-slate-900 p-2 font-semibold text-white sm:col-span-2">{label}</button>
    </form>
  );
}
