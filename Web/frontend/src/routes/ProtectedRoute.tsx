import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuthStore } from "@/store/auth.store";

/**
 * Gates all app routes. Unauthenticated users are redirected to /login, with
 * the attempted location preserved so login can send them back.
 */
export function ProtectedRoute() {
  const isAuthenticated = useAuthStore((s) => Boolean(s.token));
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <Outlet />;
}
