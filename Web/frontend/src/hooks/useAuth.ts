import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
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
