import { create } from "zustand";
import { persist } from "zustand/middleware";

interface UIState {
  /** Desktop: icon-only (collapsed) vs expanded sidebar. Persisted. */
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (v: boolean) => void;

  /** Mobile: off-canvas sidebar drawer open state. Not persisted. */
  mobileSidebarOpen: boolean;
  setMobileSidebarOpen: (v: boolean) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),

      mobileSidebarOpen: false,
      setMobileSidebarOpen: (v) => set({ mobileSidebarOpen: v }),
    }),
    {
      name: "deodap-ui",
      // Persist ONLY sidebar collapsed state (date range lives in its own store).
      partialize: (s) => ({ sidebarCollapsed: s.sidebarCollapsed }),
    },
  ),
);
