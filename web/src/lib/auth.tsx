import { createContext, useContext, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, useLocation } from "react-router-dom";
import { api, ApiError } from "./api";
import type { Me } from "./types";

interface AuthState {
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<unknown>;
}
const Ctx = createContext<AuthState>({ me: null, loading: true, refresh: async () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return await api.get<Me>("/api/me");
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
  return <Ctx.Provider value={{ me: q.data ?? null, loading: q.isPending, refresh: () => qc.invalidateQueries({ queryKey: ["me"] }) }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);

/** Sends signed-out visitors to the login page and brings them back afterwards. */
export function RequireUser({ children, staff }: { children: ReactNode; staff?: boolean }) {
  const { me, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <p className="p-6 text-muted-foreground">Loading…</p>;
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (staff && me.role === "student") return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function signOutCleanup() {
  navigator.serviceWorker?.controller?.postMessage("clear");
}
