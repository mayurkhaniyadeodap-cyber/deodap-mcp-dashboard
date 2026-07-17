import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Role, User } from "@/types/app";

/**
 * Auth store — holds the access token and current user.
 *
 * Phase 1: token kept in memory (Zustand) with a localStorage fallback (via the
 * persist middleware) so a refresh keeps the session.
 * // Phase 2: switch to an httpOnly cookie and drop token persistence here.
 */
interface AuthState {
  token: string | null;
  user: User | null;
  setAuth: (token: string, user: User) => void;
  setUser: (user: User) => void;
  clear: () => void;
  isAuthenticated: () => boolean;
  hasRole: (...roles: Role[]) => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      setAuth: (token, user) => set({ token, user }),
      setUser: (user) => set({ user }),
      clear: () => set({ token: null, user: null }),
      isAuthenticated: () => Boolean(get().token),
      hasRole: (...roles) => {
        const role = get().user?.role;
        return role ? roles.includes(role) : false;
      },
    }),
    {
      name: "deodap-auth", // localStorage key
      partialize: (state) => ({ token: state.token, user: state.user }),
    },
  ),
);
