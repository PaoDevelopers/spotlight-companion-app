"use client";
import { useFormStatus } from "react-dom";

/** Submit button that shows progress and blocks double submits while a server action runs. */
export function SubmitButton({ children, pendingText = "Saving…", className }: { children: React.ReactNode; pendingText?: string; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button disabled={pending} className={`${className ?? ""} disabled:opacity-60`}>
      {pending ? pendingText : children}
    </button>
  );
}
