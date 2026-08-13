import { Check, Download, FileSpreadsheet, FileText, Loader2, Lock } from "lucide-react";
import { useEffect, useState } from "react";
import { PageError } from "@/components/shared/PageError";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { useHasRole } from "@/routes/RoleGuard";
import { apiErrorMessage } from "@/services/api";
import { useExportCatalog, useExportHistory, useHistoryDownload } from "@/services/export.service";
import { useExportStatus } from "@/store/exportStatus";
import type { ExportHistoryOut } from "@/types/api";
import { cn } from "@/lib/utils";
import { formatDateTimeIST, formatNumber } from "@/utils/format";

type Fmt = "csv" | "xlsx";

export default function ExportPage() {
  const { data, isLoading, isError, refetch } = useExportCatalog();
  const { isExporting, startExport } = useExportStatus();
  const history = useExportHistory();
  const historyDownload = useHistoryDownload();
  const { toast } = useToast();
  const canExport = useHasRole("admin", "employee");

  const [dataset, setDataset] = useState<string>("");
  const [fmt, setFmt] = useState<Fmt>("csv");

  useEffect(() => {
    if (data && !dataset) setDataset(data.datasets[0]?.key ?? "");
  }, [data, dataset]);

  if (isError) return <PageError onRetry={() => refetch()} />;

  const onExport = () => {
    // Runs via the app-level provider so the export keeps going (and its toast fires)
    // even if the user navigates away; the success/error toast lives there now.
    const label = data?.datasets.find((d) => d.key === dataset)?.label ?? dataset;
    startExport({ dataset, fmt, label });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {!canExport && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm text-muted-foreground">
          <Lock className="size-4" />
          Your role is read-only and cannot export data.
        </div>
      )}

      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          1 · Choose a dataset
        </h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {isLoading || !data
            ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)
            : data.datasets.map((d) => (
                <button
                  key={d.key}
                  onClick={() => setDataset(d.key)}
                  className={cn(
                    "rounded-xl border p-4 text-left transition-colors",
                    dataset === d.key
                      ? "border-primary bg-primary/[0.06]"
                      : "border-border bg-card hover:border-primary/50",
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{d.label}</span>
                    {dataset === d.key && <Check className="size-4 text-primary" />}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{d.description}</p>
                </button>
              ))}
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          2 · Choose a format
        </h2>
        <div className="mt-3 flex gap-3">
          <FormatOption icon={FileText} label="CSV" active={fmt === "csv"} onClick={() => setFmt("csv")} />
          <FormatOption icon={FileSpreadsheet} label="XLSX" active={fmt === "xlsx"} onClick={() => setFmt("xlsx")} />
        </div>
      </div>

      <Card className="flex items-center justify-between p-4">
        <p className="text-sm text-muted-foreground">
          {data?.datasets.find((d) => d.key === dataset)?.label ?? "—"} · {fmt.toUpperCase()}
        </p>
        <Button onClick={onExport} disabled={!canExport || !dataset || isExporting}>
          {isExporting ? (
            <>
              <Loader2 className="animate-spin" /> Exporting…
            </>
          ) : (
            <>
              <Download /> Export
            </>
          )}
        </Button>
      </Card>

      {/* 3 · Export History — re-download a past export straight from the server's
          stored file (no MCP call, no regeneration). */}
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          3 · Export History
        </h2>
        <Card className="mt-3 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Dataset</th>
                  <th className="px-4 py-2.5 font-medium">Date Range</th>
                  <th className="px-4 py-2.5 font-medium">Format</th>
                  <th className="px-4 py-2.5 text-right font-medium">Records</th>
                  <th className="px-4 py-2.5 font-medium">Exported</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 text-right font-medium">Download</th>
                </tr>
              </thead>
              <tbody>
                {history.isLoading ? (
                  <tr><td className="p-4 text-muted-foreground" colSpan={7}>Loading…</td></tr>
                ) : history.isError ? (
                  // Surface a load failure instead of masquerading as "No exports yet".
                  <tr>
                    <td className="p-4 text-sm text-destructive" colSpan={7}>
                      Couldn't load export history.{" "}
                      <button onClick={() => history.refetch()} className="text-primary hover:underline">Retry</button>
                    </td>
                  </tr>
                ) : (history.data?.items ?? []).length === 0 ? (
                  <tr><td className="p-4 text-muted-foreground" colSpan={7}>No exports yet — run an export above.</td></tr>
                ) : (
                  history.data!.items.map((row) => (
                    <HistoryRow
                      key={row.id}
                      row={row}
                      pending={historyDownload.isPending}
                      onDownload={() =>
                        historyDownload.mutate(row.id, {
                          onError: (err) =>
                            toast({
                              title: "File unavailable",
                              description: apiErrorMessage(err, "The stored export file is no longer available."),
                              variant: "error",
                            }),
                        })
                      }
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}

function HistoryRow({
  row,
  onDownload,
  pending,
}: {
  row: ExportHistoryOut;
  onDownload: () => void;
  pending: boolean;
}) {
  const range = row.date_from && row.date_to ? `${row.date_from} → ${row.date_to}` : "All time";
  const failed = row.status !== "completed";
  return (
    <tr className="border-b border-border/60">
      <td className="px-4 py-2.5 font-medium">{row.dataset}</td>
      <td className="px-4 py-2.5 tabular-nums">{range}</td>
      <td className="px-4 py-2.5 uppercase">{row.fmt}</td>
      <td className="px-4 py-2.5 text-right tabular-nums">{failed ? "—" : formatNumber(row.record_count)}</td>
      <td className="px-4 py-2.5 tabular-nums">{formatDateTimeIST(row.created_at)}</td>
      <td className="px-4 py-2.5">
        {failed ? (
          <span
            className="inline-flex rounded-full bg-destructive/15 px-2 py-0.5 text-xs font-medium text-destructive"
            title={row.error ?? "Export failed"}
          >
            Failed
          </span>
        ) : (
          <span className="inline-flex rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success">
            Completed
          </span>
        )}
      </td>
      <td className="px-4 py-2.5 text-right">
        {failed ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : (
          <button
            onClick={onDownload}
            disabled={pending}
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline disabled:opacity-50"
            title={row.filename}
          >
            <Download className="size-3.5" /> Download
          </button>
        )}
      </td>
    </tr>
  );
}

function FormatOption({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: typeof FileText;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex flex-1 items-center gap-3 rounded-xl border p-4 transition-colors",
        active ? "border-primary bg-primary/[0.06]" : "border-border bg-card hover:border-primary/50",
      )}
    >
      <Icon className={cn("size-5", active ? "text-primary" : "text-muted-foreground")} />
      <span className="font-medium">{label}</span>
      {active && <Check className="ml-auto size-4 text-primary" />}
    </button>
  );
}
