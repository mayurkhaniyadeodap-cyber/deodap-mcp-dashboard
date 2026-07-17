import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/** Selected date-range preset. */
export type DatePreset = "today" | "7d" | "30d" | "mtd" | "ytd" | "custom";

export const DATE_PRESET_LABELS: Record<DatePreset, string> = {
  today: "Today",
  "7d": "Last 7 Days",
  "30d": "Last 30 Days",
  mtd: "Month To Date",
  ytd: "Year To Date",
  custom: "Custom Range",
};

/** Presets selectable directly from the dropdown (custom opens the picker). */
export const SELECTABLE_PRESETS: Exclude<DatePreset, "custom">[] = ["today", "7d", "30d", "mtd", "ytd"];

const DEFAULT_PRESET: DatePreset = "30d";

/**
 * Format a Date as YYYY-MM-DD from LOCAL date parts. We deliberately do NOT use
 * Date.toISOString() (that returns UTC and shifts the day near midnight in IST).
 */
export function toLocalISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isIsoDate(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}

/** Compute {from,to} for a preset in the user's LOCAL timezone. */
export function computePresetRange(preset: Exclude<DatePreset, "custom">): { from: string; to: string } {
  const today = new Date();
  const to = toLocalISODate(today);
  const start = new Date(today);
  switch (preset) {
    case "today":
      break;
    case "7d":
      start.setDate(today.getDate() - 6);
      break;
    case "30d":
      start.setDate(today.getDate() - 29);
      break;
    case "mtd":
      start.setFullYear(today.getFullYear(), today.getMonth(), 1);
      break;
    case "ytd":
      start.setFullYear(today.getFullYear(), 0, 1);
      break;
  }
  return { from: toLocalISODate(start), to };
}

interface DateRangeState {
  preset: DatePreset;
  /** Only used when preset === "custom". */
  customFrom: string;
  customTo: string;
  setPreset: (p: Exclude<DatePreset, "custom">) => void;
  setCustomRange: (from: string, to: string) => void;
}

/** localStorage wrapper that never throws (quota/privacy modes) — guards JSON I/O. */
const guardedStorage = {
  getItem: (name: string) => {
    try {
      return localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name: string, value: string) => {
    try {
      localStorage.setItem(name, value);
    } catch {
      /* ignore */
    }
  },
  removeItem: (name: string) => {
    try {
      localStorage.removeItem(name);
    } catch {
      /* ignore */
    }
  },
};

export const useDateRangeStore = create<DateRangeState>()(
  persist(
    (set) => ({
      preset: DEFAULT_PRESET,
      customFrom: "",
      customTo: "",
      setPreset: (p) => set({ preset: p }),
      setCustomRange: (from, to) => set({ preset: "custom", customFrom: from, customTo: to }),
    }),
    {
      name: "deodap-daterange",
      storage: createJSONStorage(() => guardedStorage),
      partialize: (s) => ({ preset: s.preset, customFrom: s.customFrom, customTo: s.customTo }),
      // Validate persisted value; on missing/invalid/corrupt data fall back to the
      // default preset (createJSONStorage already guards JSON.parse → null → default).
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<DateRangeState>;
        let preset: DatePreset =
          p.preset && p.preset in DATE_PRESET_LABELS ? (p.preset as DatePreset) : DEFAULT_PRESET;
        const customFrom = isIsoDate(p.customFrom) ? p.customFrom : "";
        const customTo = isIsoDate(p.customTo) ? p.customTo : "";
        if (preset === "custom" && !(isIsoDate(customFrom) && isIsoDate(customTo) && customFrom <= customTo)) {
          preset = DEFAULT_PRESET;
        }
        return { ...current, preset, customFrom, customTo };
      },
    },
  ),
);

/**
 * Derived date range. Preset dates are recomputed fresh (local time) so "Today"
 * always means today after a refresh; "custom" uses the persisted dates. The
 * returned from/to are plain strings, so they are stable within a day and safe
 * to embed in TanStack Query keys.
 */
export function useDateRange() {
  const preset = useDateRangeStore((s) => s.preset);
  const customFrom = useDateRangeStore((s) => s.customFrom);
  const customTo = useDateRangeStore((s) => s.customTo);
  const setPreset = useDateRangeStore((s) => s.setPreset);
  const setCustomRange = useDateRangeStore((s) => s.setCustomRange);

  let from: string;
  let to: string;
  if (preset === "custom" && isIsoDate(customFrom) && isIsoDate(customTo)) {
    from = customFrom;
    to = customTo;
  } else {
    const range = computePresetRange(preset === "custom" ? "30d" : preset);
    from = range.from;
    to = range.to;
  }

  return { preset, from, to, customFrom, customTo, setPreset, setCustomRange };
}
