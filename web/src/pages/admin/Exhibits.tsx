import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import { QrImage } from "@/components/QrImage";
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
  owners: string;
}
const EMPTY: Draft = { title: "", slug: "", subject: "physics", imageUrl: "", summary: "", bodyMd: "", owners: "" };

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
  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate({ ...d, owners: d.owners.split(/[,\s]+/).filter(Boolean) });
  }
  function edit(x: AdminExhibit) {
    // creators aren't returned by the list, so leaving the field empty keeps them as they are
    setD({ title: x.title, slug: x.slug, subject: x.subject, imageUrl: x.imageUrl ?? "", summary: x.summary, bodyMd: x.bodyMd, owners: "" });
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
          <option value="physics">Physics</option>
          <option value="cs">CS</option>
          <option value="both">Both</option>
        </Select>
        <Input name="imageUrl" placeholder="Image URL (optional, https://…)" value={d.imageUrl} onChange={(e) => set("imageUrl", e.target.value)} />
        <Input name="summary" placeholder="One-line summary" value={d.summary} onChange={(e) => set("summary", e.target.value)} className="sm:col-span-2" />
        <div className="sm:col-span-2">
          <MarkdownEditor name="bodyMd" value={d.bodyMd} onChange={(v) => set("bodyMd", v)} rows={8} placeholder={"## What you're seeing\n## How it works\n## Try this"} />
        </div>
        <Input name="owners" placeholder="Student creators' emails, comma separated (for Most Creative)" value={d.owners} onChange={(e) => set("owners", e.target.value)} className="sm:col-span-2" />
        <FormError error={save.error} />
        <div className="flex gap-2 sm:col-span-2">
          <SaveButton pending={save.isPending}>Save exhibit</SaveButton>
          {editing && <Button type="button" variant="outline" onClick={() => { setD(EMPTY); setEditing(false); }}>Cancel</Button>}
        </div>
      </form>
      <p className="text-sm text-muted-foreground">Print a QR (or write the URL to an NFC tag) for each exhibit and place it at the installation.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {q.data?.map((x) => (
          <div key={x.id} className="rounded-lg bg-card p-3 text-center shadow-sm">
            <b>{x.title}</b>
            <div className="flex justify-center"><QrImage text={x.tagUrl} size={160} /></div>
            <code className="break-all text-[10px]">{x.tagUrl}</code>
            <div><button type="button" className="mt-1 text-sm underline" onClick={() => edit(x)}>Edit</button></div>
          </div>
        ))}
      </div>
    </div>
  );
}
