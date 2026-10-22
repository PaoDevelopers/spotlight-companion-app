import { LoginForm } from "./form";

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <main className="mx-auto max-w-sm p-6">
      <h1 className="text-2xl font-bold">Spotlight Month</h1>
      <p className="mb-4 text-slate-600">Sign in with your school email and the code your teacher gave you.</p>
      <LoginForm next={next ?? "/"} />
    </main>
  );
}
