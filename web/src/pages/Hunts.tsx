import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SubjectBadge } from "@/components/ui/badge";
import { CoverThumb } from "@/components/CoverThumb";
import { PhotoAdder } from "@/components/PhotoAdder";
import { Prose } from "@/components/Prose";
import { api, errorMessage } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Hunt, HuntStage, HuntView, StageOutcome } from "@/lib/types";

export function Hunts() {
  const q = useQuery({ queryKey: ["hunts"], queryFn: () => api.get<{ hunts: HuntView[] }>("/api/hunts") });
  const hunts = q.data?.hunts ?? [];
  return (
    <div className="space-y-4">
      <div>
        <h1 className="mb-1 text-2xl font-bold">Scavenger hunts</h1>
        <p className="text-muted-foreground">Find the evidence at each station. Stages unlock one after another.</p>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {hunts.map((h) => (
          <Link key={h.id} to={`/hunts/${h.id}`} className="flex items-center gap-3 rounded-lg bg-card p-3 shadow-sm">
            <CoverThumb imageUrl={h.imageUrl} markdown={h.description} />
            <div className="min-w-0 flex-1">
              <SubjectBadge subject={h.subject} />
              <span className="font-semibold">{h.finished ? "🏁 " : ""}{h.title}</span>
              <div className="text-sm text-muted-foreground">{h.done} of {h.total} stages{h.finished ? " · finished" : ""}</div>
            </div>
          </Link>
        ))}
      </div>
      {q.data && hunts.length === 0 && <p className="text-muted-foreground">No scavenger hunts are open right now.</p>}
    </div>
  );
}

function CodeForm({ hunt }: { hunt: Hunt }) {
  const qc = useQueryClient();
  const [code, setCode] = useState("");
  const submit = useMutation({
    mutationFn: () => api.post<StageOutcome>(`/api/hunts/${hunt.id}/code`, { code }),
    onSuccess: (r) => {
      if (r.result === "done") setCode("");
      qc.invalidateQueries({ queryKey: ["hunt", String(hunt.id)] });
      qc.invalidateQueries({ queryKey: ["hunts"] });
    },
  });
  const r = submit.data;
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (code.trim()) submit.mutate(); }} className="space-y-2 rounded-lg bg-card p-3 shadow-sm">
      <label className="block text-sm font-medium">
        Enter the code word or answer you found
        <Input value={code} onChange={(e) => setCode(e.target.value)} maxLength={200} autoComplete="off" className="mt-1" aria-label="Code word or answer" />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={submit.isPending || !code.trim()}>Check</Button>
        <Link to="/scan" className="text-sm underline">Or scan the code at the station</Link>
      </div>
      {submit.isError && <p role="alert" className="text-sm text-red-700">{errorMessage(submit.error)}</p>}
      {r && (
        <p role="status" className={cn("rounded p-2 text-sm font-medium", r.result === "done" ? "bg-emerald-100" : r.result === "already" ? "bg-card" : "bg-red-100")}>
          {r.message}
        </p>
      )}
    </form>
  );
}

function StageCard({ s }: { s: HuntStage }) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["hunt"] });
  const del = useMutation({ mutationFn: (id: number) => api.del(`/api/hunt-photos/${id}`), onSuccess: refresh });
  const [open, setOpen] = useState(false);
  const icon = s.state === "done" ? "✅" : s.state === "current" ? "👉" : "🔒";
  return (
    <li className={cn("rounded-lg p-3 shadow-sm", s.state === "current" ? "bg-card ring-2 ring-primary" : s.state === "done" ? "bg-emerald-50" : "bg-muted/50")}>
      <div className="font-semibold">{icon} Stage {s.position}: {s.state === "locked" ? "Locked" : s.title}</div>
      {s.state === "done" && s.doneAt && <div className="text-xs text-muted-foreground">Completed {fmtDateTime(s.doneAt)}{s.method === "teacher" ? " (recorded by a teacher)" : ""}</div>}
      {s.state === "current" && s.clue && <Prose className="mt-1 text-sm">{s.clue}</Prose>}
      {s.state !== "locked" && s.photos.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2">
          {s.photos.map((p) => (
            <li key={p.id} className="w-24 text-xs">
              <img src={p.imageUrl} alt={p.caption || "Your evidence"} className="h-24 w-24 rounded object-cover" />
              <button type="button" className="text-red-700 underline" onClick={() => { if (window.confirm("Remove this photo?")) del.mutate(p.id); }}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      {s.state !== "locked" && (
        <div className="mt-2">
          {open ? (
            <PhotoAdder kind="hunt" label="Photo of your evidence" attach={(imageId, caption) => api.post(`/api/hunt-stages/${s.id}/photos`, { imageId, caption })} onDone={() => { setOpen(false); refresh(); }} />
          ) : (
            s.photos.length < 5 && <button type="button" className="text-sm underline" onClick={() => setOpen(true)}>Add a photo of your evidence</button>
          )}
        </div>
      )}
    </li>
  );
}

export function HuntDetail() {
  const { id = "" } = useParams();
  const q = useQuery({ queryKey: ["hunt", id], queryFn: () => api.get<{ hunt: HuntView }>(`/api/hunts/${id}`) });
  if (q.isError) return <p>Scavenger hunt not found.</p>;
  if (!q.data) return null;
  const h = q.data.hunt;
  return (
    <article className="space-y-4">
      {h.imageUrl && <img src={h.imageUrl} alt="" className="h-40 w-full rounded-lg object-cover md:h-56" onError={(e) => (e.currentTarget.style.display = "none")} />}
      <div>
        <SubjectBadge subject={h.subject} />
        <h1 className="text-2xl font-bold">{h.title}</h1>
        <p className="text-muted-foreground">{h.done} of {h.total} stages done</p>
        <div className="mt-1 h-2 overflow-hidden rounded bg-muted" role="progressbar" aria-valuenow={h.done} aria-valuemax={h.total}>
          <div className="h-full bg-primary" style={{ width: `${h.total ? (100 * h.done) / h.total : 0}%` }} />
        </div>
      </div>
      {h.description && <Prose>{h.description}</Prose>}
      {!h.published && <p className="rounded bg-amber-100 p-2 text-sm">Not published yet: only teachers can see this hunt.</p>}
      {h.finished ? (
        <div role="status" className="rounded-lg bg-emerald-100 p-3 font-semibold">🏁 You finished the hunt{h.rank ? ` in place ${h.rank}` : ""}!</div>
      ) : (
        <CodeForm hunt={h} />
      )}
      <ol className="space-y-2">{h.stageList.map((s) => <StageCard key={s.id} s={s} />)}</ol>
      {h.board.length > 0 && (
        <section aria-label="Finishers" className="space-y-1">
          <h2 className="text-lg font-semibold">Who finished first</h2>
          <ol className="space-y-1 text-sm">
            {h.board.map((r, i) => (
              <li key={i} className={cn("flex justify-between rounded bg-card p-2 shadow-sm", r.me && "font-semibold ring-1 ring-primary")}>
                <span>{r.rank}. {r.label}{r.me ? " (you)" : ""}</span>
                <span className="text-muted-foreground">{fmtDateTime(r.at)}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </article>
  );
}
