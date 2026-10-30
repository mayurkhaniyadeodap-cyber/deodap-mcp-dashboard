import { create } from "zustand";
import { SSO_SESSION_MARKER } from "@/lib/authMode";
import type { Role, User } from "@/types/app";

/** Stand-in for "signed in" with the httpOnly session cookie. NOT a credential. */
export const COOKIE_SESSION_MARKER = "cookie-session";

/**
 * Auth store — who is signed in. Memory only, nothing is written to browser storage:
 *   - standalone login: the credential is an httpOnly cookie scoped to this app's API path
 *     (set by POST /api/login). Page scripts can't read it — important on care.deodap.info,
 *     where other apps share the browser origin — and on reload the user is restored from
 *     GET /api/me (main.tsx). `token` holds COOKIE_SESSION_MARKER;
 *   - inside DeoDap Central: the gateway signs each request in; `token` holds SSO_SESSION_MARKER.
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

export const useAuthStore = create<AuthState>()((set, get) => ({
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
}));

/** Remove logins stored in browser storage by earlier builds (they held a readable token). */
export function clearLegacyStoredLogin(): void {
  try {
    window.localStorage.removeItem("deodap-auth");
    window.localStorage.removeItem("deodap-auth-central-sso"); // key used by the former build-time mode
  } catch {
    /* storage unavailable: nothing to clean */
  }
}

/**
 * Switch the store to the DeoDap Central door: drop any login stored by a former standalone
 * session in this origin, and hold only the user the gateway signed in (no token).
 */
export function enterCentralSso(user: User | null): void {
  clearLegacyStoredLogin();
  if (user) {
    useAuthStore.getState().setAuth(SSO_SESSION_MARKER, user);
  } else {
    useAuthStore.getState().clear();
  }
}
