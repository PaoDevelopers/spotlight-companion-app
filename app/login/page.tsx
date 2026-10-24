import { authMode } from "@/lib/auth/config";
import { SIGNIN_ERRORS } from "@/lib/services/oidc";
import { LoginForm } from "./form";

export const dynamic = "force-dynamic";

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  const microsoft = authMode() === "entra";
  return (
    <main className="mx-auto max-w-sm p-6">
      <h1 className="text-2xl font-bold">Spotlight Month</h1>
      {microsoft ? (
        <>
          <p className="mb-4 text-slate-600">Sign in with your school Microsoft account.</p>
          {error && <p role="alert" className="mb-3 rounded bg-red-100 p-3 text-red-800">{SIGNIN_ERRORS[error] ?? SIGNIN_ERRORS.external}</p>}
          {/* A plain link: the browser must make a real navigation so the nonce cookie is set before Microsoft redirects back. */}
          <a href={`/auth/start?next=${encodeURIComponent(target)}`} className="block w-full rounded bg-slate-900 p-3 text-center font-semibold text-white">Sign in with Microsoft</a>
        </>
      ) : (
        <>
          <p className="mb-4 text-slate-600">Sign in with your school email and the code your teacher gave you.</p>
          <LoginForm next={target} />
        </>
      )}
    </main>
  );
}
