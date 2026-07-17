import {
  Activity,
  Building2,
  Lock,
  type LucideIcon,
  Palette,
  ShieldCheck,
  Truck,
  UserRound,
  Users,
} from "lucide-react";
import { useState } from "react";
import { ProfileDetailsCard } from "@/components/shared/ProfileDetailsCard";
import { PageError } from "@/components/shared/PageError";
import { PreferencesSection } from "@/components/settings/PreferencesSection";
import { CourierSettingsSection } from "@/components/settings/CourierSettingsSection";
import { MCPStatusSection } from "@/components/settings/MCPStatusSection";
import { SecuritySection } from "@/components/settings/SecuritySection";
import { ThemeSection } from "@/components/settings/ThemeSection";
import { UsersSection } from "@/components/settings/UsersSection";
import { cn } from "@/lib/utils";
import { useHasRole } from "@/routes/RoleGuard";
import { useSettings } from "@/services/settings.service";

type SectionId = "profile" | "preferences" | "courier" | "mcp" | "security" | "theme" | "users";

const SECTIONS: { id: SectionId; label: string; icon: LucideIcon }[] = [
  { id: "profile", label: "Profile", icon: UserRound },
  { id: "preferences", label: "Preferences", icon: Building2 },
  { id: "courier", label: "Courier Settings", icon: Truck },
  { id: "mcp", label: "MCP Status", icon: Activity },
  { id: "security", label: "Security", icon: ShieldCheck },
  { id: "theme", label: "Theme", icon: Palette },
];

// Admin-only section, appended to the nav when the current user is an Admin.
const USERS_SECTION = { id: "users" as const, label: "User Management", icon: Users };

export default function SettingsPage() {
  const { data, isLoading, isError, refetch } = useSettings();
  const isAdmin = useHasRole("admin");
  const [active, setActive] = useState<SectionId>("profile");

  // User Management is Admin-only; non-admins never see the nav entry.
  const sections = isAdmin ? [...SECTIONS, USERS_SECTION] : SECTIONS;

  if (isError) return <PageError onRetry={() => refetch()} />;

  return (
    <div className="space-y-4">
      {!isAdmin && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm text-muted-foreground">
          <Lock className="size-4" />
          You have read-only access. Only Admins can change configuration.
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[220px_1fr]">
        {/* Left settings-nav */}
        <nav className="lg:sticky lg:top-20 lg:self-start">
          <ul className="flex gap-1 overflow-x-auto rounded-xl border border-border bg-surface-gradient p-2 lg:flex-col lg:overflow-visible">
            {sections.map((s) => {
              const Icon = s.icon;
              return (
                <li key={s.id}>
                  <button
                    onClick={() => setActive(s.id)}
                    className={cn(
                      "flex w-full items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                      active === s.id
                        ? "bg-primary/15 text-primary"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                    aria-current={active === s.id ? "page" : undefined}
                  >
                    <Icon className="size-4 shrink-0" />
                    {s.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Section content */}
        <div className="min-w-0">
          {active === "profile" && <ProfileDetailsCard />}
          {active === "preferences" && <PreferencesSection data={data} isLoading={isLoading} />}
          {active === "courier" && <CourierSettingsSection />}
          {active === "mcp" && <MCPStatusSection />}
          {active === "security" && <SecuritySection />}
          {active === "theme" && <ThemeSection />}
          {active === "users" && isAdmin && <UsersSection />}
        </div>
      </div>
    </div>
  );
}
