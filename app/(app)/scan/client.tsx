"use client";
import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Scanner } from "@/components/Scanner";
import { submitScan } from "@/app/actions";

export function ScanClient() {
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const [manual, setManual] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const handle = useCallback((text: string) => {
    start(async () => {
      const r = await submitScan(text);
      setMsg(r);
      if (r.ok && "href" in r && r.href) router.push(r.href);
    });
  }, [router]);
  return (
    <div className="space-y-3">
      <Scanner onScan={handle} />
      {pending && <p>Checking…</p>}
      {msg && <p role="status" className={`rounded p-3 font-semibold ${msg.ok ? "bg-emerald-100" : "bg-red-100"}`}>{msg.message}</p>}
      <form onSubmit={(e) => { e.preventDefault(); if (manual) handle(manual); }} className="flex gap-2">
        <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="Or paste a code" className="flex-1 rounded border p-2" />
        <button className="rounded bg-slate-900 px-3 text-white">Go</button>
      </form>
    </div>
  );
}
