"use client";
import { useCallback, useState } from "react";
import { Scanner } from "@/components/Scanner";
import { scanPass } from "../../../actions";

export function ScanPasses({ eventId }: { eventId: number }) {
  const [log, setLog] = useState<{ ok: boolean; message: string }[]>([]);
  const onScan = useCallback(async (t: string) => { const r = await scanPass(eventId, t); setLog((l) => [r, ...l].slice(0, 8)); }, [eventId]);
  return (
    <div className="mx-auto max-w-md space-y-3">
      <h1 className="text-2xl font-bold">Scan student passes</h1>
      <Scanner onScan={onScan} />
      <ul aria-live="polite">{log.map((l, i) => <li key={i} className={`mb-1 rounded p-2 ${l.ok ? "bg-emerald-100" : "bg-red-100"}`}>{l.message}</li>)}</ul>
    </div>
  );
}
