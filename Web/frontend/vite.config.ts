import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The dev server proxies /api → FastAPI (localhost:8000) so the frontend never
// hard-codes a backend host. Phase 2 can point VITE_API_BASE_URL elsewhere
// without touching any component.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
});
