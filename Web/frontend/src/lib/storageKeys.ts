/**
 * Browser-storage keys for UI preferences (no credentials are ever stored — see auth.store).
 * Namespaced to this app because on care.deodap.info other apps share the same browser origin,
 * so a generic name ("deodap-theme") could collide with theirs.
 */
export const STORAGE_KEYS = {
  theme: "mcp-dashboard:theme",
  ui: "mcp-dashboard:ui",
  dateRange: "mcp-dashboard:daterange",
} as const;

const LEGACY_KEYS: [legacy: string, current: string][] = [
  ["deodap-theme", STORAGE_KEYS.theme],
  ["deodap-ui", STORAGE_KEYS.ui],
  ["deodap-daterange", STORAGE_KEYS.dateRange],
];

/** Move preferences saved under the old generic keys to the namespaced ones (once). */
export function migrateStoredPreferences(storage: Storage | undefined = globalThis.localStorage): void {
  if (!storage) return;
  try {
    for (const [legacy, current] of LEGACY_KEYS) {
      const value = storage.getItem(legacy);
      if (value === null) continue;
      if (storage.getItem(current) === null) storage.setItem(current, value);
      storage.removeItem(legacy);
    }
  } catch {
    /* storage unavailable: keep defaults */
  }
}

// Runs on first import — before the persisted stores (which import these keys) read storage.
migrateStoredPreferences();
