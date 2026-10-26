import { type ReactNode } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { errorMessage } from "@/lib/api";

/** Shows a mutation's progress and error text next to a button. */
export function FormError({ error }: { error: unknown }) {
  return error ? (
    <p role="alert" className="text-sm text-red-700">
      {errorMessage(error)}
    </p>
  ) : null;
}

/** A button that says what it's doing and can't be double-clicked while it works. */
export function SaveButton({ pending, children, pendingText = "Saving…", ...p }: { pending: boolean; children: ReactNode; pendingText?: string } & ButtonProps) {
  return (
    <Button disabled={pending} {...p}>
      {pending ? pendingText : children}
    </Button>
  );
}

export const panel = "rounded-lg bg-card p-4 shadow-sm";
