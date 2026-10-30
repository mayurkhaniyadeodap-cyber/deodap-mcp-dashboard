import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Download, Loader2, Menu, Moon, PanelLeft, RefreshCw, Sun } from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Button, buttonVariants } from "@/components/ui/button";
import { resolvePageMeta } from "@/config/nav";
import { useAuth } from "@/hooks/useAuth";
import { usePagePrefetch } from "@/hooks/usePagePrefetch";
import { useRefreshSync } from "@/hooks/useRefreshSync";
import { cn } from "@/lib/utils";
import { RoleGuard } from "@/routes/RoleGuard";
import { useDateRange } from "@/store/dateRange.store";
import { useExportStatus } from "@/store/exportStatus";
import { useThemeStore } from "@/store/theme.store";
import { useUIStore } from "@/store/ui.store";
import { formatDateIST } from "@/utils/format";
import { DateRangePicker } from "./DateRangePicker";
import { ProfileMenu } from "./ProfileMenu";

/** "Good Morning" / "Good Afternoon" / "Good Evening" by the current hour in IST. */
function greeting(): string {
  const hour = Number(new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", hourCycle: "h23" }).format(new Date()));
  return hour < 12 ? "Good Morning" : hour < 17 ? "Good Afternoon" : "Good Evening";
}

export function Navbar() {
  const location = useLocation();
  const { title, breadcrumb } = resolvePageMeta(location.pathname);
  const { user } = useAuth();
  const isDashboard = location.pathname === "/dashboard";
  const { from, to } = useDateRange();
  const rangeText = from === to ? formatDateIST(from) : `${formatDateIST(from)} – ${formatDateIST(to)}`;

  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const setMobileOpen = useUIStore((s) => s.setMobileSidebarOpen);
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);

  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const { isExporting, label } = useExportStatus();
  // Any live query in flight — e.g. after a date-range change, every page's data
  // refetches for the new dates. keepPreviousData keeps the old numbers on screen, so
  // this is the cue that fresh-range data is loading (it clears when the fetch lands).
  const fetching = useIsFetching();
  // Refetch panels as the automatic 30-minute live-data refresh updates them (no UI).
  useRefreshSync();
  // Once this page has loaded, quietly load the other pages' data (instant opening).
  usePagePrefetch();

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
    <header className="sticky top-0 z-30 flex h-[72px] items-center justify-between gap-3 border-b border-border bg-background/90 px-4 backdrop-blur-sm sm:px-6">
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

        {isDashboard ? (
          <div className="min-w-0">
            <h1 className="truncate text-lg font-bold leading-tight tracking-tight sm:text-[22px]">
              {greeting()}
              {user ? `, ${user.name.split(" ")[0]}` : ""} <span aria-hidden>👋</span>
            </h1>
            <p className="hidden truncate text-[13px] text-muted-foreground md:block">
              <span className="hidden min-[1500px]:inline">Courier billing &amp; logistics overview</span>
              <span className="min-[1500px]:hidden">Overview</span> · <span className="font-medium text-foreground">{rangeText}</span> (IST)
            </p>
          </div>
        ) : (
          <div className="min-w-0">
            <nav aria-label="Breadcrumb" className="hidden items-center gap-1 text-xs text-muted-foreground sm:flex">
              {breadcrumb.map((crumb, i) => (
                <span key={crumb} className="flex items-center gap-1">
                  {i > 0 && <ChevronRight className="size-3" />}
                  <span className={cn(i === breadcrumb.length - 1 && "text-foreground")}>{crumb}</span>
                </span>
              ))}
            </nav>
            <h1 className="truncate text-lg font-semibold leading-tight tracking-tight sm:text-xl">{title}</h1>
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {/* Data-updating cue — shown while queries refetch (e.g. after a date-range
            change); the previous numbers stay visible until the new range lands. */}
        {fetching > 0 && (
          <span
            role="status"
            className="inline-flex animate-fade-in items-center gap-1.5 rounded-md border border-primary/25 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
            title="Loading data for the selected date range…"
          >
            <RefreshCw className="size-3.5 animate-spin" />
            <span className="hidden min-[1700px]:inline">Updating…</span>
          </span>
        )}
        {/* Global export indicator — persists across navigation while an export runs. */}
        {isExporting && (
          <span
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground"
            title={label ? `Exporting ${label}…` : "An export is running"}
          >
            <Loader2 className="size-3.5 animate-spin" />
            <span className="hidden min-[1700px]:inline">Exporting…</span>
          </span>
        )}
        <DateRangePicker />

        {/* Theme switch: sun | moon */}
        <div role="group" aria-label="Theme" className="hidden h-10 items-center rounded-lg border border-border bg-card p-1 md:flex">
          {(
            [
              ["light", Sun, "Light theme"],
              ["dark", Moon, "Dark theme"],
            ] as const
          ).map(([value, Icon, name]) => (
            <button
              key={value}
              type="button"
              aria-label={name}
              aria-pressed={theme === value}
              title={name}
              onClick={() => setTheme(value)}
              className={cn(
                "grid h-full w-8 place-items-center rounded-md transition-colors duration-150",
                theme === value ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-4" />
            </button>
          ))}
        </div>

        <RoleGuard allow={["admin", "employee"]}>
          <Link
            to="/export"
            aria-label="Export"
            title="Export data"
            className={buttonVariants({
              variant: "outline",
              className: "hidden h-10 border-primary/40 text-primary hover:bg-primary/10 hover:text-primary sm:inline-flex",
            })}
          >
            <Download className="size-4" /> <span className="hidden min-[1500px]:inline">Export</span>
          </Link>
        </RoleGuard>
        <Button
          onClick={onRefresh}
          disabled={refreshing}
          className="h-10"
          aria-label="Refresh data on this page"
          title="Reload this page's data (the selected date range is kept)"
        >
          <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
          <span className="hidden xl:inline">{refreshing ? "Refreshing…" : "Refresh"}</span>
        </Button>
        <ProfileMenu />
      </div>
    </header>
  );
}
