/**
 * The two doors, decided at runtime from GET /api/me (no build switch):
 *   - direct access (no X-Workspace-Gateway header) -> MCP's normal login page;
 *   - inside DeoDap Central (header present, any value) -> single sign-on mode, and every 401 means
 *     "Your DeoDap Central session has ended" (the login page is never shown inside the gateway).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DesktopSidebar as Sidebar } from "@/components/layout/Sidebar";
import { ChangePasswordCard } from "@/components/shared/ChangePasswordCard";
import { ToastProvider } from "@/components/ui/toast";
import { detectAuthMode, isCentralSso, setAuthModeForTests, SSO_SESSION_MARKER } from "@/lib/authMode";
import { LoginRoute } from "@/routes/LoginRoute";
import { ProtectedRoute } from "@/routes/ProtectedRoute";
import { api } from "@/services/api";
import { enterCentralSso, useAuthStore } from "@/store/auth.store";
import type { User } from "@/types/app";

const USER = { id: 7, name: "Logistic Admin", email: "logistic@deodap.com", role: "admin" } as User;

/** A minimal fetch Response for detectAuthMode. */
function fakeFetch(status: number, headers: Record<string, string> = {}, body: unknown = null) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => body,
  })) as unknown as typeof fetch;
}

function http401(): AxiosError {
  const response = { status: 401, data: { detail: "Not authenticated" }, statusText: "", headers: {},
                     config: { headers: {} } } as unknown as AxiosResponse;
  return new AxiosError("Unauthorized", "ERR_BAD_REQUEST", undefined, undefined, response);
}

function providers(children: ReactNode) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}

/** The app's real door logic: /login (LoginRoute) and the protected area (ProtectedRoute).
 *  (A plain MemoryRouter: React Router's data router cannot navigate under jsdom + Node fetch.) */
function renderApp(path: string) {
  return render(
    providers(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/login" element={<LoginRoute />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<div>MCP dashboard content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    ),
  );
}

const loginFormShown = () => screen.queryByLabelText("Password") !== null;

beforeEach(() => {
  setAuthModeForTests("standalone");
  useAuthStore.setState({ token: null, user: null });
  window.localStorage.clear();
});
afterEach(() => cleanup());

describe("runtime detection (GET /api/me without any stored token)", () => {
  it("401 WITHOUT the gateway header: direct access -> standalone", async () => {
    const detection = await detectAuthMode(fakeFetch(401));
    expect(detection).toEqual({ mode: "standalone", status: 401, user: null });
    expect(isCentralSso()).toBe(false);
  });

  it("200 WITH the gateway header: inside DeoDap Central -> single sign-on, user loaded", async () => {
    const detection = await detectAuthMode(fakeFetch(200, { "X-Workspace-Gateway": "1" }, USER));
    expect(detection).toEqual({ mode: "central-sso", status: 200, user: USER });
    expect(isCentralSso()).toBe(true);
  });

  it.each(["1", "denied", "anything"])(
    "401 WITH the gateway header (%s) -> single sign-on (session ended), never standalone",
    async (value) => {
      const detection = await detectAuthMode(fakeFetch(401, { "X-Workspace-Gateway": value }));
      expect(detection.mode).toBe("central-sso");
      expect(detection.user).toBeNull();
    },
  );

  it("sends no stored token with the detection call", async () => {
    useAuthStore.setState({ token: "stored-standalone-token", user: USER });
    const fetchFn = fakeFetch(401);
    await detectAuthMode(fetchFn);
    const init = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    expect(JSON.stringify(init.headers)).not.toContain("stored-standalone-token");
  });

  it("an unreachable service -> standalone (the normal app reports its own errors)", async () => {
    const failing = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    expect((await detectAuthMode(failing)).mode).toBe("standalone");
  });
});

describe("direct access (standalone door)", () => {
  it("shows MCP's normal login page (email + password)", async () => {
    await detectAuthMode(fakeFetch(401));
    renderApp("/");
    expect(await screen.findByLabelText("Email")).toBeTruthy();
    expect(loginFormShown()).toBe(true);
    expect(screen.queryByText(/DeoDap Central session has ended/)).toBeNull();
  });

  it("a stored standalone login still opens the app, and its token is sent", async () => {
    await detectAuthMode(fakeFetch(401));
    useAuthStore.setState({ token: "standalone-token", user: USER });
    renderApp("/");
    expect(await screen.findByText("MCP dashboard content")).toBeTruthy();

    let sent: unknown;
    vi.spyOn(api.defaults, "adapter", "get").mockReturnValue(async (config: InternalAxiosRequestConfig) => {
      sent = config.headers.Authorization;
      return { data: {}, status: 200, statusText: "OK", headers: {}, config } as AxiosResponse;
    });
    await api.get("/dashboard");
    expect(sent).toBe("Bearer standalone-token");
  });

  it("keeps Logout and the normal password form", () => {
    useAuthStore.setState({ token: "standalone-token", user: USER });
    render(providers(<MemoryRouter><Sidebar /><ChangePasswordCard /></MemoryRouter>));
    expect(screen.getAllByText("Logout").length).toBeGreaterThan(0);
    expect(screen.getByText("Change Password")).toBeTruthy();
    expect(screen.queryByText(/DeoDap Central/)).toBeNull();
  });
});

describe("inside DeoDap Central (gateway door)", () => {
  it("signed in on 200: shows the app, no login page, nothing stored in the browser", async () => {
    window.localStorage.setItem("deodap-auth", JSON.stringify({ state: { token: "old", user: USER }, version: 0 }));
    const detection = await detectAuthMode(fakeFetch(200, { "X-Workspace-Gateway": "1" }, USER));
    enterCentralSso(detection.user);
    expect(useAuthStore.getState().token).toBe(SSO_SESSION_MARKER);
    expect(window.localStorage.getItem("deodap-auth") ?? "").not.toContain("old");
    renderApp("/");
    expect(await screen.findByText("MCP dashboard content")).toBeTruthy();
    expect(loginFormShown()).toBe(false);
  });

  it("hides Logout and says profile/password are managed in DeoDap Central", () => {
    setAuthModeForTests("central-sso");
    enterCentralSso(USER);
    render(providers(<MemoryRouter><Sidebar /><ChangePasswordCard /></MemoryRouter>));
    expect(screen.queryByText("Logout")).toBeNull();
    expect(screen.getByText(/signed in with your DeoDap Central account/)).toBeTruthy();
    expect(screen.queryByText("Change Password")).toBeNull();
  });

  it("never sends a browser token (the gateway signs each request in)", async () => {
    setAuthModeForTests("central-sso");
    useAuthStore.setState({ token: SSO_SESSION_MARKER, user: USER });
    let sent: unknown = "unset";
    vi.spyOn(api.defaults, "adapter", "get").mockReturnValue(async (config: InternalAxiosRequestConfig) => {
      sent = config.headers.Authorization;
      return { data: {}, status: 200, statusText: "OK", headers: {}, config } as AxiosResponse;
    });
    await api.get("/dashboard");
    expect(sent).toBeUndefined();
  });

  it("an MCP backend 401 passed through the gateway shows 'session ended', never the login page", async () => {
    // The gateway marks every response, so a 401 from the MCP service still carries the header.
    const detection = await detectAuthMode(fakeFetch(401, { "X-Workspace-Gateway": "1" }));
    enterCentralSso(detection.user);
    vi.spyOn(api, "get").mockRejectedValue(http401());
    renderApp("/");
    expect(await screen.findByText("Your DeoDap Central session has ended")).toBeTruthy();
    expect(loginFormShown()).toBe(false);
  });

  it("/login inside the gateway never shows the login page", async () => {
    await detectAuthMode(fakeFetch(401, { "X-Workspace-Gateway": "denied" }));
    enterCentralSso(null);
    vi.spyOn(api, "get").mockRejectedValue(http401());
    renderApp("/login");
    expect(await screen.findByText("Your DeoDap Central session has ended")).toBeTruthy();
    expect(loginFormShown()).toBe(false);
  });
});
