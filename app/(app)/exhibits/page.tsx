import Link from "next/link";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { exhibitVisits, exhibits } from "@/lib/db/schema";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Exhibits() {
  const user = await requireUser();
  const db = await getDb();
  const [list, visits] = await Promise.all([db.select().from(exhibits).orderBy(exhibits.title), db.select().from(exhibitVisits).where(eq(exhibitVisits.userId, user.id))]);
  const seen = new Set(visits.map((v) => v.exhibitId));
  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold">Exhibits</h1>
      <p className="mb-3 text-slate-600">{seen.size} of {list.length} visited. Scan the code at each installation to log it.</p>
      {list.map((x) => (
        <Link key={x.id} href={`/exhibits/${x.slug}`} className="mb-2 block rounded-lg bg-white p-3 shadow-sm">
          <span className="font-semibold">{seen.has(x.id) ? "✅ " : ""}{x.title}</span>
          <div className="text-sm text-slate-600">{x.summary}</div>
        </Link>
      ))}
    </div>
  );
}
