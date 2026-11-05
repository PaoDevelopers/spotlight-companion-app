import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { SubjectBadge } from "@/components/ui/badge";
import { CoverThumb } from "@/components/CoverThumb";
import { Prose } from "@/components/Prose";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Book, BookComment } from "@/lib/types";

const readers = (n: number) => (n === 1 ? "1 student has read this" : `${n} students have read this`);

export function Library() {
  const q = useQuery({ queryKey: ["books"], queryFn: () => api.get<{ books: Book[] }>("/api/books") });
  const books = q.data?.books ?? [];
  return (
    <div className="space-y-4">
      <div>
        <h1 className="mb-1 text-2xl font-bold">Library</h1>
        <p className="text-muted-foreground">Books recommended for Spotlight Month. Read one, tell everyone you did, and say what you thought.</p>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {books.map((b) => (
          <Link key={b.id} to={`/library/${b.id}`} className="flex items-center gap-3 rounded-lg bg-card p-3 shadow-sm">
            <CoverThumb imageUrl={b.imageUrl} markdown={b.bodyMd} />
            <div className="min-w-0 flex-1">
              <SubjectBadge subject={b.subject} />
              <span className="font-semibold">{b.iRead ? "✅ " : ""}{b.title}</span>
              <div className="text-sm text-muted-foreground">{b.author}</div>
              <div className="text-xs text-muted-foreground">
                {b.reads} read · {b.comments} {b.comments === 1 ? "comment" : "comments"}
              </div>
            </div>
          </Link>
        ))}
      </div>
      {q.data && books.length === 0 && <p className="text-muted-foreground">No books have been recommended yet.</p>}
    </div>
  );
}

function CommentBox({ bookId }: { bookId: number }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const post = useMutation({
    mutationFn: () => api.post(`/api/books/${bookId}/comments`, { body: text }),
    onSuccess: () => {
      setText("");
      qc.invalidateQueries({ queryKey: ["book", String(bookId)] });
      qc.invalidateQueries({ queryKey: ["books"] });
    },
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) post.mutate(); }} className="space-y-2">
      <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={1000} placeholder="What did you think of this book?" aria-label="Your comment" />
      <p className="text-xs text-muted-foreground">Your name and class are shown with your comment.</p>
      {post.isError && <p role="alert" className="text-sm text-red-700">{errorMessage(post.error)}</p>}
      <Button disabled={post.isPending || !text.trim()}>Post comment</Button>
    </form>
  );
}

export function BookDetail() {
  const { id = "" } = useParams();
  const { me } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["book", id], queryFn: () => api.get<{ book: Book; comments: BookComment[] }>(`/api/books/${id}`) });
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["book", id] }), qc.invalidateQueries({ queryKey: ["books"] })]);
  const toggle = useMutation({
    mutationFn: (read: boolean) => (read ? api.put(`/api/books/${id}/read`, {}) : api.del(`/api/books/${id}/read`)),
    onSuccess: refresh,
  });
  const remove = useMutation({ mutationFn: (cid: number) => api.del(`/api/comments/${cid}`), onSuccess: refresh });
  if (q.isError) return <p>Book not found.</p>;
  if (!q.data) return null;
  const { book: b, comments } = q.data;
  const staff = me && me.role !== "student";
  return (
    <article className="space-y-4">
      <div>
        <SubjectBadge subject={b.subject} />
        <h1 className="text-2xl font-bold">{b.title}</h1>
        {b.author && <p className="text-muted-foreground">by {b.author}</p>}
      </div>
      {b.imageUrl && <img src={b.imageUrl} alt={b.title} className="max-h-72 rounded-lg object-contain" onError={(e) => (e.currentTarget.style.display = "none")} />}
      {b.summary && <p className="font-medium">{b.summary}</p>}
      {b.bodyMd.trim() && <Prose>{b.bodyMd}</Prose>}

      <div className="flex flex-wrap items-center gap-3 rounded-lg bg-card p-3 shadow-sm">
        <Button
          size="lg"
          aria-pressed={b.iRead}
          disabled={toggle.isPending}
          onClick={() => toggle.mutate(!b.iRead)}
          className={cn(b.iRead ? "bg-red-700 text-white hover:bg-red-700/90" : "bg-red-600 text-white hover:bg-red-600/90")}
        >
          {b.iRead ? "✓ I've read this" : "I've read this"}
        </Button>
        <span aria-live="polite">{readers(b.reads)}</span>
        {toggle.isError && <span role="alert" className="text-sm text-red-700">{errorMessage(toggle.error)}</span>}
      </div>

      <section aria-label="Comments" className="space-y-3">
        <h2 className="text-lg font-semibold">Comments ({comments.length})</h2>
        {comments.length === 0 && <p className="text-muted-foreground">No comments yet. Be the first.</p>}
        <ul className="space-y-2">
          {comments.map((c) => (
            <li key={c.id} className="rounded-lg bg-card p-3 text-sm shadow-sm">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold">{c.name}{c.className ? ` · ${c.className}` : ""}</span>
                <span className="text-xs text-muted-foreground">{fmtDateTime(c.at)}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap break-words">{c.body}</p>
              {(c.userId === me?.id || staff) && (
                <button
                  type="button"
                  className="mt-1 text-xs text-red-700 underline"
                  disabled={remove.isPending}
                  onClick={() => { if (window.confirm("Delete this comment?")) remove.mutate(c.id); }}
                >
                  Delete
                </button>
              )}
            </li>
          ))}
        </ul>
        {remove.isError && <p role="alert" className="text-sm text-red-700">{errorMessage(remove.error)}</p>}
        <CommentBox bookId={b.id} />
      </section>
    </article>
  );
}
