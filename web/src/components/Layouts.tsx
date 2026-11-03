import { Suspense, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { prefetchAdmin } from "@/lib/prefetch";
import { api } from "@/lib/api";
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

/**
 * Goes back to the page the person came from. If they opened this page directly (a link, an NFC tap, a reload with no
 * history), there is nothing to go back to, so it goes up one level in the site instead.
 */
export function BackButton({ home }: { home: string }) {
  const nav = useNavigate();
  const loc = useLocation();
  if (loc.pathname === home) return null;
  const up = loc.pathname.replace(/\/[^/]+\/?$/, "") || home;
  return (
    <button
      type="button"
      onClick={() => (loc.key !== "default" ? nav(-1) : nav(up.length < home.length ? home : up, { replace: true }))}
      className="no-print mb-3 inline-flex items-center gap-1 rounded-md py-1 pr-2 text-sm text-muted-foreground hover:text-foreground"
    >
      <span aria-hidden>←</span> Back
    </button>
  );
}

/** Shown the whole time an admin is looking at the app as a student, so it can never be forgotten. */
function ViewingAsBanner({ admin, student }: { admin: string; student: string }) {
  const stop = async () => {
    try {
      await api.post("/api/impersonate/stop");
    } finally {
      navigator.serviceWorker?.controller?.postMessage("clear"); // drop what was cached for that student
      window.location.assign("/admin"); // a full reload, so nothing of the student's session stays on screen
    }
  };
  return (
    <div role="status" className="no-print sticky top-0 z-50 flex flex-wrap items-center justify-between gap-2 bg-amber-300 px-4 py-2 text-sm font-medium text-slate-900">
      <span>👁 Viewing as <b>{student}</b> (you are {admin}). What you do here is done as them.</span>
      <button type="button" onClick={stop} className="rounded bg-slate-900 px-3 py-1 text-white">Exit</button>
    </div>
  );
}

export function StudentLayout() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const staff = !!me && me.role !== "student";
  // Teachers will probably open the portal soon, so fetch its code and first data while they look at this page.
  useEffect(() => {
    if (!staff) return;
    const t = window.setTimeout(() => prefetchAdmin(qc), 300);
    return () => window.clearTimeout(t);
  }, [staff, qc]);
  return (
    <div className="mx-auto min-h-screen max-w-2xl pb-20 md:max-w-3xl lg:max-w-4xl">
      {me?.viewingAs && <ViewingAsBanner admin={me.viewingAs} student={me.name} />}
      <header className="flex items-center justify-between p-4 md:px-6">
        <span className="font-bold">Spotlight Month</span>
        {me && me.role !== "student" && (
          <Link to="/admin" className="text-sm underline" onPointerEnter={() => prefetchAdmin(qc)} onFocus={() => prefetchAdmin(qc)}>
            Teacher portal
          </Link>
        )}
      </header>
      <div className="px-4 md:px-6">
        <BackButton home="/" />
        <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
          <Outlet />
        </Suspense>
      </div>
      <nav className="fixed inset-x-0 bottom-0 border-t bg-card">
        <ul className="mx-auto flex max-w-2xl justify-around md:max-w-3xl lg:max-w-4xl">
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
    <div className="mx-auto max-w-4xl p-4 md:px-6 lg:max-w-6xl">
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
      <BackButton home="/admin" />
      <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
        <Outlet />
      </Suspense>
    </div>
  );
}
