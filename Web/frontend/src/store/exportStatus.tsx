import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { useToast } from "@/components/ui/toast";
import { apiErrorMessage } from "@/services/api";
import { useExportDownload } from "@/services/export.service";

type Fmt = "csv" | "xlsx";

interface ExportStatusValue {
  /** True while an export request is in flight (drives the global indicator + button). */
  isExporting: boolean;
  /** Human label of the dataset currently exporting (for the indicator tooltip/text). */
  label: string | null;
  /** Start an export. No-ops if one is already running (prevents duplicate exports). */
  startExport: (args: { dataset: string; fmt: Fmt; label: string }) => void;
}

const ExportStatusContext = createContext<ExportStatusValue | null>(null);

/**
 * App-level export status. Rendered inside AppLayout, which stays mounted across page
 * navigation, so the download mutation keeps running — and its success/error toast
 * still fires — even after the user leaves the Export page. This is what makes the
 * global "Exporting…" indicator survive navigation and lets the Export page reflect
 * the current status when the user returns. History refresh is unchanged: the
 * underlying useExportDownload still invalidates ["export-history"] on success.
 */
export function ExportStatusProvider({ children }: { children: ReactNode }) {
  const download = useExportDownload();
  const { toast } = useToast();
  const [label, setLabel] = useState<string | null>(null);

  const startExport = useCallback(
    ({ dataset, fmt, label: datasetLabel }: { dataset: string; fmt: Fmt; label: string }) => {
      if (download.isPending) return; // one export at a time — never duplicate
      setLabel(datasetLabel);
      download.mutate(
        { dataset, fmt },
        {
          onSuccess: (filename) =>
            toast({ title: "Export ready", description: `${filename} downloaded.`, variant: "success" }),
          onError: (err) =>
            toast({ title: "Export failed", description: apiErrorMessage(err), variant: "error" }),
        },
      );
    },
    [download, toast],
  );

  return (
    <ExportStatusContext.Provider value={{ isExporting: download.isPending, label, startExport }}>
      {children}
    </ExportStatusContext.Provider>
  );
}

export function useExportStatus(): ExportStatusValue {
  const ctx = useContext(ExportStatusContext);
  if (!ctx) throw new Error("useExportStatus must be used within ExportStatusProvider");
  return ctx;
}
