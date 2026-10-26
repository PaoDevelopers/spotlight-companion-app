import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Input, Select, Textarea } from "@/components/ui/input";
import { QrImage } from "@/components/QrImage";
import { api } from "@/lib/api";
import type { Exhibit } from "@/lib/types";
import { FormError, SaveButton, panel } from "./shared";

type AdminExhibit = Exhibit & { tagToken: string; tagUrl: string };

export default function AdminExhibits() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin-exhibits"], queryFn: () => api.get<AdminExhibit[]>("/api/admin/exhibits") });
  const save = useMutation({
    mutationFn: (body: object) => api.post<AdminExhibit>("/api/admin/exhibits", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-exhibits"] }),
  });
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Exhibits</h1>
      <form
        className={`${panel} grid gap-2 sm:grid-cols-2`}
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const g = (k: string) => String(f.get(k) ?? "");
          save.mutate({
            title: g("title"), slug: g("slug"), subject: g("subject"), summary: g("summary"), bodyMd: g("bodyMd"), imageUrl: g("imageUrl"),
            owners: g("owners").split(/[,\s]+/).filter(Boolean),
          });
        }}
      >
        <Input name="title" required placeholder="Title" />
        <Input name="slug" placeholder="URL slug (optional; reuse to edit)" />
        <Select name="subject">
          <option value="physics">Physics</option>
          <option value="cs">CS</option>
          <option value="both">Both</option>
        </Select>
        <Input name="imageUrl" placeholder="Image URL (optional, https://…)" />
        <Input name="summary" placeholder="One-line summary" className="sm:col-span-2" />
        <Textarea name="bodyMd" rows={6} placeholder="Explanation (Markdown): ## What you're seeing, ## How it works, ## Try this" className="sm:col-span-2" />
        <Input name="owners" placeholder="Student creators' emails, comma separated (for Most Creative)" className="sm:col-span-2" />
        <FormError error={save.error} />
        <SaveButton pending={save.isPending} className="sm:col-span-2">Save exhibit</SaveButton>
      </form>
      <p className="text-sm text-muted-foreground">Print a QR (or write the URL to an NFC tag) for each exhibit and place it at the installation.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {q.data?.map((x) => (
          <div key={x.id} className="rounded-lg bg-card p-3 text-center shadow-sm">
            <b>{x.title}</b>
            <div className="flex justify-center"><QrImage text={x.tagUrl} size={160} /></div>
            <code className="break-all text-[10px]">{x.tagUrl}</code>
          </div>
        ))}
      </div>
    </div>
  );
}
