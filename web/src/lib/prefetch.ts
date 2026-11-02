import type { QueryClient } from "@tanstack/react-query";
import { api } from "./api";

// Each import() is started at most once, so calling these early (on hover, or when a teacher signs in) just warms the
// browser's cache. Without this, opening the teacher portal waits for the page code, then the data, one after the other.
let events: Promise<typeof import("@/pages/admin/Events")> | undefined;
let dashboard: Promise<typeof import("@/pages/admin/Dashboard")> | undefined;
export const loadAdminEvents = () => (events ??= import("@/pages/admin/Events"));
export const loadDashboard = () => (dashboard ??= import("@/pages/admin/Dashboard"));

/** Start everything the teacher portal's first screen needs, in parallel. Safe to call repeatedly. */
export function prefetchAdmin(qc: QueryClient) {
  void loadDashboard();
  void loadAdminEvents();
  void qc.prefetchQuery({ queryKey: ["auth-config"], queryFn: () => api.get<{ mode: string }>("/api/auth/config"), staleTime: 5 * 60_000 });
  void qc.prefetchQuery({ queryKey: ["admin-stats"], queryFn: () => api.get("/api/admin/stats"), staleTime: 30_000 });
}
