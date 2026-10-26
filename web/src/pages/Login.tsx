import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";

const SIGNIN_ERRORS: Record<string, string> = {
  external: "Sign-in failed at Microsoft. Please try again.",
  expired: "Sign-in session expired. Please try again.",
  token: "Microsoft's sign-in response could not be verified.",
  nonce: "This sign-in did not match the one that started. Please try again.",
  bad_email: "Your account has no usable email address.",
  domain: "Please sign in with a school account.",
};

// Only same-site paths, so a crafted link can't send people to another website after sign-in.
export function safeNext(next: string | null) {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}

export default function Login() {
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const cfg = useQuery({ queryKey: ["auth-config"], queryFn: () => api.get<{ mode: "roster" | "entra" }>("/api/auth/config") });

  return (
    <main className="mx-auto max-w-sm p-6">
      <h1 className="text-2xl font-bold">Spotlight Month</h1>
      {cfg.isPending ? null : cfg.data?.mode === "entra" ? (
        <>
          <p className="mb-4 text-muted-foreground">Sign in with your school Microsoft account.</p>
          {params.get("error") && (
            <p role="alert" className="mb-3 rounded bg-red-100 p-3 text-red-800">
              {SIGNIN_ERRORS[params.get("error")!] ?? SIGNIN_ERRORS.external}
            </p>
          )}
          {/* A real link, not a fetch: the browser must navigate so the nonce cookie is set before Microsoft redirects back. */}
          <a href={`/auth/start?next=${encodeURIComponent(next)}`} className="block w-full rounded-md bg-primary p-3 text-center font-semibold text-primary-foreground">
            Sign in with Microsoft
          </a>
        </>
      ) : (
        <>
          <p className="mb-4 text-muted-foreground">Sign in with your school email and the code your teacher gave you.</p>
          <CodeForm next={next} />
        </>
      )}
    </main>
  );
}

function CodeForm({ next }: { next: string }) {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setPending(true);
    setError("");
    try {
      await api.post("/api/auth/login", { email: String(f.get("email")), code: String(f.get("code")) });
      await refresh();
      navigate(next, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <Input name="email" type="email" required placeholder="School email" autoComplete="username" />
      <Input name="code" required placeholder="Login code" autoComplete="one-time-code" autoCapitalize="characters" className="uppercase tracking-widest" />
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      <Button disabled={pending} className="w-full">
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
