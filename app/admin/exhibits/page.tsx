import { headers } from "next/headers";
import { getDb } from "@/lib/db";
import { exhibits } from "@/lib/db/schema";
import { makeTagToken } from "@/lib/checkin/token";
import { secret } from "@/lib/session";
import { QrImage } from "@/components/QrImage";
import { saveExhibit } from "../actions";

export default async function AdminExhibits() {
  const list = await (await getDb()).select().from(exhibits).orderBy(exhibits.title);
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const i = "rounded border p-2";
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Exhibits</h1>
      <form action={saveExhibit} className="grid gap-2 rounded-lg bg-white p-4 shadow-sm sm:grid-cols-2">
        <input name="title" required placeholder="Title" className={i} />
        <input name="slug" placeholder="URL slug (optional; reuse to edit)" className={i} />
        <select name="subject" className={i}><option value="physics">Physics</option><option value="cs">CS</option><option value="both">Both</option></select>
        <input name="imageUrl" placeholder="Image URL (optional)" className={i} />
        <input name="summary" placeholder="One-line summary" className={`${i} sm:col-span-2`} />
        <textarea name="bodyMd" rows={6} placeholder="Explanation (Markdown): ## What you're seeing, ## How it works, ## Try this" className={`${i} sm:col-span-2`} />
        <input name="owners" placeholder="Student creators' emails, comma separated (for Most Creative)" className={`${i} sm:col-span-2`} />
        <button className="rounded bg-slate-900 p-2 font-semibold text-white sm:col-span-2">Save exhibit</button>
      </form>
      <p className="text-sm text-slate-600">Print a QR (or write the URL to an NFC tag) for each exhibit and place it at the installation.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {list.map((x) => {
          const url = `${origin}/c/${makeTagToken(secret(), "exhibit", x.id)}`;
          return <div key={x.id} className="rounded-lg bg-white p-3 text-center shadow-sm"><b>{x.title}</b><div className="flex justify-center"><QrImage text={url} size={160} /></div><code className="break-all text-[10px]">{url}</code></div>;
        })}
      </div>
    </div>
  );
}
