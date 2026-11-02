import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import "./index.css";
import { AdminLayout, StudentLayout } from "@/components/Layouts";
import { AuthProvider, RequireUser } from "@/lib/auth";
import { api } from "@/lib/api";
import { loadAdminEvents, loadDashboard } from "@/lib/prefetch";
import Login from "@/pages/Login";
import Home from "@/pages/Home";
import { Events, EventDetail } from "@/pages/Events";
import { CheckinLink, Scan } from "@/pages/Scan";
const exhibitsPage = import("@/pages/Exhibits");
const Exhibits = lazy(() => exhibitsPage.then((m) => ({ default: m.Exhibits })));
const ExhibitDetail = lazy(() => exhibitsPage.then((m) => ({ default: m.ExhibitDetail })));
import Leaderboard from "@/pages/Leaderboard";
import Me from "@/pages/Me";
const Dashboard = lazy(() => loadDashboard());
const AdminEvents = lazy(() => loadAdminEvents().then((m) => ({ default: m.AdminEvents })));
const AdminEventDetail = lazy(() => loadAdminEvents().then((m) => ({ default: m.AdminEventDetail })));
const AdminDisplay = lazy(() => loadAdminEvents().then((m) => ({ default: m.AdminDisplay })));
const AdminScanPasses = lazy(() => loadAdminEvents().then((m) => ({ default: m.AdminScanPasses })));
const AdminSheet = lazy(() => loadAdminEvents().then((m) => ({ default: m.AdminSheet })));
const AdminEventEdit = lazy(() => import("@/pages/admin/EventEditor").then((m) => ({ default: m.AdminEventEdit })));
const AdminExhibits = lazy(() => import("@/pages/admin/Exhibits"));
const AdminCompetitions = lazy(() => import("@/pages/admin/Competitions"));
const AdminAwards = lazy(() => import("@/pages/admin/Awards"));
const Roster = lazy(() => import("@/pages/admin/Roster"));

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });

function Admin() {
  const cfg = useQuery({ queryKey: ["auth-config"], queryFn: () => api.get<{ mode: string }>("/api/auth/config") });
  // The roster page only exists to hand out login codes, which Microsoft sign-in doesn't use.
  return (
    <RequireUser staff>
      <AdminLayout showRoster={cfg.data?.mode !== "entra"} />
    </RequireUser>
  );
}

function App() {
  return (
    <Suspense fallback={<p className="p-6 text-muted-foreground">Loading…</p>}>
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/c/:code" element={<RequireUser><CheckinLink /></RequireUser>} />
      <Route element={<RequireUser><StudentLayout /></RequireUser>}>
        <Route index element={<Home />} />
        <Route path="events" element={<Events />} />
        <Route path="events/:id" element={<EventDetail />} />
        <Route path="scan" element={<Scan />} />
        <Route path="exhibits" element={<Exhibits />} />
        <Route path="exhibits/:slug" element={<ExhibitDetail />} />
        <Route path="leaderboard" element={<Leaderboard />} />
        <Route path="me" element={<Me />} />
      </Route>
      <Route path="admin" element={<Admin />}>
        <Route index element={<Dashboard />} />
        <Route path="events" element={<AdminEvents />} />
        <Route path="events/new" element={<AdminEventEdit />} />
        <Route path="events/:id" element={<AdminEventDetail />} />
        <Route path="events/:id/edit" element={<AdminEventEdit />} />
        <Route path="events/:id/sheet" element={<AdminSheet />} />
        <Route path="events/:id/display" element={<AdminDisplay />} />
        <Route path="events/:id/scan" element={<AdminScanPasses />} />
        <Route path="exhibits" element={<AdminExhibits />} />
        <Route path="competitions" element={<AdminCompetitions />} />
        <Route path="awards" element={<AdminAwards />} />
        <Route path="roster" element={<Roster />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
