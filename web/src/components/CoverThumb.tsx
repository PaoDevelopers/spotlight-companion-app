import { useState } from "react";
import { coverOf } from "@/lib/cover";
import { cn } from "@/lib/utils";

/** A small picture for a list row. It renders nothing at all when there is no picture, or if the picture cannot be loaded. */
export function CoverThumb({ imageUrl, markdown, className }: { imageUrl?: string | null; markdown?: string | null; className?: string }) {
  const url = coverOf(imageUrl, markdown);
  const [broken, setBroken] = useState(false);
  if (!url || broken) return null;
  return <img src={url} alt="" loading="lazy" onError={() => setBroken(true)} className={cn("size-14 shrink-0 rounded-md object-cover", className)} />;
}
