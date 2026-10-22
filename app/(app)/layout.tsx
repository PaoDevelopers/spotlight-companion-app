import Link from "next/link";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const NAV = [["/", "Home"], ["/events", "Events"], ["/scan", "Scan"], ["/exhibits", "Exhibits"], ["/leaderboard", "Board"], ["/me", "Me"]];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="mx-auto min-h-screen max-w-2xl pb-20">
      <header className="flex items-center justify-between p-4">
        <span className="font-bold">Spotlight Month</span>
        {user.role !== "student" && <Link href="/admin" className="text-sm underline">Teacher portal</Link>}
      </header>
      <div className="px-4">{children}</div>
      <nav className="fixed inset-x-0 bottom-0 border-t bg-white">
        <ul className="mx-auto flex max-w-2xl justify-around">
          {NAV.map(([href, label]) => (
            <li key={href}><Link href={href} className="block px-3 py-4 text-sm">{label}</Link></li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
