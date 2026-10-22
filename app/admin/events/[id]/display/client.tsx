"use client";
import { useEffect, useState } from "react";
import { QrImage } from "@/components/QrImage";

/** Fullscreen rotating QR for a projector. Refreshes every 10s; tokens last ~30-60s. */
export function DisplayClient({ eventId }: { eventId: number }) {
  const [token, setToken] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const r = await fetch(`/api/admin/token/${eventId}`, { cache: "no-store" });
        if (!r.ok) throw new Error();
        const j = await r.json();
        if (live) { setToken(j.token); setFailed(false); }
      } catch { if (live) setFailed(true); }
    };
    load();
    const t = setInterval(load, 10_000);
    return () => { live = false; clearInterval(t); };
  }, [eventId]);
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4">
      <h1 className="text-3xl font-bold">Scan to check in</h1>
      {token && <QrImage text={`${window.location.origin}/c/${token}`} size={Math.min(480, window.innerWidth - 48)} />}
      {failed && <p role="alert" className="text-red-700">Connection lost, retrying… (the code on screen may expire)</p>}
      <p className="text-slate-600">Open the Spotlight app → Scan, or use your phone camera.</p>
    </div>
  );
}
