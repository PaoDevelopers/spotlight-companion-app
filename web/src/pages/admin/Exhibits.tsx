import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import { QrImage } from "@/components/QrImage";
import { CoverImageField } from "@/components/CoverImageField";
import { SUBJECTS } from "@/lib/subjects";
import { api } from "@/lib/api";
import type { Exhibit } from "@/lib/types";
import { FormError, SaveButton, panel } from "./shared";

type AdminExhibit = Exhibit & { tagToken: string; tagUrl: string };

interface Draft {
  title: string;
  slug: string;
  subject: string;
  imageUrl: string;
  summary: string;
  bodyMd: string;
}
const EMPTY: Draft = { title: "", slug: "", subject: "physics", imageUrl: "", summary: "", bodyMd: "" };

export default function AdminExhibits() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin-exhibits"], queryFn: () => api.get<AdminExhibit[]>("/api/admin/exhibits") });
  const [d, setD] = useState<Draft>(EMPTY);
  const [editing, setEditing] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const save = useMutation({
    mutationFn: (body: object) => api.post<AdminExhibit>("/api/admin/exhibits", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-exhibits"] });
      qc.invalidateQueries({ queryKey: ["exhibits"] });
      qc.invalidateQueries({ queryKey: ["exhibit"] });
      setD(EMPTY);
      setEditing(false);
    },
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.del(`/api/admin/exhibits/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-exhibits"] });
      qc.invalidateQueries({ queryKey: ["exhibits"] });
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate(d);
  }
  function edit(x: AdminExhibit) {
    setD({ title: x.title, slug: x.slug, subject: x.subject, imageUrl: x.imageUrl ?? "", summary: x.summary, bodyMd: x.bodyMd });
    setEditing(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Exhibits</h1>
      <form className={`${panel} grid gap-3 sm:grid-cols-2`} onSubmit={submit}>
        <h2 className="font-semibold sm:col-span-2">{editing ? `Editing “${d.title}”` : "New exhibit"}</h2>
        <Input name="title" required placeholder="Title" value={d.title} onChange={(e) => set("title", e.target.value)} />
        <Input name="slug" placeholder="URL slug (optional)" value={d.slug} readOnly={editing} onChange={(e) => set("slug", e.target.value)} />
        <Select name="subject" value={d.subject} onChange={(e) => set("subject", e.target.value)}>
          {SUBJECTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
        <div className="sm:col-span-2">
          <CoverImageField name="imageUrl" value={d.imageUrl} onChange={(v) => set("imageUrl", v)} />
        </div>
        <Input name="summary" placeholder="One-line summary" value={d.summary} onChange={(e) => set("summary", e.target.value)} className="sm:col-span-2" />
        <div className="sm:col-span-2">
          <MarkdownEditor name="bodyMd" value={d.bodyMd} onChange={(v) => set("bodyMd", v)} rows={8} placeholder={"## What you're seeing\n## How it works\n## Try this"} />
        </div>
        <FormError error={save.error} />
        <div className="flex gap-2 sm:col-span-2">
          <SaveButton pending={save.isPending}>Save exhibit</SaveButton>
          {editing && <Button type="button" variant="outline" onClick={() => { setD(EMPTY); setEditing(false); }}>Cancel</Button>}
        </div>
      </form>
      <FormError error={remove.error} />
      <p className="text-sm text-muted-foreground">Print a QR (or write the URL to an NFC tag) for each exhibit and place it at the installation.</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {q.data?.map((x) => (
          <div key={x.id} className="rounded-lg bg-card p-3 text-center shadow-sm">
            <b>{x.title}</b>
            <div className="flex justify-center"><QrImage text={x.tagUrl} size={160} /></div>
            <code className="break-all text-[10px]">{x.tagUrl}</code>
            <div className="mt-1 flex justify-center gap-4 text-sm">
              <button type="button" className="underline" onClick={() => edit(x)}>Edit</button>
              <button
                type="button"
                className="text-red-700 underline"
                disabled={remove.isPending}
                onClick={() => { if (window.confirm(`Delete “${x.title}”? Its printed QR code will stop working and visits are forgotten.`)) remove.mutate(x.id); }}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
