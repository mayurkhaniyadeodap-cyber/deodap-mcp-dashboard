import { UsersSection } from "@/components/settings/UsersSection";

/** Standalone /users route (Admin only). The UI is the reusable UsersSection,
 * which is also mounted inside the Configuration page's settings nav. */
export default function UsersPage() {
  return <UsersSection />;
}
