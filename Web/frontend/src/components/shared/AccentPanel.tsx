import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { SourceBadge } from "@/components/shared/SourceBadge";
import { hexAlpha } from "@/config/tokens";
import { cn } from "@/lib/utils";
import type { SourceStatus } from "@/services/meta.service";

interface AccentPanelProps {
  /** Accent hex — drives the left border, icon chip, and badge. */
  color: string;
  icon: LucideIcon;
  title: string;
  /** Small pill in the header (e.g. "6 Cases"). */
  badge: string;
  /** Live/Sample provenance (from /api/_meta/sources). Optional. */
  source?: SourceStatus;
  children: ReactNode;
}

/** Card with a colored left accent, icon+title+count header, and a row list. */
export function AccentPanel({ color, icon: Icon, title, badge, source, children }: AccentPanelProps) {
  return (
    <div
      className="flex flex-col overflow-hidden rounded-lg border border-border bg-surface-gradient shadow-card"
      style={{ borderLeft: `3px solid ${color}` }}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border p-4">
        <div className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-md" style={{ background: hexAlpha(color, 0.14), color }}>
            <Icon className="size-4" />
          </span>
          <span className="text-sm font-semibold tracking-tight">{title}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <SourceBadge status={source} />
          <span
            className="whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold"
            style={{ background: hexAlpha(color, 0.14), color }}
          >
            {badge}
          </span>
        </div>
      </div>
      <ul className="divide-y divide-border">{children}</ul>
    </div>
  );
}

/** A single row inside an AccentPanel: left label (+ optional sub) and a value. */
export function PanelRow({
  left,
  sub,
  value,
  valueClassName,
  valueStyle,
}: {
  left: string;
  sub?: string;
  value: ReactNode;
  valueClassName?: string;
  valueStyle?: React.CSSProperties;
}) {
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-2.5">
      <div className="min-w-0">
        <div className="truncate text-sm text-foreground">{left}</div>
        {sub && <div className="truncate text-xs text-muted-foreground">{sub}</div>}
      </div>
      <span className={cn("shrink-0 text-sm font-semibold tabular-nums", valueClassName)} style={valueStyle}>
        {value}
      </span>
    </li>
  );
}
