import type { User } from "@/types/app";
import { API_BASE } from "@/lib/basePath";

/**
 * Which "door" this page was opened through, detected at runtime (one build serves both):
 *
 * - "central-sso": opened inside DeoDap Central through its workspace gateway. The gateway marks
 *   EVERY response with `X-Workspace-Gateway` and signs each API call in with the Central user's
 *   account, so the browser holds no MCP token. No login page, no Logout; profile and password are
 *   managed in DeoDap Central. A 401 here always means "your DeoDap Central session has ended".
 * - "standalone": opened directly (e.g. http://127.0.0.1:8010). Responses never carry that header;
 *   the app behaves exactly as standalone MCP: its normal login page and stored login token.
 */
export type AuthMode = "central-sso" | "standalone";

/** Response header set by the DeoDap Central workspace gateway (and only by it). */
export const GATEWAY_HEADER = "x-workspace-gateway";

/** Stand-in for "signed in" in the auth store. NOT a credential (the gateway adds the real one). */
export const SSO_SESSION_MARKER = "central-sso";

export interface AuthDetection {
  mode: AuthMode;
  /** HTTP status of the detection call (0 when the request itself failed). */
  status: number;
  /** The signed-in user, when the gateway answered 200. */
  user: User | null;
}

let mode: AuthMode = "standalone";

/** True when the page runs inside DeoDap Central (set once, by detectAuthMode, before rendering). */
export function isCentralSso(): boolean {
  return mode === "central-sso";
}

/** For tests only. */
export function setAuthModeForTests(next: AuthMode): void {
  mode = next;
}


/**
 * Ask GET /api/me WITHOUT any stored token. Only the gateway can make this succeed (it signs the
 * request in), and only the gateway adds the X-Workspace-Gateway header, so:
 *   header present (any value) -> "central-sso" (200 = signed in; 401 = Central session ended)
 *   header absent              -> "standalone" (direct access; show MCP's normal login)
 */
export async function detectAuthMode(fetchFn: typeof fetch = fetch): Promise<AuthDetection> {
  try {
    const response = await fetchFn(`${API_BASE}/me`, {
      headers: { Accept: "application/json" },
      credentials: "same-origin",
    });
    if (!response.headers.has(GATEWAY_HEADER)) {
      mode = "standalone";
      // 200 here = the httpOnly session cookie from an earlier login is still valid.
      const user = response.ok ? ((await response.json()) as User) : null;
      return { mode, status: response.status, user };
    }
    mode = "central-sso";
    const user = response.ok ? ((await response.json()) as User) : null;
    return { mode, status: response.status, user };
  } catch {
    mode = "standalone"; // service unreachable: the normal app shows its own errors
    return { mode, status: 0, user: null };
  }
}
