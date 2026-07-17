import { ChevronDown, LogOut, Settings, Users, UserRound } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Dropdown, DropdownItem } from "@/components/ui/dropdown";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { ROLE_LABELS } from "@/types/app";

/** Returns up to two initials for the avatar. */
function initials(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function ProfileMenu() {
  const { user, logout, hasRole } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;
  const isAdmin = hasRole("admin");

  return (
    <Dropdown
      align="end"
      panelClassName="w-56"
      trigger={({ toggle, open }) => (
        <button
          onClick={toggle}
          className={cn(
            "flex items-center gap-2 rounded-md border border-border bg-card py-1.5 pl-1.5 pr-2 transition-colors hover:bg-accent",
            open && "bg-accent",
          )}
        >
          <span className="grid size-7 place-items-center rounded-full bg-primary/20 text-xs font-semibold text-primary">
            {initials(user.name)}
          </span>
          <span className="hidden text-left sm:block">
            <span className="block text-sm font-medium leading-tight text-foreground">
              {user.name}
            </span>
            <span className="block text-xs leading-tight text-muted-foreground">
              {ROLE_LABELS[user.role]}
            </span>
          </span>
          <ChevronDown className="size-4 text-muted-foreground" />
        </button>
      )}
    >
      <div className="border-b border-border px-3 py-2.5">
        <div className="text-sm font-medium text-foreground">{user.name}</div>
        <div className="truncate text-xs text-muted-foreground">{user.email}</div>
      </div>
      <div className="py-1">
        <DropdownItem onClick={() => navigate("/profile")}>
          <UserRound className="size-4" /> My Profile
        </DropdownItem>
        {isAdmin && (
          <DropdownItem onClick={() => navigate("/users")}>
            <Users className="size-4" /> User Management
          </DropdownItem>
        )}
        <DropdownItem onClick={() => navigate("/settings")}>
          <Settings className="size-4" /> Configuration
        </DropdownItem>
      </div>
      <div className="border-t border-border py-1">
        <DropdownItem onClick={logout} className="text-destructive hover:bg-destructive/10">
          <LogOut className="size-4" /> Logout
        </DropdownItem>
      </div>
    </Dropdown>
  );
}
