import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AxiosError } from "axios";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/ui/toast";
import { apiErrorMessage } from "@/services/api";
import { useExportDownload } from "@/services/export.service";
import type { ExportHistoryList } from "@/types/api";

type Fmt = "csv" | "xlsx";
/** idle → downloading (request in flight) → polling (request timed out; watching history). */
type Phase = "idle" | "downloading" | "polling";

const HISTORY_KEY = ["export-history"] as const;
const POLL_INTERVAL_MS = 2500; // refresh history every ~2.5s while waiting
const POLL_TIMEOUT_MS = 90_000; // give up watching after 90s (without declaring failure)

/**
 * A 504 / gateway / client-timeout does NOT mean the export failed — the backend may
 * still be generating the file. Treat those as "maybe still running" so we poll history
 * instead of showing "Export failed". A concrete 4xx/5xx WITH a response body is a real
 * failure and is surfaced immediately.
 */
function mayStillBeRunning(err: unknown): boolean {
  if (err instanceof AxiosError) {
    const status = err.response?.status;
    if (status === 502 || status === 503 || status === 504) return true;
    if (err.code === "ECONNABORTED" || err.code === "ETIMEDOUT") return true;
    if (!err.response) return true; // no response at all → gateway/network drop, not a confirmed failure
  }
  return false;
}

interface ExportStatusValue {
  /** True while an export is downloading OR being watched in history (drives the global indicator + button). */
  isExporting: boolean;
  /** Human label of the dataset currently exporting (for the indicator tooltip/text). */
  label: string | null;
  /** Start an export. No-ops if one is already running (prevents duplicate exports). */
  startExport: (args: { dataset: string; fmt: Fmt; label: string }) => void;
}

const ExportStatusContext = createContext<ExportStatusValue | null>(null);

/**
 * App-level export status. Rendered inside AppLayout, which stays mounted across page
 * navigation, so the download mutation — and the post-timeout history watcher — keep
 * running even after the user leaves the Export page. This is what makes the global
 * "Exporting…" indicator survive navigation and lets the Export page reflect the
 * current status when the user returns.
 *
 * Behaviour on a slow export: if the download request 504s/times out, we do NOT show
 * failure. We enter a "polling" phase, refetch Export History every ~2.5s, and finish
 * as soon as the new row appears (Completed → success; failed status/row → failure).
 * The history query is shared by React Query cache, so the Export page table updates
 * automatically with no page refresh.
 */
export function ExportStatusProvider({ children }: { children: ReactNode }) {
  const download = useExportDownload();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [phase, setPhase] = useState<Phase>("idle");
  const [label, setLabel] = useState<string | null>(null);

  // Refs so the poll loop never reads stale state.
  const baselineIds = useRef<Set<number>>(new Set());
  const activeDataset = useRef<string | null>(null);
  const activeFmt = useRef<Fmt | null>(null);
  const pollDeadline = useRef<number>(0);

  const finish = useCallback(
    (t: { title: string; description: string; variant: "success" | "error" | "default" } | null) => {
      setPhase("idle");
      activeDataset.current = null;
      activeFmt.current = null;
      if (t) toast(t);
    },
    [toast],
  );

  const startExport = useCallback(
    ({ dataset, fmt, label: datasetLabel }: { dataset: string; fmt: Fmt; label: string }) => {
      if (phase !== "idle" || download.isPending) return; // one export at a time — never duplicate

      // Snapshot existing history ids so we can spot the NEW row this export produces.
      const current = qc.getQueryData<ExportHistoryList>(HISTORY_KEY);
      baselineIds.current = new Set((current?.items ?? []).map((i) => i.id));
      activeDataset.current = dataset;
      activeFmt.current = fmt;
      setLabel(datasetLabel);
      setPhase("downloading");

      download.mutate(
        { dataset, fmt },
        {
          onSuccess: (filename) =>
            finish({ title: "Export ready", description: `${filename} downloaded.`, variant: "success" }),
          onError: (err) => {
            if (mayStillBeRunning(err)) {
              // The request timed out but the file may still be generating — watch history.
              pollDeadline.current = Date.now() + POLL_TIMEOUT_MS;
              setPhase("polling");
            } else {
              finish({ title: "Export failed", description: apiErrorMessage(err), variant: "error" });
            }
          },
        },
      );
    },
    [phase, download, qc, finish],
  );

  // History watcher — only active during the "polling" phase.
  useEffect(() => {
    if (phase !== "polling") return;
    let stopped = false;

    const tick = async () => {
      if (stopped) return;
      try {
        await qc.refetchQueries({ queryKey: HISTORY_KEY });
      } catch {
        /* transient fetch error — keep polling until the deadline */
      }
      if (stopped) return;

      const data = qc.getQueryData<ExportHistoryList>(HISTORY_KEY);
      const fresh = (data?.items ?? []).find(
        (i) =>
          !baselineIds.current.has(i.id) &&
          i.dataset === activeDataset.current &&
          i.fmt === activeFmt.current,
      );
      if (fresh) {
        stopped = true;
        if (fresh.status === "completed") {
          finish({
            title: "Export ready",
            description: `${fresh.filename} is ready in Export History.`,
            variant: "success",
          });
        } else {
          finish({
            title: "Export failed",
            description: fresh.error ?? "The export could not be completed.",
            variant: "error",
          });
        }
        return;
      }
      if (Date.now() > pollDeadline.current) {
        stopped = true;
        finish({
          title: "Export still processing",
          description: "It's taking longer than usual — it will appear in Export History when ready.",
          variant: "default",
        });
      }
    };

    const id = window.setInterval(() => void tick(), POLL_INTERVAL_MS);
    void tick(); // first check immediately, don't wait a full interval
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [phase, qc, finish]);

  return (
    <ExportStatusContext.Provider value={{ isExporting: phase !== "idle", label, startExport }}>
      {children}
    </ExportStatusContext.Provider>
  );
}

export function useExportStatus(): ExportStatusValue {
  const ctx = useContext(ExportStatusContext);
  if (!ctx) throw new Error("useExportStatus must be used within ExportStatusProvider");
  return ctx;
}
