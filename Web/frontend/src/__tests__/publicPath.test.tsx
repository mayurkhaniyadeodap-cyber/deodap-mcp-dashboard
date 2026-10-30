/**
 * Serving under https://care.deodap.info/courier-billing/ (shared domain) without a second build:
 * the base path comes from the backend's <meta name="app-base-path">, and no credential is ever
 * kept in browser storage (other apps on the domain could read it).
 */
import { afterEach, describe, expect, it } from "vitest";
import { readBasePath } from "@/lib/basePath";
import { migrateStoredPreferences, STORAGE_KEYS } from "@/lib/storageKeys";
import { clearLegacyStoredLogin, COOKIE_SESSION_MARKER, useAuthStore } from "@/store/auth.store";

function docWithMeta(content: string | null): Document {
  const doc = document.implementation.createHTMLDocument("t");
  if (content !== null) {
    const meta = doc.createElement("meta");
    meta.setAttribute("name", "app-base-path");
    meta.setAttribute("content", content);
    doc.head.appendChild(meta);
  }
  return doc;
}

afterEach(() => {
  window.localStorage.clear();
  useAuthStore.setState({ token: null, user: null });
});

describe("readBasePath", () => {
  it("uses the backend's base-path meta, and the domain root without it", () => {
    expect(readBasePath(docWithMeta("/courier-billing"))).toBe("/courier-billing");
    expect(readBasePath(docWithMeta(null))).toBe("");
  });

  it("ignores anything that is not a plain path segment", () => {
    expect(readBasePath(docWithMeta("//evil.example"))).toBe("");
    expect(readBasePath(docWithMeta("/a/b"))).toBe("");
    expect(readBasePath(docWithMeta('/x"><script>'))).toBe("");
    expect(readBasePath(docWithMeta("https://evil.example"))).toBe("");
  });
});

describe("browser storage on a shared domain", () => {
  it("never writes the login to browser storage", () => {
    useAuthStore.getState().setAuth(COOKIE_SESSION_MARKER, {
      id: 1, name: "A", email: "a@deodap.in", role: "admin",
    } as never);
    const all = Object.keys(window.localStorage).map((k) => window.localStorage.getItem(k) ?? "").join(" ");
    expect(all).not.toContain("a@deodap.in");
    expect(window.localStorage.getItem("deodap-auth")).toBeNull();
  });

  it("removes a login stored by an earlier build", () => {
    window.localStorage.setItem("deodap-auth", JSON.stringify({ state: { token: "old-token" } }));
    clearLegacyStoredLogin();
    expect(window.localStorage.getItem("deodap-auth")).toBeNull();
  });

  it("moves preferences from the old generic keys to namespaced ones, once", () => {
    window.localStorage.setItem("deodap-theme", '{"state":{"theme":"light"}}');
    window.localStorage.setItem("deodap-ui", '{"state":{"sidebarCollapsed":true}}');
    migrateStoredPreferences(window.localStorage);
    expect(window.localStorage.getItem(STORAGE_KEYS.theme)).toBe('{"state":{"theme":"light"}}');
    expect(window.localStorage.getItem(STORAGE_KEYS.ui)).toBe('{"state":{"sidebarCollapsed":true}}');
    expect(window.localStorage.getItem("deodap-theme")).toBeNull();
    expect(window.localStorage.getItem("deodap-ui")).toBeNull();
  });

  it("does not overwrite a newer namespaced value with an old one", () => {
    window.localStorage.setItem(STORAGE_KEYS.theme, '{"state":{"theme":"dark"}}');
    window.localStorage.setItem("deodap-theme", '{"state":{"theme":"light"}}');
    migrateStoredPreferences(window.localStorage);
    expect(window.localStorage.getItem(STORAGE_KEYS.theme)).toBe('{"state":{"theme":"dark"}}');
  });
});
