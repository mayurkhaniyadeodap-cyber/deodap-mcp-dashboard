import { RotateCcw } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface FilterBarProps {
  children: ReactNode;
  /** Shown as a reset action on the right when provided. */
  onReset?: () => void;
  className?: string;
}

/**
 * Responsive container for a page's filter controls (search, selects, etc.).
 * Keeps filter layout consistent across pages instead of re-implementing it.
 */
export function FilterBar({ children, onReset, className }: FilterBarProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center",
        className,
      )}
    >
      {children}
      {onReset && (
        <Button variant="ghost" size="sm" onClick={onReset} className="sm:ml-auto">
          <RotateCcw className="size-4" /> Reset
        </Button>
      )}
    </div>
  );
}
