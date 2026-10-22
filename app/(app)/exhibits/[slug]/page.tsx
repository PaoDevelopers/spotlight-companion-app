import { notFound } from "next/navigation";
import Markdown from "react-markdown";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { exhibits, votes } from "@/lib/db/schema";
import { requireUser } from "@/lib/session";
import { vote } from "@/app/actions";
import { CREATIVE } from "@/lib/services/awards";

export const dynamic = "force-dynamic";

export default async function Exhibit({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await requireUser();
  const db = await getDb();
  const [x] = await db.select().from(exhibits).where(eq(exhibits.slug, slug));
  if (!x) notFound();
  const [myVote] = await db.select().from(votes).where(and(eq(votes.category, CREATIVE), eq(votes.voterId, user.id)));
  return (
    <article className="space-y-3">
      <h1 className="text-2xl font-bold">{x.title}</h1>
      <p className="text-slate-600">{x.summary}</p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {x.imageUrl && <img src={x.imageUrl} alt={x.title} className="w-full rounded-lg" />}
      <div className="space-y-2 [&_h2]:mt-4 [&_h2]:text-lg [&_h2]:font-semibold [&_ol]:list-decimal [&_ol]:pl-5"><Markdown>{x.bodyMd}</Markdown></div>
      <form action={vote} className="rounded-lg bg-white p-3 shadow-sm">
        <input type="hidden" name="exhibitId" value={x.id} />
        <button className="rounded bg-amber-400 px-3 py-2 font-semibold">{myVote?.exhibitId === x.id ? "⭐ Your creative vote" : "Vote Most Creative"}</button>
        <p className="mt-1 text-xs text-slate-500">One vote per student; you can change it until voting closes. You can't vote for your own project.</p>
      </form>
    </article>
  );
}
