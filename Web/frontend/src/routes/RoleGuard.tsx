import type { ReactNode } from "react";
import { useAuthStore } from "@/store/auth.store";
import type { Role } from "@/types/app";

interface RoleGuardProps {
  /** Roles allowed to see the children. */
  allow: Role[];
  children: ReactNode;
  /** Rendered instead when the current role isn't allowed (default: nothing). */
  fallback?: ReactNode;
}

/**
 * Conditionally renders children based on the current user's role. Used to hide
 * role-restricted UI (e.g. Export / Configuration writes for a Viewer).
 *
 * Guards should HIDE *and* disable — never rely on hiding alone; role-restricted
 * actions must also be enforced by the backend (require_role).
 */
export function RoleGuard({ allow, children, fallback = null }: RoleGuardProps) {
  const role = useAuthStore((s) => s.user?.role);
  const allowed = role ? allow.includes(role) : false;
  return <>{allowed ? children : fallback}</>;
}

/** Hook form of the guard for enabling/disabling (not just hiding) elements. */
export function useHasRole(...roles: Role[]): boolean {
  return useAuthStore((s) => (s.user?.role ? roles.includes(s.user.role) : false));
}
