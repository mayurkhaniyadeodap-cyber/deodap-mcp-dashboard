import axios, { AxiosError } from "axios";
import { isCentralSso } from "@/lib/authMode";
import { API_BASE, BASE_PATH } from "@/lib/basePath";
import { useAuthStore } from "@/store/auth.store";

/**
 * The single Axios instance for the whole app. Base URL comes from env and
 * defaults to the Vite /api proxy, so no backend host is hard-coded.
 * Every resource service (src/services/*) uses this client — it is the only
 * I/O boundary in the frontend.
 */
export const api = axios.create({
  // The service paths ("/dashboard", "/login", …) have NO /api prefix, so baseURL must end in
  // "/api": "/api" at the domain root, "/courier-billing/api" under the care.deodap.info
  // sub-path (lib/basePath). An empty VITE_API_BASE_URL falls back to that, never to "".
  baseURL: API_BASE,
  // X-Requested-With: the backend requires it on data-changing requests made with the session
  // cookie (a cross-site form can't send it), so cookie auth can't be used for CSRF.
  headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
});

// No Authorization header from the browser: the standalone login lives in an httpOnly cookie
// scoped to this app's API path (page scripts, including other apps sharing the domain, can't
// read it), and inside DeoDap Central the gateway signs each request in server-side.

// Response interceptor: on 401, clear auth and bounce to /login (once). Central SSO: clear only;
// ProtectedRoute then re-checks /api/me and explains how to reopen from DeoDap Central.
api.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response?.status === 401) {
      useAuthStore.getState().clear();
      const loginPath = `${BASE_PATH}/login`;
      if (!isCentralSso() && window.location.pathname !== loginPath) {
        window.location.assign(loginPath);
      }
    }
    return Promise.reject(error);
  },
);

/** Normalize an Axios error into a user-facing message. */
export function apiErrorMessage(error: unknown, fallback = "Something went wrong"): string {
  if (error instanceof AxiosError) {
    const data = error.response?.data as { error?: { message?: string }; detail?: string } | undefined;
    return data?.error?.message ?? data?.detail ?? error.message ?? fallback;
  }
  return fallback;
}
