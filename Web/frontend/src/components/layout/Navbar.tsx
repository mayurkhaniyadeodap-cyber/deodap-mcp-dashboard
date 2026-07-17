import { useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Download, Menu, PanelLeft, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Button, buttonVariants } from "@/components/ui/button";
import { resolvePageMeta } from "@/config/nav";
import { cn } from "@/lib/utils";
import { RoleGuard } from "@/routes/RoleGuard";
import { useUIStore } from "@/store/ui.store";
import { DateRangePicker } from "./DateRangePicker";
import { ProfileMenu } from "./ProfileMenu";

export function Navbar() {
  const location = useLocation();
  const { title, breadcrumb } = resolvePageMeta(location.pathname);

  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const setMobileOpen = useUIStore((s) => s.setMobileSidebarOpen);

  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      // Invalidate marks the active page's queries stale and refetches them;
      // the returned promise settles once those network calls complete.
      await queryClient.invalidateQueries();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-border bg-background/80 px-4 backdrop-blur">
      <div className="flex min-w-0 items-center gap-3">
        {/* Mobile: open drawer */}
        <button
          onClick={() => setMobileOpen(true)}
          className="grid size-9 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground lg:hidden"
          aria-label="Open menu"
        >
          <Menu className="size-5" />
        </button>
        {/* Desktop: expand when collapsed */}
        {collapsed && (
          <button
            onClick={toggleSidebar}
            className="hidden size-9 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground lg:grid"
            aria-label="Expand sidebar"
            title="Expand sidebar"
          >
            <PanelLeft className="size-5" />
          </button>
        )}

        <div className="min-w-0">
          <h1 className="truncate text-[32px] font-bold leading-tight tracking-tight">{title}</h1>
          <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-muted-foreground">
            {breadcrumb.map((crumb, i) => (
              <span key={crumb} className="flex items-center gap-1">
                {i > 0 && <ChevronRight className="size-3" />}
                <span className={cn(i === breadcrumb.length - 1 && "text-foreground")}>{crumb}</span>
              </span>
            ))}
          </nav>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <DateRangePicker />
        <RoleGuard allow={["admin", "employee"]}>
          <Link to="/export" className={buttonVariants({ variant: "outline", size: "sm", className: "hidden sm:inline-flex" })}>
            <Download className="size-4" /> Export
          </Link>
        </RoleGuard>
        <Button onClick={onRefresh} size="sm">
          <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
          <span className="hidden sm:inline">Refresh</span>
        </Button>
        <ProfileMenu />
      </div>
    </header>
  );
}
