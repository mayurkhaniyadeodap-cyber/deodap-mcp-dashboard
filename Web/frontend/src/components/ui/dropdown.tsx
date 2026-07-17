import { type ReactNode, useRef, useState } from "react";
import { useOnClickOutside } from "@/hooks/useOnClickOutside";
import { cn } from "@/lib/utils";

interface DropdownProps {
  /** Renders the trigger; receives open state + a toggle callback. */
  trigger: (args: { open: boolean; toggle: () => void }) => ReactNode;
  children: ReactNode;
  /** Horizontal alignment of the panel relative to the trigger. */
  align?: "start" | "end";
  /** Extra classes for the panel. */
  panelClassName?: string;
}

/**
 * Minimal, dependency-free popover/menu (click-outside + Escape to close).
 * Reused by the date-range picker and profile menu. Panels stack on top with a
 * high z-index and close on outside interaction.
 */
export function Dropdown({ trigger, children, align = "end", panelClassName }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOnClickOutside(ref, () => setOpen(false), open);

  return (
    <div className="relative" ref={ref}>
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div
          role="menu"
          className={cn(
            "absolute top-[calc(100%+0.5rem)] z-50 min-w-56 overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-2xl",
            "animate-in fade-in-0 zoom-in-95",
            align === "end" ? "right-0" : "left-0",
            panelClassName,
          )}
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      )}
    </div>
  );
}

/** A standard clickable row inside a Dropdown panel. */
export function DropdownItem({
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      role="menuitem"
      className={cn(
        "flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
