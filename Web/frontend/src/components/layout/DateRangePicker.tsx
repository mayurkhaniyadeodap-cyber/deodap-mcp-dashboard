import { Calendar, CalendarDays, Check, ChevronDown } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dropdown, DropdownItem } from "@/components/ui/dropdown";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";
import { DATE_PRESET_LABELS, SELECTABLE_PRESETS, useDateRange } from "@/store/dateRange.store";
import { formatDateIST } from "@/utils/format";

/**
 * Date-range selector. Selecting a preset updates the shared date-range store,
 * which flows into every date-aware query key → queries refetch automatically
 * (no manual refetch). "Custom Range" opens a picker that only applies on click.
 */
export function DateRangePicker() {
  const { preset, from, to, customFrom, customTo, setPreset, setCustomRange } = useDateRange();

  const [modalOpen, setModalOpen] = useState(false);
  const [start, setStart] = useState(customFrom);
  const [end, setEnd] = useState(customTo);

  // "Today" is a still-arriving partial day — say so wherever the range is shown.
  const label =
    preset === "custom"
      ? `${formatDateIST(from)} – ${formatDateIST(to)}`
      : preset === "today"
        ? "Today (partial)"
        : DATE_PRESET_LABELS[preset];

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
      <Dropdown
        align="end"
        trigger={({ toggle, open }) => (
          <button
            onClick={toggle}
            className={cn(
              "flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent",
              open && "bg-accent",
            )}
          >
            <Calendar className="size-4 text-muted-foreground" />
            <span className="hidden sm:inline">{label}</span>
            <ChevronDown className="size-4 text-muted-foreground" />
          </button>
        )}
      >
        {SELECTABLE_PRESETS.map((key) => (
          <DropdownItem key={key} onClick={() => setPreset(key)}>
            <Check className={cn("size-4", key === preset ? "text-primary" : "opacity-0")} />
            {key === "today" ? "Today (partial — orders still arriving)" : DATE_PRESET_LABELS[key]}
          </DropdownItem>
        ))}
        <div className="my-1 border-t border-border" />
        <DropdownItem onClick={openCustom}>
          <CalendarDays className={cn("size-4", preset === "custom" ? "text-primary" : "text-muted-foreground")} />
          {DATE_PRESET_LABELS.custom}…
        </DropdownItem>
      </Dropdown>

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
              className="h-10 w-full rounded-md border border-border bg-background/60 px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background [color-scheme:dark]"
            />
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="font-medium text-foreground">To</span>
            <input
              type="date"
              value={end}
              min={start || undefined}
              onChange={(e) => setEnd(e.target.value)}
              className="h-10 w-full rounded-md border border-border bg-background/60 px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background [color-scheme:dark]"
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
