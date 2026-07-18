import {
  Boxes,
  Download,
  FileText,
  GitCompareArrows,
  LayoutDashboard,
  type LucideIcon,
  Map as MapIcon,
  Receipt,
  Scale,
  Settings,
  TrendingUp,
  Wallet,
} from "lucide-react";
import type { Role } from "@/types/app";

export interface NavItem {
  /** Fixed label — used verbatim in the sidebar and as the page title. */
  label: string;
  path: string;
  icon: LucideIcon;
  /** If set, only these roles may open the item (others: hidden). */
  roles?: Role[];
  /** If set, these roles see the item but it is disabled (read-only account). */
  disabledForRoles?: Role[];
}

export interface NavGroup {
  heading: string;
  items: NavItem[];
}

/**
 * Sidebar navigation. Labels are the fixed names from the spec and are reused
 * everywhere (page title, breadcrumb). Role rules:
 *   - Export is disabled for Viewer (read-only).
 *   - Configuration stays visible to all (the page itself is read-only for
 *     non-Admins; write controls are guarded inside it in later checkpoints).
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    heading: "Overview",
    items: [{ label: "Dashboard", path: "/dashboard", icon: LayoutDashboard }],
  },
  {
    heading: "Billing",
    items: [
      { label: "Bills Overview", path: "/bills", icon: FileText },
      { label: "Courier Comparison", path: "/couriers", icon: GitCompareArrows },
      { label: "Discrepancies", path: "/discrepancies", icon: Boxes },
      { label: "Dispute Lines", path: "/dispute-lines", icon: Receipt },
      { label: "COD Reconciliation", path: "/cod", icon: Wallet },
    ],
  },
  {
    heading: "Analysis",
    items: [
      { label: "State Analysis", path: "/zones", icon: MapIcon },
      { label: "Weight Analysis", path: "/weight", icon: Scale },
      { label: "Trend Analysis", path: "/trends", icon: TrendingUp },
    ],
  },
  {
    heading: "Actions",
    items: [
      { label: "Export", path: "/export", icon: Download },
      { label: "Configuration", path: "/settings", icon: Settings },
    ],
  },
];

/** Flat lookup of path → nav item (for titles/breadcrumbs). */
export const NAV_BY_PATH: Record<string, NavItem> = Object.fromEntries(
  NAV_GROUPS.flatMap((g) => g.items).map((item) => [item.path, item]),
);

/** Resolve the current page's title + breadcrumb trail from a pathname. */
// Account pages live in the profile menu (not the sidebar) but still need titles.
const ACCOUNT_PAGES: Record<string, { title: string; breadcrumb: string[] }> = {
  "/profile": { title: "My Profile", breadcrumb: ["Account", "My Profile"] },
  "/users": { title: "User Management", breadcrumb: ["Account", "User Management"] },
};

export function resolvePageMeta(pathname: string): { title: string; breadcrumb: string[] } {
  const item = NAV_BY_PATH[pathname];
  const group = NAV_GROUPS.find((g) => g.items.some((i) => i.path === pathname));
  if (item) {
    return { title: item.label, breadcrumb: [group?.heading ?? "", item.label].filter(Boolean) };
  }
  if (ACCOUNT_PAGES[pathname]) return ACCOUNT_PAGES[pathname];
  return { title: "Dashboard", breadcrumb: ["Overview", "Dashboard"] };
}
