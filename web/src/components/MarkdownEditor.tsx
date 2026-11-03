import { useRef, useState } from "react";
import { Textarea } from "@/components/ui/input";
import { Prose } from "@/components/Prose";
import { errorMessage } from "@/lib/api";
import { uploadImage } from "@/lib/upload";
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
  const [busy, setBusy] = useState("");
  const [problem, setProblem] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const files = useRef<HTMLInputElement>(null);

  /** Uploads each picture and puts them into the text where the cursor was, one per paragraph. */
  async function addPictures(list: File[]) {
    const pics = list.filter((f) => f.type.startsWith("image/"));
    if (pics.length === 0) return;
    const el = ref.current;
    const at = el ? [el.selectionStart, el.selectionEnd] : [value.length, value.length];
    const lines: string[] = [];
    setProblem("");
    for (const [i, f] of pics.entries()) {
      setBusy(`Uploading picture ${i + 1} of ${pics.length}…`);
      try {
        const alt = f.name.replace(/\.[^.]+$/, "").replace(/[[\]()]/g, " ").trim() || "picture";
        lines.push(`![${alt}](${await uploadImage(f)})`);
      } catch (e) {
        setProblem(errorMessage(e));
      }
    }
    setBusy("");
    if (lines.length === 0) return;
    const before = value.slice(0, at[0]);
    const lead = before && !before.endsWith("\n\n") ? (before.endsWith("\n") ? "\n" : "\n\n") : "";
    onChange(before + lead + lines.join("\n\n") + "\n\n" + value.slice(at[1]));
  }

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
            <button type="button" title="Insert pictures" aria-label="Insert pictures" disabled={!!busy} onClick={() => files.current?.click()} className="rounded px-2 py-1 text-sm font-medium hover:bg-accent disabled:opacity-60">
              🖼 Pictures
            </button>
            {TOOLS.map((t) => (
              <button key={t.title} type="button" title={t.title} aria-label={t.title} onClick={() => apply(t)} className="rounded px-2 py-1 text-sm font-medium hover:bg-accent">
                {t.label}
              </button>
            ))}
          </span>
        )}
      </div>
      <input ref={files} type="file" accept="image/*" multiple hidden aria-label="Choose pictures" onChange={(e) => { void addPictures([...(e.target.files ?? [])]); e.target.value = ""; }} />
      {(busy || problem) && (
        <p role={problem ? "alert" : "status"} className={cn("border-b px-3 py-1 text-sm", problem ? "text-red-700" : "text-muted-foreground")}>
          {busy || problem}
        </p>
      )}
      {tab === "write" ? (
        <Textarea
          ref={ref}
          name={name}
          rows={rows}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onPaste={(e) => {
            const pics = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
            if (pics.length) { e.preventDefault(); void addPictures(pics); }
          }}
          onDrop={(e) => {
            const pics = [...e.dataTransfer.files].filter((f) => f.type.startsWith("image/"));
            if (pics.length) { e.preventDefault(); void addPictures(pics); }
          }}
          placeholder={placeholder}
          className="rounded-none border-0 focus-visible:ring-0"
        />
      ) : (
        <div className="min-h-32 p-3 text-sm" data-testid="md-preview">{value.trim() ? <Prose>{value}</Prose> : <p className="text-muted-foreground">Nothing to preview yet.</p>}</div>
      )}
    </div>
  );
}
