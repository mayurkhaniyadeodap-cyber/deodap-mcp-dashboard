import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";
import { type DatePreset, DATE_PRESET_LABELS, SELECTABLE_PRESETS, useDateRange } from "@/store/dateRange.store";
import { formatDateIST } from "@/utils/format";

const TAB_LABELS: Record<DatePreset, string> = {
  today: "Today",
  "7d": "7D",
  "30d": "30D",
  mtd: "MTD",
  ytd: "YTD",
  custom: "Custom",
};

/**
 * Date-range selector: preset tabs (Today · 7D · 30D · MTD · YTD · Custom). Selecting
 * one updates the shared date-range store, which flows into every date-aware query
 * key → queries refetch automatically. "Custom" opens a picker that only applies on
 * click. The selected IST dates are in the tabs' hover text and the page subtitle.
 */
export function DateRangePicker() {
  const { preset, from, to, customFrom, customTo, setPreset, setCustomRange } = useDateRange();

  const [modalOpen, setModalOpen] = useState(false);
  const [start, setStart] = useState(customFrom);
  const [end, setEnd] = useState(customTo);

  // "Today" is a still-arriving partial day — say so wherever the range is shown.
  const label = preset === "custom" ? "Custom Range" : preset === "today" ? "Today (partial)" : DATE_PRESET_LABELS[preset];
  const dates = from === to ? formatDateIST(from) : `${formatDateIST(from)} – ${formatDateIST(to)}`;

  const openCustom = () => {
    setStart(customFrom || from);
    setEnd(customTo || to);
    setModalOpen(true);
  };

  // Apply only on click; the store update triggers the refetch via query keys.
  const applyCustom = () => {
    setCustomRange(start, end);
    setModalOpen(false);
  };

  const canApply = start !== "" && end !== "" && start <= end;

  return (
    <>
      {/* Preset tabs — the date control. The active tab's hover text gives its IST dates. */}
      <div
        role="group"
        aria-label={`Date range: ${label}, ${dates} (IST)`}
        className="scrollbar-thin flex h-10 max-w-[46vw] items-center overflow-x-auto rounded-lg border border-border bg-card p-1 sm:max-w-none"
      >
        {[...SELECTABLE_PRESETS, "custom" as const].map((key) => {
          const active = key === preset;
          const hint = key === "today" ? "Today (partial — orders still arriving)" : DATE_PRESET_LABELS[key];
          return (
            <button
              key={key}
              type="button"
              aria-pressed={active}
              title={active ? `${hint}: ${dates} (IST)` : hint}
              onClick={() => (key === "custom" ? openCustom() : setPreset(key))}
              className={cn(
                "h-full shrink-0 rounded-md px-2.5 text-xs font-semibold transition-colors duration-150",
                active ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {TAB_LABELS[key]}
            </button>
          );
        })}
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Custom date range"
        description="Pick a start and end date, then Apply."
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={applyCustom} disabled={!canApply}>
              Apply
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="space-y-1.5 text-sm">
            <span className="font-medium text-foreground">From</span>
            <input
              type="date"
              value={start}
              max={end || undefined}
              onChange={(e) => setStart(e.target.value)}
              className="h-10 w-full rounded-md border border-border bg-background/60 px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            />
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="font-medium text-foreground">To</span>
            <input
              type="date"
              value={end}
              min={start || undefined}
              onChange={(e) => setEnd(e.target.value)}
              className="h-10 w-full rounded-md border border-border bg-background/60 px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            />
          </label>
        </div>
        {start !== "" && end !== "" && start > end && (
          <p className="mt-3 text-xs text-destructive">Start date must be on or before the end date.</p>
        )}
      </Modal>
    </>
  );
}
