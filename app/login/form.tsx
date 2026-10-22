"use client";
import { useActionState } from "react";
import { login } from "../actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(login, null);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="next" value={next} />
      <input name="email" type="email" required placeholder="School email" autoComplete="username" className="w-full rounded border p-3" />
      <input name="code" required placeholder="Login code" autoComplete="one-time-code" autoCapitalize="characters" className="w-full rounded border p-3 uppercase tracking-widest" />
      {state?.error && <p role="alert" className="text-red-700">{state.error}</p>}
      <button disabled={pending} className="w-full rounded bg-slate-900 p-3 font-semibold text-white disabled:opacity-60">{pending ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}
