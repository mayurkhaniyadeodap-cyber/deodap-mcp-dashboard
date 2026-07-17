import { Monitor, ShieldCheck } from "lucide-react";
import { ChangePasswordCard } from "@/components/shared/ChangePasswordCard";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { ROLE_LABELS } from "@/types/app";

/** Change Password (reused) + basic (mock) session info. */
export function SecuritySection() {
  const { user } = useAuth();

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
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Token lifetime</span>
            <span className="font-medium text-foreground">8 hours</span>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-border bg-background/40 px-3 py-2.5">
            <Monitor className="size-4 text-muted-foreground" />
            <div>
              <div className="text-sm font-medium text-foreground">This device</div>
              <div className="text-xs text-muted-foreground">Current active session · Web</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
