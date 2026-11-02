import { useRef, useState } from "react";
import { Textarea } from "@/components/ui/input";
import { Prose } from "@/components/Prose";
import { cn } from "@/lib/utils";

type Tool = { label: string; title: string; run: (sel: string) => { text: string; select?: [number, number] } };

const wrap = (mark: string, fallback: string): Tool["run"] => (sel) => {
  const body = sel || fallback;
  return { text: mark + body + mark, select: [mark.length, mark.length + body.length] };
};
const linePrefix = (prefix: string | ((i: number) => string), fallback: string): Tool["run"] => (sel) => ({
  text: (sel || fallback).split("\n").map((l, i) => (typeof prefix === "function" ? prefix(i) : prefix) + l).join("\n"),
});

const TOOLS: Tool[] = [
  { label: "B", title: "Bold", run: wrap("**", "bold text") },
  { label: "I", title: "Italic", run: wrap("_", "italic text") },
  { label: "H", title: "Heading", run: linePrefix("## ", "Heading") },
  { label: "• List", title: "Bulleted list", run: linePrefix("- ", "Item") },
  { label: "1. List", title: "Numbered list", run: linePrefix((i) => `${i + 1}. `, "Item") },
  { label: "❝", title: "Quote", run: linePrefix("> ", "Quote") },
  { label: "🔗", title: "Link", run: (sel) => ({ text: `[${sel || "link text"}](https://)`, select: [sel ? sel.length + 3 : 11, sel ? sel.length + 11 : 19] }) },
];

/** A textarea with a formatting toolbar and a Write/Preview switch, so teachers don't have to know Markdown. */
export function MarkdownEditor({ name, value, onChange, placeholder, rows = 10 }: { name: string; value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
  const [tab, setTab] = useState<"write" | "preview">("write");
  const ref = useRef<HTMLTextAreaElement>(null);

  function apply(tool: Tool) {
    const el = ref.current;
    if (!el) return;
    const [a, b] = [el.selectionStart, el.selectionEnd];
    const out = tool.run(value.slice(a, b));
    onChange(value.slice(0, a) + out.text + value.slice(b));
    requestAnimationFrame(() => {
      el.focus();
      const [s, e] = out.select ?? [out.text.length, out.text.length];
      el.setSelectionRange(a + s, a + e);
    });
  }

  const tabBtn = (t: "write" | "preview", label: string) => (
    <button type="button" onClick={() => setTab(t)} aria-pressed={tab === t} className={cn("rounded-md px-3 py-1 text-sm", tab === t ? "bg-primary text-primary-foreground" : "hover:bg-accent")}>
      {label}
    </button>
  );

  return (
    <div className="overflow-hidden rounded-md border border-input bg-card">
      <div className="flex flex-wrap items-center gap-1 border-b bg-muted/50 p-1.5">
        {tabBtn("write", "Write")}
        {tabBtn("preview", "Preview")}
        {tab === "write" && (
          <span className="ml-2 flex flex-wrap gap-1">
            {TOOLS.map((t) => (
              <button key={t.title} type="button" title={t.title} aria-label={t.title} onClick={() => apply(t)} className="rounded px-2 py-1 text-sm font-medium hover:bg-accent">
                {t.label}
              </button>
            ))}
          </span>
        )}
      </div>
      {tab === "write" ? (
        <Textarea ref={ref} name={name} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="rounded-none border-0 focus-visible:ring-0" />
      ) : (
        <div className="min-h-32 p-3 text-sm">{value.trim() ? <Prose>{value}</Prose> : <p className="text-muted-foreground">Nothing to preview yet.</p>}</div>
      )}
    </div>
  );
}
