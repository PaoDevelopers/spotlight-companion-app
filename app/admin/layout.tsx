import Link from "next/link";
import { authMode } from "@/lib/auth/config";
import { requireStaff } from "@/lib/session";

export const dynamic = "force-dynamic";
const NAV = [["/admin/events", "Events"], ["/admin/exhibits", "Exhibits"], ["/admin/competitions", "Competitions"], ["/admin/awards", "Awards"], ["/admin/roster", "Roster"]];
// Roster import only exists to hand out login codes, which Microsoft sign-in doesn't use.
const visible = () => NAV.filter(([h]) => authMode() !== "entra" || h !== "/admin/roster");

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireStaff();
  return (
    <div className="mx-auto max-w-4xl p-4">
      <nav className="mb-6 flex flex-wrap gap-4 border-b pb-3">
        <Link href="/admin" className="font-bold">Teacher portal</Link>
        {visible().map(([h, l]) => <Link key={h} href={h} className="underline">{l}</Link>)}
        <Link href="/" className="ml-auto text-sm">Student view</Link>
      </nav>
      {children}
    </div>
  );
}
