import { create } from "zustand";
import { persist } from "zustand/middleware";
import { isCentralSso, SSO_SESSION_MARKER } from "@/lib/authMode";
import type { Role, User } from "@/types/app";

/**
 * Auth store — holds the access token and current user.
 *
 * Phase 1: token kept in memory (Zustand) with a localStorage fallback (via the
 * persist middleware) so a refresh keeps the session.
 * // Phase 2: switch to an httpOnly cookie and drop token persistence here.
 *
 * Inside DeoDap Central (see lib/authMode) nothing is persisted: the user is re-read from /api/me
 * on every load, so a different Central user in the same browser never sees a previous user's
 * identity, and the browser never holds an MCP token.
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
      name: "deodap-auth", // localStorage key (standalone login only)
      partialize: (state) => (isCentralSso() ? {} : { token: state.token, user: state.user }),
    },
  ),
);

/**
 * Switch the store to the DeoDap Central door: drop any login stored by a former standalone
 * session in this origin, and hold only the user the gateway signed in (no token).
 */
export function enterCentralSso(user: User | null): void {
  try {
    window.localStorage.removeItem("deodap-auth");
    window.localStorage.removeItem("deodap-auth-central-sso"); // key used by the former build-time mode
  } catch {
    /* storage unavailable: nothing to clean */
  }
  if (user) {
    useAuthStore.getState().setAuth(SSO_SESSION_MARKER, user);
  } else {
    useAuthStore.getState().clear();
  }
}
