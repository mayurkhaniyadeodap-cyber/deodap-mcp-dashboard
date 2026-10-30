import { useQueryClient } from "@tanstack/react-query";
import { Boxes, ChevronLeft, ChevronRight, Lock, LogOut } from "lucide-react";
import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { NAV_GROUPS, type NavItem } from "@/config/nav";
import { useAuth } from "@/hooks/useAuth";
import { isCentralSso } from "@/lib/authMode";
import { cn } from "@/lib/utils";
import { prefetchPage } from "@/services/prefetch";
import { useDateRange } from "@/store/dateRange.store";
import { useUIStore } from "@/store/ui.store";

/** Hover/focus label beside an icon-only (collapsed) rail item. */
function RailTooltip({ show, children }: { show: boolean; children: ReactNode }) {
  if (!show) return null;
  return (
    <span
      role="tooltip"
      className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs font-medium text-popover-foreground opacity-0 shadow-card-hover transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
    >
      {children}
    </span>
  );
}

/** Shared inner content, rendered by both the desktop rail and the mobile drawer. */
function SidebarContent({
  collapsed,
  onNavigate,
}: {
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const { user, hasRole, logout } = useAuth();
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  // One flat list (the group order is kept); role rules are unchanged.
  const items = NAV_GROUPS.flatMap((g) => g.items).filter((item) => !item.roles || (user && item.roles.includes(user.role)));

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      {/* Brand */}
      <div className={cn("flex h-[68px] shrink-0 items-center px-4", collapsed ? "justify-center" : "justify-between")}>
        <div className="flex items-center gap-2.5 overflow-hidden">
          <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-teal-400 to-[#0891b2] text-white shadow-[0_4px_14px_-4px_rgb(20_184_166/0.6)]">
            <Boxes className="size-5" />
          </div>
          {!collapsed && (
            <div className="min-w-0 leading-tight">
              <div className="text-[15px] font-bold tracking-tight">DeoDap MCP</div>
              <div className="text-[10.5px] leading-tight text-sidebar-muted">Courier Billing &amp; Logistics Analytics</div>
            </div>
          )}
        </div>
        {!collapsed && (
          <button
            onClick={toggleSidebar}
            className="hidden shrink-0 rounded-md p-1.5 text-sidebar-muted transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground lg:block"
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
          >
            <ChevronLeft className="size-4" />
          </button>
        )}
      </div>

      {/* Nav */}
      <nav aria-label="Main" className={cn("scrollbar-thin flex-1 overflow-y-auto py-2", collapsed ? "px-2" : "px-3")}>
        <ul className="space-y-1">
          {items.map((item) => (
            <li key={item.path}>
              <SidebarLink
                item={item}
                collapsed={collapsed}
                disabled={Boolean(item.disabledForRoles && hasRole(...item.disabledForRoles))}
                onNavigate={onNavigate}
              />
            </li>
          ))}
        </ul>
      </nav>

      {/* Footer: expand control (collapsed rail) + logout. */}
      <div className={cn("shrink-0 border-t border-sidebar-border", collapsed ? "p-2" : "p-3")}>
        {collapsed && (
          <button
            onClick={toggleSidebar}
            className="group relative hidden w-full items-center justify-center rounded-md py-2 text-sidebar-muted transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground lg:flex"
            aria-label="Expand sidebar"
          >
            <ChevronRight className="size-4" />
            <RailTooltip show>Expand sidebar</RailTooltip>
          </button>
        )}
        {/* Logout (Central SSO: sign out in DeoDap Central instead) */}
        {!isCentralSso() && (
          <button
            onClick={logout}
            aria-label="Logout"
            className={cn(
              "group relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-muted transition-colors hover:bg-destructive/10 hover:text-destructive",
              collapsed && "justify-center px-0",
            )}
          >
            <LogOut className="size-[18px] shrink-0" />
            {!collapsed && <span>Logout</span>}
            <RailTooltip show={collapsed}>Logout</RailTooltip>
          </button>
        )}
      </div>
    </div>
  );
}

function SidebarLink({
  item,
  collapsed,
  disabled,
  onNavigate,
}: {
  item: NavItem;
  collapsed: boolean;
  disabled: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  const qc = useQueryClient();
  const { from, to } = useDateRange();
  // About to click → start loading that page's data now (normal priority).
  const warm = () => void prefetchPage(qc, item.path, { from, to });

  if (disabled) {
    return (
      <div
        title={`${item.label} — not available for your role`}
        aria-disabled
        className={cn(
          "flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-muted/50",
          collapsed && "justify-center px-0",
        )}
      >
        <Icon className="size-[18px] shrink-0" />
        {!collapsed && (
          <span className="flex flex-1 items-center justify-between">
            {item.label}
            <Lock className="size-3.5" />
          </span>
        )}
      </div>
    );
  }

  return (
    <NavLink
      to={item.path}
      onClick={onNavigate}
      onMouseEnter={warm}
      onFocus={warm}
      aria-label={collapsed ? item.label : undefined}
      className={({ isActive }) =>
        cn(
          "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150",
          collapsed && "justify-center px-0",
          isActive
            ? "bg-gradient-to-r from-teal-600 to-[#0891b2] text-white shadow-[0_6px_16px_-6px_rgb(20_184_166/0.7)]"
            : "text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground",
        )
      }
    >
      <Icon className="size-[18px] shrink-0" />
      {!collapsed && <span className="truncate">{item.label}</span>}
      <RailTooltip show={collapsed}>{item.label}</RailTooltip>
    </NavLink>
  );
}

/** Fixed desktop rail; width animates between expanded and icon-only. */
export function DesktopSidebar() {
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  return (
    <aside
      className={cn(
        "hidden shrink-0 border-r border-sidebar-border bg-sidebar transition-[width] duration-200 ease-out lg:block",
        collapsed ? "w-[4.5rem]" : "w-60",
      )}
    >
      <div className="sticky top-0 h-screen">
        <SidebarContent collapsed={collapsed} />
      </div>
    </aside>
  );
}

/** Off-canvas drawer for small screens (always expanded content). */
export function MobileSidebar() {
  const open = useUIStore((s) => s.mobileSidebarOpen);
  const setOpen = useUIStore((s) => s.setMobileSidebarOpen);

  return (
    <div className={cn("lg:hidden", !open && "pointer-events-none")} aria-hidden={!open}>
      <div
        className={cn("fixed inset-0 z-40 bg-slate-950/60 transition-opacity duration-200", open ? "opacity-100" : "opacity-0")}
        onClick={() => setOpen(false)}
      />
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-72 border-r border-sidebar-border bg-sidebar shadow-2xl transition-transform duration-200 ease-out",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <SidebarContent collapsed={false} onNavigate={() => setOpen(false)} />
      </aside>
    </div>
  );
}
