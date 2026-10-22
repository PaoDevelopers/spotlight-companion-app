import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { checkins, events } from "@/lib/db/schema";
import { requireUser, secret } from "@/lib/session";
import { makePassToken } from "@/lib/checkin/token";
import { QrImage } from "@/components/QrImage";
import { logout, toggleLeaderboard } from "@/app/actions";
import { SignOutButton } from "@/components/SignOutButton";

export const dynamic = "force-dynamic";

export default async function Me() {
  const user = await requireUser();
  const hist = await (await getDb()).select({ title: events.title, at: checkins.at, method: checkins.method }).from(checkins).innerJoin(events, eq(events.id, checkins.eventId)).where(eq(checkins.userId, user.id)).orderBy(checkins.at);
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">{user.name}</h1>
      <section className="rounded-lg bg-white p-4 text-center shadow-sm">
        <p className="mb-2 text-sm text-slate-600">My pass: show this to a teacher if scanning doesn&apos;t work</p>
        <div className="flex justify-center"><QrImage text={makePassToken(secret(), user.id)} size={200} /></div>
      </section>
      <form action={toggleLeaderboard} className="flex items-center gap-2 rounded-lg bg-white p-3 shadow-sm">
        <input id="show" type="checkbox" name="show" defaultChecked={user.showOnLeaderboard} />
        <label htmlFor="show" className="flex-1">Show my name on public leaderboards</label>
        <button className="rounded border px-2 py-1 text-sm">Save</button>
      </form>
      <section><h2 className="mb-2 font-semibold">My check-ins</h2>
        {hist.map((h, i) => <div key={i} className="mb-1 rounded bg-white p-2 text-sm shadow-sm">{h.title} <span className="text-slate-500">· {h.method}</span></div>)}
        {hist.length === 0 && <p className="text-slate-500">None yet.</p>}
      </section>
      <form action={logout}><SignOutButton /></form>
    </div>
  );
}
