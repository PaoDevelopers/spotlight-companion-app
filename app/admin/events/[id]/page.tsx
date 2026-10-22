import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { events } from "@/lib/db/schema";
import { attendees } from "@/lib/services/checkin";
import { makeTagToken } from "@/lib/checkin/token";
import { secret } from "@/lib/session";
import { deleteEvent, manualAdd, saveEvent, undo } from "../../actions";
import { EventForm } from "../form";
import { QrImage } from "@/components/QrImage";
import { headers } from "next/headers";

export default async function AdminEvent({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const db = await getDb();
  const [e] = await db.select().from(events).where(eq(events.id, id));
  if (!e) notFound();
  const list = await attendees(db, id);
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const nfc = `${origin}/c/${makeTagToken(secret(), "event", id)}`;
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{e.title}</h1>
      <div className="flex flex-wrap gap-3">
        <Link href={`/admin/events/${id}/display`} className="rounded bg-slate-900 px-3 py-2 text-white">Display check-in QR</Link>
        <Link href={`/admin/events/${id}/scan`} className="rounded border px-3 py-2">Scan student passes</Link>
        <a href={`/api/admin/events/${id}/csv`} className="rounded border px-3 py-2">Export CSV</a>
      </div>
      <section className="rounded-lg bg-white p-4 shadow-sm">
        <h2 className="font-semibold">Attendees ({list.length}{e.capacity ? ` / ${e.capacity}` : ""})</h2>
        <form action={manualAdd} className="my-2 flex gap-2"><input type="hidden" name="eventId" value={id} /><input name="email" type="email" placeholder="Add by student email" className="flex-1 rounded border p-2" /><button className="rounded border px-3">Add</button></form>
        <ul className="divide-y">{list.map((a) => (
          <li key={a.userId} className="flex items-center justify-between py-1"><span>{a.name} <span className="text-sm text-slate-500">{a.className} · {a.method}</span></span>
            <form action={undo}><input type="hidden" name="eventId" value={id} /><input type="hidden" name="userId" value={a.userId} /><button className="text-sm text-red-700 underline">Undo</button></form></li>
        ))}</ul>
      </section>
      <section className="rounded-lg bg-white p-4 shadow-sm">
        <h2 className="font-semibold">NFC tag / printable QR</h2>
        <p className="mb-2 break-all text-sm text-slate-600">Write this URL to an NFC tag (or print the QR). It is permanent, so only use it at the venue.</p>
        <code className="block break-all text-xs">{nfc}</code>
        <div className="mt-2"><QrImage text={nfc} size={160} /></div>
      </section>
      <details><summary className="cursor-pointer font-semibold">Edit event</summary><EventForm action={saveEvent} label="Save changes" event={e} /></details>
      <form action={deleteEvent}><input type="hidden" name="id" value={id} /><button className="text-red-700 underline">Delete event</button></form>
    </div>
  );
}
