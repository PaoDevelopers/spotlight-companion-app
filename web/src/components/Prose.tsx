import Markdown from "react-markdown";
import { cn } from "@/lib/utils";

/** Renders teacher-written Markdown. react-markdown does not render raw HTML, so the text can't inject scripts or styles. */
export function Prose({ children, className }: { children: string; className?: string }) {
  return (
    <div
      className={cn(
        "space-y-2 break-words [&_a]:underline [&_blockquote]:border-l-4 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_h2]:mt-4 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5",
        className,
      )}
    >
      <Markdown>{children}</Markdown>
    </div>
  );
}
