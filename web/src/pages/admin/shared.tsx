import { useEffect, useState, type ReactNode } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { errorMessage } from "@/lib/api";
import { setUnsaved } from "@/lib/unsaved";

/** Shows a mutation's error text, in plain words. */
export function FormError({ error }: { error: unknown }) {
  return error ? (
    <p role="alert" className="text-sm text-red-700">
      {errorMessage(error)}
    </p>
  ) : null;
}

/**
 * The save button of a form. It always says where things stand:
 *  - "Saving…" while the request runs,
 *  - "✓ Saved" (and inactive) when what is on screen is what was saved,
 *  - the normal label (active) when something has changed,
 * so nobody has to wonder whether a click did anything. A form that has no "saved" state yet (a brand-new item) just
 * leaves `dirty` out and gets the normal label.
 */
export function SaveButton({
  pending,
  children,
  pendingText = "Saving…",
  dirty,
  saved,
  savedText = "✓ Saved",
  ...p
}: { pending: boolean; children: ReactNode; pendingText?: string; dirty?: boolean; saved?: boolean; savedText?: string } & ButtonProps) {
  // `disabled` comes last in the first two so nothing the caller passes can make an inactive button clickable
  if (pending) return <Button {...p} disabled>{pendingText}</Button>;
  if (dirty === false) {
    return (
      <Button type="submit" variant={saved ? "success" : "outline"} {...p} disabled aria-live="polite">
        {saved ? savedText : "No changes to save"}
      </Button>
    );
  }
  return <Button {...p}>{children}</Button>;
}

/**
 * Tracks whether a form has unsaved changes. Call `markSaved(snapshot)` with the values that were just saved; `dirty` is
 * then false until they change again. Also tells the app, so leaving the page asks first (see lib/unsaved).
 * `ready` is false while the form is still loading its values from the server.
 */
export function useDraftStatus<T>(draft: T, ready: boolean) {
  const current = JSON.stringify(draft);
  const [base, setBase] = useState<string | null>(null); // what is stored (the loaded values, then whatever was last saved)
  const [savedAs, setSavedAs] = useState<string | null>(null); // what the last successful save wrote, if any
  useEffect(() => {
    if (ready && base === null) setBase(current); // the loaded values are the starting point
  }, [ready, base, current]);
  const dirty = base !== null && current !== base;
  useEffect(() => {
    setUnsaved(dirty);
    return () => setUnsaved(false);
  }, [dirty]);
  return {
    dirty,
    // "Saved" while the form still shows exactly what was last saved, including after changing something and changing it back
    saved: savedAs !== null && savedAs === current,
    /** Call after a successful save with what was saved. */
    markSaved: (savedDraft: T = draft) => {
      const snap = JSON.stringify(savedDraft);
      setBase(snap);
      setSavedAs(snap);
    },
  };
}

export const panel = "rounded-lg bg-card p-4 shadow-sm";
