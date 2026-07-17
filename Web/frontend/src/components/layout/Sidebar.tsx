import { Boxes, ChevronLeft, Lock, LogOut } from "lucide-react";
import { NavLink } from "react-router-dom";
import { NAV_GROUPS, type NavItem } from "@/config/nav";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/store/ui.store";

/** Shared inner content, rendered by both the desktop rail and the mobile drawer. */
function SidebarContent({
  collapsed,
  onNavigate,
}: {
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const { user, logout, hasRole } = useAuth();
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);

  return (
    <div className="flex h-full flex-col">
      {/* Brand */}
      <div
        className={cn(
          "flex h-16 items-center border-b border-border px-4",
          collapsed ? "justify-center" : "justify-between",
        )}
      >
        <div className="flex items-center gap-2.5 overflow-hidden">
          <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary">
            <Boxes className="size-5" />
          </div>
          {!collapsed && (
            <div className="leading-tight">
              <div className="text-sm font-semibold tracking-tight">DeoDap MCP</div>
              <div className="text-xs text-muted-foreground">Courier Billing</div>
            </div>
          )}
        </div>
        {!collapsed && (
          <button
            onClick={toggleSidebar}
            className="hidden rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground lg:block"
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
          >
            <ChevronLeft className="size-4" />
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-4">
        {NAV_GROUPS.map((group) => {
          const visible = group.items.filter(
            (item) => !item.roles || (user && item.roles.includes(user.role)),
          );
          if (visible.length === 0) return null;
          return (
            <div key={group.heading}>
              {!collapsed && (
                <div className="px-2 pb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {group.heading}
                </div>
              )}
              <ul className="space-y-1">
                {visible.map((item) => (
                  <li key={item.path}>
                    <SidebarLink
                      item={item}
                      collapsed={collapsed}
                      disabled={Boolean(
                        item.disabledForRoles && hasRole(...item.disabledForRoles),
                      )}
                      onNavigate={onNavigate}
                    />
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </nav>

      {/* Logout */}
      <div className="border-t border-border p-3">
        <button
          onClick={logout}
          title="Logout"
          className={cn(
            "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive",
            collapsed && "justify-center px-0",
          )}
        >
          <LogOut className="size-5 shrink-0" />
          {!collapsed && <span>Logout</span>}
        </button>
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

  if (disabled) {
    return (
      <div
        title={`${item.label} — not available for your role`}
        aria-disabled
        className={cn(
          "flex cursor-not-allowed items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground/50",
          collapsed && "justify-center px-0",
        )}
      >
        <Icon className="size-5 shrink-0" />
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
      title={collapsed ? item.label : undefined}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
          collapsed && "justify-center px-0",
          isActive
            ? "bg-primary/15 text-primary"
            : "text-muted-foreground hover:bg-accent hover:text-foreground",
        )
      }
    >
      <Icon className="size-5 shrink-0" />
      {!collapsed && <span>{item.label}</span>}
    </NavLink>
  );
}

/** Fixed desktop rail; width toggles between expanded and icon-only. */
export function DesktopSidebar() {
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  return (
    <aside
      className={cn(
        "hidden shrink-0 border-r border-border bg-card transition-[width] duration-200 lg:block",
        collapsed ? "w-[4.5rem]" : "w-64",
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
        className={cn(
          "fixed inset-0 z-40 bg-black/60 transition-opacity",
          open ? "opacity-100" : "opacity-0",
        )}
        onClick={() => setOpen(false)}
      />
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-64 border-r border-border bg-card transition-transform duration-200",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <SidebarContent collapsed={false} onNavigate={() => setOpen(false)} />
      </aside>
    </div>
  );
}
