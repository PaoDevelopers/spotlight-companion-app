import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { checkins, events, exhibits, users } from "@/lib/db/schema";
import { requireStaff } from "@/lib/session";
import { setRole } from "./actions";

export default async function Admin() {
  const me = await requireStaff();
  const db = await getDb();
  const c = async (t: typeof events | typeof checkins | typeof users | typeof exhibits) => (await db.select({ n: sql<number>`count(*)::int` }).from(t))[0].n;
  const stats = [["Events", await c(events)], ["Check-ins", await c(checkins)], ["Users", await c(users)], ["Exhibits", await c(exhibits)]] as const;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{stats.map(([l, n]) => <div key={l} className="rounded-lg bg-white p-4 text-center shadow-sm"><div className="text-3xl font-bold">{n}</div>{l}</div>)}</div>
      {me.role === "admin" && (
        <form action={setRole} className="flex flex-wrap gap-2 rounded-lg bg-white p-4 shadow-sm">
          <b className="w-full">Set a user&apos;s role</b>
          <input name="email" type="email" placeholder="user email" required className="rounded border p-2" />
          <select name="role" className="rounded border p-2"><option>student</option><option>teacher</option><option>admin</option></select>
          <button className="rounded bg-slate-900 px-3 text-white">Save</button>
        </form>
      )}
    </div>
  );
}
