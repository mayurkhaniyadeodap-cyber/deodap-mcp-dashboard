import { Outlet } from "react-router-dom";
import { Navbar } from "@/components/layout/Navbar";
import { DesktopSidebar, MobileSidebar } from "@/components/layout/Sidebar";
import { ExportStatusProvider } from "@/store/exportStatus";

/**
 * The authenticated app shell: a fixed sidebar (collapsible on desktop, drawer
 * on mobile), a sticky navbar, and the routed page via <Outlet>.
 *
 * ExportStatusProvider wraps the shell (which persists across page navigation) so an
 * in-progress export keeps running and its global indicator stays visible as the user
 * moves between pages.
 */
export function AppLayout() {
  return (
    <ExportStatusProvider>
      <div className="flex min-h-screen bg-background">
        <DesktopSidebar />
        <MobileSidebar />

        <div className="flex min-h-screen min-w-0 flex-1 flex-col">
          <Navbar />
          <main className="flex-1 px-4 py-6 sm:px-6 lg:py-7">
            {/* Capped width keeps very wide monitors readable; no page-level h-scroll. */}
            <div className="mx-auto w-full min-w-0 max-w-[1680px]">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </ExportStatusProvider>
  );
}
