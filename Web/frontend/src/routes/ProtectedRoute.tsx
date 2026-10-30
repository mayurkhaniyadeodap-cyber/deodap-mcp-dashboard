import { AxiosError } from "axios";
import { Loader2, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { isCentralSso, SSO_SESSION_MARKER } from "@/lib/authMode";
import { api, apiErrorMessage } from "@/services/api";
import { useAuthStore } from "@/store/auth.store";
import type { User } from "@/types/app";

/**
 * Gates all app routes. Unauthenticated users are redirected to /login, with
 * the attempted location preserved so login can send them back.
 *
 * Inside DeoDap Central (detected at runtime, see lib/authMode) there is no login page: the
 * signed-in user comes from GET /api/me (the gateway signs the request in). A 401 there always
 * means the DeoDap Central session has ended; the MCP login page is never shown inside Central.
 */
export function ProtectedRoute() {
  const isAuthenticated = useAuthStore((s) => Boolean(s.token));
  const location = useLocation();

  if (isCentralSso()) {
    return isAuthenticated ? <Outlet /> : <CentralSignIn />;
  }
  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <Outlet />;
}

function CentralSignIn() {
  const setAuth = useAuthStore((s) => s.setAuth);
  const [problem, setProblem] = useState<{ title: string; detail: string; retry: boolean } | null>(null);

  const signIn = useCallback(async () => {
    setProblem(null);
    try {
      const { data } = await api.get<User>("/me");
      setAuth(SSO_SESSION_MARKER, data);
    } catch (error) {
      const status = error instanceof AxiosError ? error.response?.status : undefined;
      if (status === 401) {
        setProblem({
          title: "Your DeoDap Central session has ended",
          detail: "Sign in to DeoDap Central and open the MCP Dashboard again from its project card.",
          retry: false,
        });
      } else if (status === 403) {
        setProblem({
          title: "No access to the MCP Dashboard",
          detail: apiErrorMessage(error, "Ask a DeoDap Central Admin for access."),
          retry: false,
        });
      } else {
        setProblem({
          title: "Could not sign you in",
          detail: apiErrorMessage(error, "The MCP Dashboard service may not be running."),
          retry: true,
        });
      }
    }
  }, [setAuth]);

  useEffect(() => {
    void signIn();
  }, [signIn]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="max-w-md space-y-3 text-center">
        {problem ? (
          <>
            <ShieldAlert className="mx-auto size-8 text-destructive" />
            <h1 className="text-lg font-semibold text-foreground">{problem.title}</h1>
            <p className="text-sm text-muted-foreground">{problem.detail}</p>
            {problem.retry && (
              <Button variant="outline" size="sm" onClick={() => void signIn()}>
                Try again
              </Button>
            )}
          </>
        ) : (
          <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" /> Signing you in with DeoDap Central…
          </p>
        )}
      </div>
    </div>
  );
}
