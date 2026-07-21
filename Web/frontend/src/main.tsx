import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import { ToastProvider } from "@/components/ui/toast";
import App from "./App";
import "./index.css";

// A single QueryClient for the whole app; resource hooks live in src/services/
// (added in later checkpoints).
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      // Without a staleTime, every page mount refetched the (slow) MCP-backed
      // endpoints — so navigating away and back re-ran a ~13s load. 60s marks data
      // fresh long enough to skip those redundant refetches on navigation, matching
      // the backend's 60s caches. The navbar Refresh (invalidateQueries) and the
      // per-hook refetchInterval polls still bypass this, so nothing goes stale.
      staleTime: 60_000,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <App />
      </ToastProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
