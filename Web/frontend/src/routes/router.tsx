import { Navigate, createBrowserRouter } from "react-router-dom";
import { AppLayout } from "@/layouts/AppLayout";
import { AuthLayout } from "@/layouts/AuthLayout";
import BillsPage from "@/pages/BillsPage";
import CodPage from "@/pages/CodPage";
import CouriersPage from "@/pages/CouriersPage";
import DashboardPage from "@/pages/DashboardPage";
import DeliveryPerformancePage from "@/pages/DeliveryPerformancePage";
import DiscrepanciesPage from "@/pages/DiscrepanciesPage";
import DisputeLinesPage from "@/pages/DisputeLinesPage";
import ExportPage from "@/pages/ExportPage";
import LoginPage from "@/pages/LoginPage";
import NotFound from "@/pages/NotFound";
import ProfilePage from "@/pages/ProfilePage";
import SettingsPage from "@/pages/SettingsPage";
import TrendsPage from "@/pages/TrendsPage";
import UsersPage from "@/pages/UsersPage";
import WeightPage from "@/pages/WeightPage";
import ZonesPage from "@/pages/ZonesPage";
import { ProtectedRoute } from "@/routes/ProtectedRoute";
import { PublicOnlyRoute } from "@/routes/PublicOnlyRoute";
import { RoleGuard } from "@/routes/RoleGuard";

/**
 * Checkpoint 3 routing: /login (public) and the authenticated app shell
 * (AppLayout) wrapping all 10 pages. Pages are placeholders until Checkpoints
 * 5–7 fill them from the mock API.
 */
export const router = createBrowserRouter([
  {
    element: <PublicOnlyRoute />,
    children: [
      {
        element: <AuthLayout />,
        children: [{ path: "/login", element: <LoginPage /> }],
      },
    ],
  },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { path: "/", element: <Navigate to="/dashboard" replace /> },
          { path: "/dashboard", element: <DashboardPage /> },
          { path: "/bills", element: <BillsPage /> },
          { path: "/couriers", element: <CouriersPage /> },
          { path: "/discrepancies", element: <DiscrepanciesPage /> },
          { path: "/dispute-lines", element: <DisputeLinesPage /> },
          { path: "/cod", element: <CodPage /> },
          { path: "/delivery-performance", element: <DeliveryPerformancePage /> },
          { path: "/zones", element: <ZonesPage /> },
          { path: "/weight", element: <WeightPage /> },
          { path: "/trends", element: <TrendsPage /> },
          { path: "/export", element: <ExportPage /> },
          { path: "/settings", element: <SettingsPage /> },
          { path: "/profile", element: <ProfilePage /> },
          {
            // Admin-only, enforced with the existing role guard (redirects others).
            path: "/users",
            element: (
              <RoleGuard allow={["admin"]} fallback={<Navigate to="/dashboard" replace />}>
                <UsersPage />
              </RoleGuard>
            ),
          },
        ],
      },
    ],
  },
  { path: "*", element: <NotFound /> },
]);
