import Link from "next/link";
import { getDb } from "@/lib/db";
import { events } from "@/lib/db/schema";
import { saveEvent } from "../actions";
import { EventForm } from "./form";

export default async function AdminEvents() {
  const list = await (await getDb()).select().from(events).orderBy(events.startsAt);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Events</h1>
      <EventForm action={saveEvent} label="Create event" />
      {list.map((e) => (
        <Link key={e.id} href={`/admin/events/${e.id}`} className="block rounded-lg bg-white p-3 shadow-sm">
          <b>{e.title}</b> <span className="text-sm text-slate-600">{e.startsAt.toLocaleString("en-GB")}</span>
        </Link>
      ))}
    </div>
  );
}
