import { Outlet } from "react-router-dom";
import { Navbar } from "@/components/layout/Navbar";
import { DesktopSidebar, MobileSidebar } from "@/components/layout/Sidebar";

/**
 * The authenticated app shell: a fixed sidebar (collapsible on desktop, drawer
 * on mobile), a sticky navbar, and the routed page via <Outlet>.
 */
export function AppLayout() {
  return (
    <div className="flex min-h-screen bg-background">
      <DesktopSidebar />
      <MobileSidebar />

      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <Navbar />
        <main className="flex-1 px-4 py-6 sm:px-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
