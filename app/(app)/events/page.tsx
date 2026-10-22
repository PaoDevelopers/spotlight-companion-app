import Link from "next/link";
import { getDb } from "@/lib/db";
import { events } from "@/lib/db/schema";

export const dynamic = "force-dynamic";
const BADGE = { physics: "bg-sky-100", cs: "bg-violet-100", both: "bg-emerald-100" } as const;

export default async function Events({ searchParams }: { searchParams: Promise<{ subject?: string }> }) {
  const { subject } = await searchParams;
  const all = await (await getDb()).select().from(events).orderBy(events.startsAt);
  const list = subject ? all.filter((e) => e.subject === subject || e.subject === "both") : all;
  return (
    <div>
      <h1 className="mb-3 text-2xl font-bold">Events</h1>
      <div className="mb-4 flex gap-2 text-sm">
        {[["", "All"], ["physics", "Physics"], ["cs", "CS"]].map(([v, l]) => (
          <Link key={v} href={v ? `/events?subject=${v}` : "/events"} className={`rounded-full border px-3 py-1 ${(subject ?? "") === v ? "bg-slate-900 text-white" : "bg-white"}`}>{l}</Link>
        ))}
      </div>
      {list.map((e) => (
        <Link key={e.id} href={`/events/${e.id}`} className="mb-2 block rounded-lg bg-white p-3 shadow-sm">
          <span className={`mr-2 rounded px-2 py-0.5 text-xs ${BADGE[e.subject]}`}>{e.subject}</span>
          <span className="font-semibold">{e.title}</span>
          <div className="text-sm text-slate-600">{e.startsAt.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })} · {e.venue}</div>
        </Link>
      ))}
    </div>
  );
}
