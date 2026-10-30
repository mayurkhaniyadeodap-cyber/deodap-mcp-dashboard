import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { isCentralSso } from "@/lib/authMode";
import { api } from "@/services/api";
import { useAuthStore } from "@/store/auth.store";

/**
 * Convenience hook over the auth store. Components read auth state and call
 * logout from here rather than touching the store directly.
 */
export function useAuth() {
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);
  const clear = useAuthStore((s) => s.clear);
  const hasRole = useAuthStore((s) => s.hasRole);
  const queryClient = useQueryClient();

  const logout = useCallback(() => {
    // End the cookie session server-side (best effort; the store is cleared regardless).
    if (!isCentralSso()) void api.post("/logout").catch(() => undefined);
    clear();
    queryClient.clear();
  }, [clear, queryClient]);

  return {
    user,
    token,
    isAuthenticated: Boolean(token),
    hasRole,
    logout,
  };
}
