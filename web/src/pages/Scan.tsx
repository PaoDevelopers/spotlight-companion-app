import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Scanner } from "@/components/Scanner";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { ScanResult } from "@/lib/types";

function useScan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => api.post<ScanResult>("/api/scan", { code }),
    onSuccess: () => qc.invalidateQueries(),
  });
}

function Message({ r, error }: { r?: ScanResult; error?: string }) {
  if (!r && !error) return null;
  const ok = !!r?.ok;
  return (
    <p role="status" className={cn("rounded p-3 font-semibold", ok ? "bg-emerald-100" : "bg-red-100")}>
      {error ?? r!.message}
    </p>
  );
}

export function Scan() {
  const navigate = useNavigate();
  const scan = useScan();
  const [manual, setManual] = useState("");
  const send = useCallback(
    (code: string) =>
      scan.mutate(code, {
        onSuccess: (r) => {
          if (r.ok && r.href) navigate(r.href);
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scan.mutate, navigate],
  );
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-bold">Scan to check in</h1>
      <p className="text-muted-foreground">Point the camera at the event screen or an exhibit code.</p>
      <Scanner onScan={send} />
      {scan.isPending && <p>Checking…</p>}
      <Message r={scan.data} error={scan.isError ? errorMessage(scan.error) : undefined} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (manual) send(manual);
        }}
        className="flex gap-2"
      >
        <Input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="Or paste a code" className="flex-1" />
        <Button>Go</Button>
      </form>
    </div>
  );
}

/** What an NFC tap or a phone-camera scan opens: /c/<code>. */
export function CheckinLink() {
  const { code = "" } = useParams();
  const navigate = useNavigate();
  const scan = useScan();
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return; // React runs effects twice in development; a scan must be sent once
    started.current = true;
    scan.mutate(decodeURIComponent(code), { onSuccess: (r) => r.ok && r.href && navigate(r.href, { replace: true }) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <main className="mx-auto max-w-sm p-6 text-center">
      {scan.isPending && <p>Checking…</p>}
      <Message r={scan.data} error={scan.isError ? errorMessage(scan.error) : undefined} />
      <Link to="/" className="mt-4 inline-block underline">
        Back to home
      </Link>
    </main>
  );
}
