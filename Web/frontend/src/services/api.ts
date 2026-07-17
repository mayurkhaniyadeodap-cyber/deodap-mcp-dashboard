import axios, { AxiosError } from "axios";
import { useAuthStore } from "@/store/auth.store";

/**
 * The single Axios instance for the whole app. Base URL comes from env and
 * defaults to the Vite /api proxy, so no backend host is hard-coded.
 * Every resource service (src/services/*) uses this client — it is the only
 * I/O boundary in the frontend.
 */
export const api = axios.create({
  // `||` not `??`: the service paths ("/dashboard", "/login", …) have NO /api
  // prefix, so baseURL MUST resolve to "/api". An empty VITE_API_BASE_URL ("")
  // would otherwise drop the prefix and silently break every call in the built
  // bundle (a bug no server-side curl catches). Unset/empty → "/api" (same-origin).
  baseURL: import.meta.env.VITE_API_BASE_URL || "/api",
  headers: { "Content-Type": "application/json" },
});

// Request interceptor: attach the bearer token if present.
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor: on 401, clear auth and bounce to /login (once).
api.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response?.status === 401) {
      useAuthStore.getState().clear();
      if (window.location.pathname !== "/login") {
        window.location.assign("/login");
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
