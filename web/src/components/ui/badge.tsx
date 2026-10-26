import { cn } from "@/lib/utils";

const tones: Record<string, string> = { physics: "bg-sky-100", cs: "bg-violet-100", both: "bg-emerald-100" };

export function SubjectBadge({ subject, className }: { subject: string; className?: string }) {
  return <span className={cn("mr-2 rounded px-2 py-0.5 text-xs", tones[subject] ?? "bg-slate-100", className)}>{subject}</span>;
}
