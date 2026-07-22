import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";

/** The billing section's cross-page tabs (blue active underline). */
const BILLING_TABS = [
  { label: "Overview", to: "/bills" },
  { label: "Courier Comparison", to: "/couriers" },
  { label: "Discrepancies", to: "/discrepancies" },
  { label: "COD Intelligence", to: "/cod" },
  { label: "Delivery Performance", to: "/delivery-performance" },
];

export function BillingTabs() {
  return (
    <div className="-mb-px flex gap-1 overflow-x-auto border-b border-border">
      {BILLING_TABS.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          className={({ isActive }) =>
            cn(
              "whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
              isActive
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )
          }
        >
          {t.label}
        </NavLink>
      ))}
    </div>
  );
}
