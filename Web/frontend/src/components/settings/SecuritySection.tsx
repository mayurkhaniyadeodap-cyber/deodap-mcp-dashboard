import { useMemo } from "react";
import { ShieldCheck } from "lucide-react";
import { ChangePasswordCard } from "@/components/shared/ChangePasswordCard";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { ROLE_LABELS } from "@/types/app";
import { formatDateTimeIST } from "@/utils/format";

/** Standard JWT registered claims we surface (epoch SECONDS). */
interface JwtClaims {
  iat?: number; // issued-at → real sign-in time
  exp?: number; // expiry → real session-expiry time
}

/**
 * Read the (public) claims of the backend-issued JWT the auth store holds. The
 * payload is base64url-encoded JSON — no secret needed to READ it (verification
 * stays server-side). Returns null if there's no token or it can't be parsed.
 * The values (iat/exp) are REAL: the token genuinely was issued at `iat` and
 * expires at `exp`. Nothing here is invented.
 */
function decodeJwtClaims(token: string | null): JwtClaims | null {
  const part = token?.split(".")[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
    const json = decodeURIComponent(
      atob(b64 + pad)
        .split("")
        .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
        .join(""),
    );
    return JSON.parse(json) as JwtClaims;
  } catch {
    return null;
  }
}

/** Change Password (reused) + session info derived from the real backend JWT. */
export function SecuritySection() {
  const { user, token } = useAuth();
  const claims = useMemo(() => decodeJwtClaims(token), [token]);
  const hasSessionInfo = Boolean(claims?.iat || claims?.exp);

  return (
    <div className="space-y-6">
      <ChangePasswordCard />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-primary" /> Session
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Signed in as</span>
            <span className="font-medium text-foreground">{user?.email}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Role</span>
            <Badge variant="primary">{user ? ROLE_LABELS[user.role] : "—"}</Badge>
          </div>
          {/* Real sign-in / expiry from the JWT the backend issued (iat/exp). Rendered
              only when present — never invented. */}
          {claims?.iat ? (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Signed in</span>
              <span className="font-medium text-foreground">{formatDateTimeIST(claims.iat * 1000)}</span>
            </div>
          ) : null}
          {claims?.exp ? (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Session expires</span>
              <span className="font-medium text-foreground">{formatDateTimeIST(claims.exp * 1000)}</span>
            </div>
          ) : null}
          {!hasSessionInfo ? (
            <div className="text-muted-foreground">Session information is not available.</div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
