import { Boxes, ShieldCheck, TrendingUp, Truck } from "lucide-react";
import { Outlet } from "react-router-dom";

/**
 * Two-pane auth shell: a branded left panel (hidden on small screens) and the
 * form card on the right via <Outlet>.
 */
export function AuthLayout() {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel */}
      <aside className="relative hidden overflow-hidden bg-card lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{
            background:
              "radial-gradient(1000px 500px at 10% -10%, hsl(var(--primary) / 0.25), transparent 60%), radial-gradient(700px 400px at 90% 110%, hsl(var(--purple) / 0.18), transparent 60%)",
          }}
        />
        <div className="relative flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-lg bg-primary/15 text-primary">
            <Boxes className="size-6" />
          </div>
          <div>
            <div className="text-lg font-semibold tracking-tight">DeoDap MCP</div>
            <div className="text-sm text-muted-foreground">Courier Billing Dashboard</div>
          </div>
        </div>

        <div className="relative space-y-6">
          <h1 className="max-w-md text-3xl font-semibold leading-tight tracking-tight">
            Control your courier billing with confidence.
          </h1>
          <ul className="space-y-3 text-sm text-muted-foreground">
            <li className="flex items-center gap-3">
              <Truck className="size-4 text-primary" /> Compare couriers, zones and weight slabs
            </li>
            <li className="flex items-center gap-3">
              <TrendingUp className="size-4 text-success" /> Track billing trends and COD reconciliation
            </li>
            <li className="flex items-center gap-3">
              <ShieldCheck className="size-4 text-purple" /> Role-based access for your whole team
            </li>
          </ul>
        </div>

        <div className="relative text-xs text-muted-foreground">
          © DeoDap · Phase 1 preview
        </div>
      </aside>

      {/* Form pane */}
      <main className="flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
