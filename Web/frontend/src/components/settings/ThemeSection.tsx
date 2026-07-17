import { Check, Moon, Sun } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ACCENT_HEX } from "@/config/tokens";
import { cn } from "@/lib/utils";
import { type Theme, useThemeStore } from "@/store/theme.store";

const ACCENTS = Object.entries(ACCENT_HEX) as [string, string][];

/** Dark/Light theme toggle (default Dark) + accent color preview. */
export function ThemeSection() {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 sm:max-w-md">
            <ThemeOption current={theme} value="dark" icon={Moon} label="Dark" onSelect={setTheme} />
            <ThemeOption current={theme} value="light" icon={Sun} label="Light" onSelect={setTheme} />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Dark is the default. Your choice is saved to this browser.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Accent Colors</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            {ACCENTS.map(([name, hex]) => (
              <div key={name} className="flex flex-col items-center gap-1.5">
                <span className="size-10 rounded-lg ring-1 ring-border" style={{ background: hex }} />
                <span className="text-[11px] capitalize text-muted-foreground">{name}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ThemeOption({
  current,
  value,
  icon: Icon,
  label,
  onSelect,
}: {
  current: Theme;
  value: Theme;
  icon: typeof Moon;
  label: string;
  onSelect: (t: Theme) => void;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      className={cn(
        "flex items-center justify-between rounded-xl border p-4 transition-colors",
        active ? "border-primary bg-primary/[0.06]" : "border-border bg-card hover:border-primary/50",
      )}
    >
      <span className="flex items-center gap-2 font-medium">
        <Icon className={cn("size-5", active ? "text-primary" : "text-muted-foreground")} />
        {label}
      </span>
      {active && <Check className="size-4 text-primary" />}
    </button>
  );
}
