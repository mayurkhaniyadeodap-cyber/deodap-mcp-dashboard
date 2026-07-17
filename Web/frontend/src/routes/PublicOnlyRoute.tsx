import { Navigate, Outlet } from "react-router-dom";
import { useAuthStore } from "@/store/auth.store";

/** Keeps already-authenticated users out of /login (sends them to the app). */
export function PublicOnlyRoute() {
  const isAuthenticated = useAuthStore((s) => Boolean(s.token));
  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }
  return <Outlet />;
}
