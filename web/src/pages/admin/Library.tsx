import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { SubjectBadge } from "@/components/ui/badge";
import { CoverImageField } from "@/components/CoverImageField";
import { CoverThumb } from "@/components/CoverThumb";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import { api } from "@/lib/api";
import { SUBJECTS } from "@/lib/subjects";
import type { Book, Subject } from "@/lib/types";
import { FormError, SaveButton, panel, useDraftStatus } from "./shared";

const useAdminBooks = () => useQuery({ queryKey: ["admin-books"], queryFn: () => api.get<{ books: Book[] }>("/api/admin/books") });

export default function AdminLibrary() {
  const q = useAdminBooks();
  const books = q.data?.books ?? [];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Library</h1>
        <Button asChild><Link to="/admin/library/new">Add a book</Link></Button>
      </div>
      <p className="text-sm text-muted-foreground">Recommended books for Spotlight Month. Students mark the ones they have read and leave comments; you can delete any comment from the book's page.</p>
      {q.data && books.length === 0 && <p className="text-muted-foreground">No books yet. Add the first one.</p>}
      <div className="grid gap-2 lg:grid-cols-2">
        {books.map((b) => (
          <Link key={b.id} to={`/admin/library/${b.id}/edit`} className="flex items-center gap-3 rounded-lg bg-card p-3 shadow-sm hover:bg-accent">
            <CoverThumb imageUrl={b.imageUrl} markdown={b.bodyMd} className="size-12" />
            <div className="min-w-0 flex-1">
              <div className="truncate"><SubjectBadge subject={b.subject} /><b>{b.title}</b></div>
              <div className="truncate text-sm text-muted-foreground">{b.author}</div>
            </div>
            <div className="text-right text-sm text-muted-foreground">{b.reads} read<br />{b.comments} comments</div>
          </Link>
        ))}
      </div>
    </div>
  );
}

interface Draft {
  title: string;
  author: string;
  subject: Subject;
  summary: string;
  imageUrl: string;
  bodyMd: string;
}
const EMPTY: Draft = { title: "", author: "", subject: "chemistry", summary: "", imageUrl: "", bodyMd: "" };

export function AdminBookEdit() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const list = useAdminBooks();
  const existing = id ? list.data?.books.find((b) => String(b.id) === id) : undefined;
  const [d, setD] = useState<Draft>(EMPTY);
  const [loaded, setLoaded] = useState(!id);
  useEffect(() => {
    if (id && existing && !loaded) {
      setD({ title: existing.title, author: existing.author, subject: existing.subject, summary: existing.summary, imageUrl: existing.imageUrl ?? "", bodyMd: existing.bodyMd });
      setLoaded(true);
    }
  }, [id, existing, loaded]);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const status = useDraftStatus(d, loaded);
  const sent = useRef(d);
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["admin-books"] }), qc.invalidateQueries({ queryKey: ["books"] }), qc.invalidateQueries({ queryKey: ["book"] })]);
  const save = useMutation({
    mutationFn: () => (id ? api.put<{ book: Book }>(`/api/admin/books/${id}`, d) : api.post<{ book: Book }>("/api/admin/books", d)),
    onSuccess: (r) => {
      refresh();
      status.markSaved(sent.current);
      if (!id) navigate(`/admin/library/${r.book.id}/edit`, { replace: true });
    },
  });
  const del = useMutation({
    mutationFn: () => api.del(`/api/admin/books/${id}`),
    onSuccess: () => { refresh(); navigate("/admin/library", { replace: true }); },
  });
  if (id && list.data && !existing) return <p>Book not found.</p>;
  if (id && !loaded) return <p className="text-muted-foreground">Loading…</p>;
  return (
    <form onSubmit={(e: FormEvent) => { e.preventDefault(); sent.current = d; save.mutate(); }} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">{id ? "Edit book" : "Add a book"}</h1>
        {id && <Link to={`/library/${id}`} className="text-sm underline">See it as a student</Link>}
      </div>
      <section className={`${panel} space-y-3`}>
        <label className="block text-sm"><span className="mb-1 block font-medium">Title</span>
          <Input name="title" required value={d.title} onChange={(e) => set("title", e.target.value)} />
        </label>
        <label className="block text-sm"><span className="mb-1 block font-medium">Author</span>
          <Input name="author" value={d.author} onChange={(e) => set("author", e.target.value)} />
        </label>
        <label className="block text-sm"><span className="mb-1 block font-medium">Subject</span>
          <Select name="subject" value={d.subject} onChange={(e) => set("subject", e.target.value as Subject)}>
            {SUBJECTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </label>
        <label className="block text-sm"><span className="mb-1 block font-medium">One-line summary</span>
          <Input name="summary" value={d.summary} maxLength={300} onChange={(e) => set("summary", e.target.value)} placeholder="Shown in the list" />
        </label>
      </section>
      <section className={`${panel} space-y-3`}>
        <h2 className="font-semibold">Introduction</h2>
        <p className="text-sm text-muted-foreground">Why students should read it. Use the toolbar for headings, lists and links.</p>
        <MarkdownEditor name="bodyMd" value={d.bodyMd} onChange={(v) => set("bodyMd", v)} rows={10} />
      </section>
      <section className={`${panel} space-y-3`}>
        <h2 className="font-semibold">Cover (optional)</h2>
        <CoverImageField name="imageUrl" value={d.imageUrl} onChange={(v) => set("imageUrl", v)} />
      </section>
      <FormError error={save.error ?? del.error} />
      <div className="sticky bottom-0 -mx-4 flex items-center justify-end gap-2 border-t bg-background/95 p-3 backdrop-blur">
        {id && (
          <button type="button" className="mr-auto text-sm text-red-700 underline" disabled={del.isPending}
            onClick={() => { if (window.confirm(`Delete “${d.title}”? Its reads and comments are deleted too.`)) del.mutate(); }}>
            Delete this book
          </button>
        )}
        <Button asChild variant="outline"><Link to="/admin/library">{id && status.saved ? "Close" : "Cancel"}</Link></Button>
        <SaveButton pending={save.isPending} dirty={id ? status.dirty : undefined} saved={status.saved}>{id ? "Save changes" : "Add book"}</SaveButton>
      </div>
    </form>
  );
}
