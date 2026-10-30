/**
 * The public sub-path this page is served under, e.g. "/courier-billing" for
 * https://care.deodap.info/courier-billing/ ("" when the app owns the whole domain, e.g. the
 * nip.io URL or the Vite dev server). The backend writes it into the page as
 * <meta name="app-base-path"> (only for its allow-listed sub-paths), so ONE build works at both
 * URLs: it feeds the router basename, the API base and the login redirect.
 */
const SAFE = /^\/[A-Za-z0-9][A-Za-z0-9_-]*$/;

export function readBasePath(doc: Document | undefined = typeof document === "undefined" ? undefined : document): string {
  const value = doc?.querySelector('meta[name="app-base-path"]')?.getAttribute("content") ?? "";
  return SAFE.test(value) ? value : "";
}

export const BASE_PATH = readBasePath();

/** API root for this deployment ("/courier-billing/api", or "/api" at the domain root). */
export const API_BASE = import.meta.env.VITE_API_BASE_URL || `${BASE_PATH}/api`;
