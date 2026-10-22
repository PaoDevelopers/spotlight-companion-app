import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { processScan } from "@/lib/scan";

export const dynamic = "force-dynamic";

// Landing page for NFC taps and phone-camera QR scans: /c/<token>
export default async function Tap({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  await requireUser(`/c/${token}`);
  const r = await processScan(token);
  if (r.ok && "href" in r && r.href) redirect(r.href);
  return (
    <main className="mx-auto max-w-sm p-6 text-center">
      <p role="status" className={`rounded p-4 text-lg font-semibold ${r.ok ? "bg-emerald-100" : "bg-red-100"}`}>{r.message}</p>
      <Link href="/" className="mt-4 inline-block underline">Back to home</Link>
    </main>
  );
}
