import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/api";
import { uploadStudentImage } from "@/lib/upload";

/** Pick a photo (the camera on a phone), add an optional caption, and send it. `attach` receives the uploaded picture's id. */
export function PhotoAdder({ kind, label, attach, onDone }: { kind: "work" | "hunt"; label: string; attach: (imageId: number, caption: string) => Promise<unknown>; onDone?: () => void }) {
  const file = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const send = useMutation({
    mutationFn: async () => {
      if (!picked) return;
      const id = await uploadStudentImage(picked, kind);
      await attach(id, caption.trim());
    },
    onSuccess: () => {
      setPicked(null);
      setCaption("");
      if (file.current) file.current.value = "";
      onDone?.();
    },
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (picked) send.mutate(); }} className="space-y-2 rounded-lg bg-card p-3 shadow-sm">
      <label className="block text-sm font-medium">
        {label}
        <input ref={file} type="file" accept="image/*" className="mt-1 block w-full text-sm" onChange={(e) => setPicked(e.target.files?.[0] ?? null)} />
      </label>
      {picked && <Input value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={200} placeholder="Add a caption (optional)" aria-label="Caption" />}
      {send.isError && <p role="alert" className="text-sm text-red-700">{errorMessage(send.error)}</p>}
      <Button disabled={!picked || send.isPending}>{send.isPending ? "Sending…" : "Send photo"}</Button>
    </form>
  );
}
