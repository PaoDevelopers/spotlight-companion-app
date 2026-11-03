import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/api";
import { uploadImage } from "@/lib/upload";

/** A cover picture: choose a file from the device (or paste an address), with a thumbnail and a remove button. */
export function CoverImageField({ name, value, onChange }: { name: string; value: string; onChange: (v: string) => void }) {
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  async function pick(f?: File) {
    if (!f) return;
    setBusy(true);
    setProblem("");
    try {
      onChange(await uploadImage(f));
    } catch (e) {
      setProblem(errorMessage(e));
    }
    setBusy(false);
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={busy} onClick={() => file.current?.click()}>
          {busy ? "Uploading…" : value ? "Change picture" : "Choose a picture"}
        </Button>
        {value && <Button type="button" variant="outline" onClick={() => onChange("")}>Remove</Button>}
        <input ref={file} type="file" accept="image/*" hidden aria-label="Choose a cover picture" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
        <Input name={name} type="text" inputMode="url" value={value} onChange={(e) => onChange(e.target.value)} placeholder="…or paste an address (https://…)" className="min-w-0 flex-1" />
      </div>
      {problem && <p role="alert" className="text-sm text-red-700">{problem}</p>}
      {value && <img src={value} alt="Cover preview" className="h-28 rounded-md object-cover" onError={(e) => (e.currentTarget.style.display = "none")} onLoad={(e) => (e.currentTarget.style.display = "")} />}
    </div>
  );
}
