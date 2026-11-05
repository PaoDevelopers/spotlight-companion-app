import { useEffect, useId, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/api";
import { uploadStudentImage } from "@/lib/upload";

/** Pick a photo (the camera on a phone), see it, add an optional caption, and send it. `attach` receives the uploaded picture's id. */
export function PhotoAdder({ kind, label, attach, onDone }: { kind: "work" | "hunt"; label: string; attach: (imageId: number, caption: string) => Promise<unknown>; onDone?: () => void }) {
  const file = useRef<HTMLInputElement>(null);
  const id = useId();
  const [picked, setPicked] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  useEffect(() => {
    if (!picked) return setPreview(null);
    const url = URL.createObjectURL(picked);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [picked]);
  const reset = () => {
    setPicked(null);
    setCaption("");
    if (file.current) file.current.value = "";
  };
  const send = useMutation({
    mutationFn: async () => {
      if (!picked) return;
      const imageId = await uploadStudentImage(picked, kind);
      await attach(imageId, caption.trim());
    },
    onSuccess: () => {
      reset();
      onDone?.();
    },
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (picked) send.mutate(); }} className="space-y-3 rounded-xl border border-dashed bg-card p-4 shadow-sm">
      <input id={id} ref={file} type="file" accept="image/*" className="sr-only" onChange={(e) => setPicked(e.target.files?.[0] ?? null)} />
      {!picked ? (
        <label htmlFor={id} className="flex cursor-pointer flex-col items-center gap-1 rounded-lg bg-muted/50 px-4 py-6 text-center hover:bg-accent focus-within:ring-2">
          <span aria-hidden className="text-3xl">📷</span>
          <span className="font-semibold">{label}</span>
          <span className="text-sm text-muted-foreground">Tap to take a photo or choose one</span>
        </label>
      ) : (
        <>
          {preview && <img src={preview} alt="Your chosen photo" className="mx-auto max-h-64 rounded-lg object-contain" />}
          <p className="truncate text-center text-xs text-muted-foreground">{picked.name}</p>
          <Input value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={200} placeholder="Add a caption (optional)" aria-label="Caption" />
        </>
      )}
      {send.isError && <p role="alert" className="text-sm text-red-700">{errorMessage(send.error)}</p>}
      {picked && (
        <div className="flex gap-2">
          <Button className="flex-1" disabled={send.isPending}>{send.isPending ? "Sending…" : "Send photo"}</Button>
          <Button type="button" variant="outline" disabled={send.isPending} onClick={reset}>Choose another</Button>
        </div>
      )}
    </form>
  );
}
