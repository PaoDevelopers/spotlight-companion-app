import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import type { AwardResult } from "@/lib/types";
import { FormError, SaveButton, panel } from "./shared";

interface Data {
  exhibits: { id: number; title: string; myScore: number | null }[];
  drafts: AwardResult[];
  published: AwardResult[];
  liveWinners: number;
}

function group(rows: AwardResult[]) {
  const out = new Map<string, AwardResult[]>();
  for (const r of rows) out.set(r.award, [...(out.get(r.award) ?? []), r]);
  return [...out];
}

const fmtMetrics = (m: Record<string, number>) => Object.entries(m).map(([k, v]) => `${k} ${v}`).join(" · ");

function ScoreRow({ id, title, mine }: { id: number; title: string; mine: number | null }) {
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (score: number) => api.post("/api/admin/awards/judge-score", { exhibitId: id, score }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-awards"] }),
  });
  return (
    <form
      className="mb-1 flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(Number(new FormData(e.currentTarget).get("score")));
      }}
    >
      <span className="w-56">{title}</span>
      <Input name="score" type="number" min="0" max="100" required defaultValue={mine ?? ""} className="w-20 p-1" />
      <SaveButton pending={save.isPending} variant="outline" size="sm">Score</SaveButton>
      <FormError error={save.error} />
    </form>
  );
}

function DraftRow({ r }: { r: AwardResult }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const veto = useMutation({
    mutationFn: () => api.post("/api/admin/awards/veto", { id: r.id, reason }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-awards"] }),
  });
  return (
    <form className="flex items-center gap-2 border-t py-1 text-sm" onSubmit={(e) => { e.preventDefault(); veto.mutate(); }}>
      <span className="flex-1">
        #{r.rank} {r.name} <i className="text-muted-foreground">{r.className} · {fmtMetrics(r.metrics)}</i>
      </span>
      <Input name="reason" placeholder="Veto reason" value={reason} onChange={(e) => setReason(e.target.value)} className="w-auto p-1" />
      <SaveButton pending={veto.isPending} pendingText="Removing…" variant="link" className="h-auto p-0 text-red-700">Remove</SaveButton>
    </form>
  );
}

export default function AdminAwards() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin-awards"], queryFn: () => api.get<Data>("/api/admin/awards") });
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-awards"] });
  const run = useMutation({ mutationFn: () => api.post("/api/admin/awards/run"), onSuccess: refresh });
  const publish = useMutation({ mutationFn: () => api.post<{ published: number }>("/api/admin/awards/publish"), onSuccess: refresh });
  const d = q.data;
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Awards</h1>
      <p className="text-muted-foreground">
        Workflow: judges score → <b>compute drafts</b> → review/veto → <b>publish</b>. Students only see published results, and published results are never changed by re-running.
      </p>
      {d && (
        <>
          <section className={panel}>
            <h2 className="mb-2 font-semibold">Judge scoring (Most Creative, 0–100)</h2>
            {d.exhibits.map((x) => <ScoreRow key={`${x.id}-${x.myScore}`} id={x.id} title={x.title} mine={x.myScore} />)}
          </section>
          <div className="flex items-center gap-3">
            <SaveButton pending={run.isPending} pendingText="Computing…" onClick={() => run.mutate()}>Compute drafts</SaveButton>
            <span className="text-sm text-muted-foreground">Current standings would yield {d.liveWinners} winners.</span>
          </div>
          <FormError error={run.error} />
          <section>
            <h2 className="mb-2 font-semibold">Drafts</h2>
            {group(d.drafts).map(([award, rows]) => (
              <div key={award} className="mb-3 rounded-lg bg-card p-3 shadow-sm">
                <b>{award}</b>
                {rows.map((r) => <DraftRow key={r.id} r={r} />)}
              </div>
            ))}
            {d.drafts.length === 0 && <p className="text-muted-foreground">No drafts.</p>}
            {d.drafts.length > 0 && (
              <SaveButton pending={publish.isPending} pendingText="Publishing…" variant="success" onClick={() => publish.mutate()}>Publish to students</SaveButton>
            )}
            <FormError error={publish.error} />
          </section>
          <section>
            <h2 className="mb-2 font-semibold">Published</h2>
            {d.published.length === 0 && <p className="text-muted-foreground">Nothing published yet.</p>}
            {group(d.published).map(([award, rows]) => (
              <div key={award} className="mb-2"><b>{award}</b>: {rows.map((r) => `#${r.rank} ${r.name}`).join(", ")}</div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
