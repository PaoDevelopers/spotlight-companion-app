import { Link, NavLink, Outlet } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";

const NAV: [string, string][] = [
  ["/", "Home"],
  ["/events", "Events"],
  ["/scan", "Scan"],
  ["/exhibits", "Exhibits"],
  ["/leaderboard", "Board"],
  ["/me", "Me"],
];

export function StudentLayout() {
  const { me } = useAuth();
  return (
    <div className="mx-auto min-h-screen max-w-2xl pb-20">
      <header className="flex items-center justify-between p-4">
        <span className="font-bold">Spotlight Month</span>
        {me && me.role !== "student" && (
          <Link to="/admin" className="text-sm underline">
            Teacher portal
          </Link>
        )}
      </header>
      <div className="px-4">
        <Outlet />
      </div>
      <nav className="fixed inset-x-0 bottom-0 border-t bg-card">
        <ul className="mx-auto flex max-w-2xl justify-around">
          {NAV.map(([to, label]) => (
            <li key={to}>
              <NavLink to={to} end={to === "/"} className={({ isActive }) => cn("block px-3 py-4 text-sm", isActive && "font-semibold underline")}>
                {label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

const ADMIN_NAV: [string, string][] = [
  ["/admin/events", "Events"],
  ["/admin/exhibits", "Exhibits"],
  ["/admin/competitions", "Competitions"],
  ["/admin/awards", "Awards"],
  ["/admin/roster", "Roster"],
];

export function AdminLayout({ showRoster }: { showRoster: boolean }) {
  return (
    <div className="mx-auto max-w-4xl p-4">
      <nav className="no-print mb-6 flex flex-wrap gap-4 border-b pb-3">
        <Link to="/admin" className="font-bold">
          Teacher portal
        </Link>
        {ADMIN_NAV.filter(([to]) => showRoster || to !== "/admin/roster").map(([to, label]) => (
          <Link key={to} to={to} className="underline">
            {label}
          </Link>
        ))}
        <Link to="/" className="ml-auto text-sm">
          Student view
        </Link>
      </nav>
      <Outlet />
    </div>
  );
}
