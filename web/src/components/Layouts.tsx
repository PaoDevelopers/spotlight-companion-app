import { Suspense, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { prefetchAdmin } from "@/lib/prefetch";
import { api } from "@/lib/api";
import { confirmLeave } from "@/lib/unsaved";
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

/** The page one level up: where "Back" goes, always, however the person arrived (a link, an NFC tap, a bookmark). */
export function parentOf(pathname: string): string {
  const p = pathname.replace(/\/+$/, "");
  if (p.startsWith("/admin/exhibitions")) return "/admin/exhibits"; // exhibitions are managed from the Exhibits page
  const up = p.slice(0, p.lastIndexOf("/"));
  return up === "" ? "/" : up;
}

const PAGE_NAMES: Record<string, string> = {
  "/": "Home",
  "/events": "Events",
  "/exhibits": "Exhibits",
  "/admin": "the Teacher portal",
  "/admin/events": "Events",
  "/admin/exhibits": "Exhibits",
};
const pageName = (path: string) =>
  PAGE_NAMES[path] ?? (/^\/(admin\/)?events\/\d+$/.test(path) ? "the event" : /^\/(admin\/)?exhibits\/[^/]+$/.test(path) ? "the exhibit" : "the previous page");

/** Goes up to the parent page (for example from an event's edit page to the event, from the event to the list of events). */
export function BackButton({ home }: { home: string }) {
  const nav = useNavigate();
  const loc = useLocation();
  if (loc.pathname === home) return null;
  const up = parentOf(loc.pathname);
  return (
    <button
      type="button"
      onClick={() => confirmLeave() && nav(up)}
      className="no-print mb-3 inline-flex items-center gap-1 rounded-md py-1 pr-2 text-sm text-muted-foreground hover:text-foreground"
    >
      <span aria-hidden>←</span> Back to {pageName(up)}
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

// Plain words for the menu: what a teacher wants to do, not what the system calls it.
const ADMIN_NAV: [string, string][] = [
  ["/admin/events", "Events"],
  ["/admin/exhibits", "Exhibits"],
  ["/admin/competitions", "Results"],
  ["/admin/awards", "Awards"],
  ["/admin/roster", "Login codes"],
  ["/admin/help", "Help"],
];

/** A link that asks first if the page being left has unsaved changes. */
function GuardedNavLink({ to, children, className }: { to: string; children: React.ReactNode; className?: string | ((p: { isActive: boolean }) => string) }) {
  return (
    <NavLink to={to} end={to === "/admin"} className={className} onClick={(e) => { if (!confirmLeave()) e.preventDefault(); }}>
      {children}
    </NavLink>
  );
}

export function AdminLayout({ showRoster }: { showRoster: boolean }) {
  return (
    <div className="mx-auto max-w-4xl p-4 md:px-6 lg:max-w-6xl">
      <nav aria-label="Teacher portal" className="no-print mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-b pb-3">
        <GuardedNavLink to="/admin" className="font-bold">
          Teacher portal
        </GuardedNavLink>
        {ADMIN_NAV.filter(([to]) => showRoster || to !== "/admin/roster").map(([to, label]) => (
          <GuardedNavLink key={to} to={to} className={({ isActive }) => cn("rounded px-1 underline-offset-4 hover:underline", isActive && "bg-muted font-semibold underline")}>
            {label}
          </GuardedNavLink>
        ))}
        <GuardedNavLink to="/" className="ml-auto text-sm">
          See the student view
        </GuardedNavLink>
      </nav>
      <BackButton home="/admin" />
      <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
        <Outlet />
      </Suspense>
    </div>
  );
}
