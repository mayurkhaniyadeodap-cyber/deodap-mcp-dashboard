import { Calendar, Check, Database, Download, FileSpreadsheet, FileText, Loader2, Lock } from "lucide-react";
import { useEffect, useState } from "react";
import { PageError } from "@/components/shared/PageError";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { useHasRole } from "@/routes/RoleGuard";
import { apiErrorMessage } from "@/services/api";
import { useExportCatalog, useExportHistory, useHistoryDownload } from "@/services/export.service";
import { DATE_PRESET_LABELS, useDateRange } from "@/store/dateRange.store";
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
  const { preset, from, to } = useDateRange();
  const { toast } = useToast();
  const canExport = useHasRole("admin", "employee");

  const [dataset, setDataset] = useState<string>("");
  const [fmt, setFmt] = useState<Fmt>("csv");

  useEffect(() => {
    if (data && !dataset) setDataset(data.datasets[0]?.key ?? "");
  }, [data, dataset]);

  if (isError) return <PageError onRetry={() => refetch()} />;

  const selected = data?.datasets.find((d) => d.key === dataset);
  const rangeLabel = from && to ? `${from} → ${to}` : "All time";

  const onExport = () => {
    // Runs via the app-level provider so the export keeps going (and its toast/history
    // watcher fire) even if the user navigates away.
    startExport({ dataset, fmt, label: selected?.label ?? dataset });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Export Data</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Download analytics datasets as CSV or Excel for the currently selected date range.
        </p>
      </div>

      {!canExport && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm text-muted-foreground">
          <Lock className="size-4 shrink-0" />
          Your role is read-only and cannot export data.
        </div>
      )}

      {/* 1 · Dataset */}
      <section className="space-y-3">
        <StepLabel n={1} title="Choose a dataset" />
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {isLoading || !data
            ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[72px] w-full rounded-lg" />)
            : data.datasets.map((d) => {
                const active = dataset === d.key;
                return (
                  <button
                    key={d.key}
                    onClick={() => setDataset(d.key)}
                    className={cn(
                      "group rounded-lg border p-3.5 text-left transition-colors",
                      active
                        ? "border-primary bg-primary/[0.06]"
                        : "border-border bg-card hover:border-primary/50",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="truncate font-medium">{d.label}</span>
                      <span
                        className={cn(
                          "grid size-4 shrink-0 place-items-center rounded-full transition-colors",
                          active ? "text-primary" : "text-transparent",
                        )}
                      >
                        <Check className="size-4" />
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{d.description}</p>
                  </button>
                );
              })}
        </div>
      </section>

      {/* 2 · Format */}
      <section className="space-y-3">
        <StepLabel n={2} title="Choose a format" />
        <div className="inline-flex rounded-lg border border-border bg-card p-1">
          {(["csv", "xlsx"] as Fmt[]).map((f) => {
            const active = fmt === f;
            const Icon = f === "csv" ? FileText : FileSpreadsheet;
            return (
              <button
                key={f}
                onClick={() => setFmt(f)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
                  active
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-4" />
                {f.toUpperCase()}
              </button>
            );
          })}
        </div>
      </section>

      {/* Summary + Export */}
      <Card className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <Fact icon={Database} label="Dataset" value={selected?.label ?? "—"} />
          <Fact icon={Calendar} label={DATE_PRESET_LABELS[preset]} value={rangeLabel} mono />
          <Fact icon={fmt === "csv" ? FileText : FileSpreadsheet} label="Format" value={fmt.toUpperCase()} />
        </div>
        <Button
          onClick={onExport}
          disabled={!canExport || !dataset || isExporting}
          className="w-full shrink-0 sm:w-auto"
        >
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
      <section className="space-y-3">
        <StepLabel n={3} title="Export History" />
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
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
                  <tr>
                    <td className="p-4 text-muted-foreground" colSpan={7}>
                      Loading…
                    </td>
                  </tr>
                ) : history.isError ? (
                  // Surface a load failure instead of masquerading as "No exports yet".
                  <tr>
                    <td className="p-4 text-sm text-destructive" colSpan={7}>
                      Couldn't load export history.{" "}
                      <button onClick={() => history.refetch()} className="text-primary hover:underline">
                        Retry
                      </button>
                    </td>
                  </tr>
                ) : (history.data?.items ?? []).length === 0 ? (
                  <tr>
                    <td className="p-4 text-muted-foreground" colSpan={7}>
                      No exports yet — run an export above.
                    </td>
                  </tr>
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
      </section>
    </div>
  );
}

function StepLabel({ n, title }: { n: number; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="grid size-5 place-items-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
        {n}
      </span>
      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
    </div>
  );
}

function Fact({
  icon: Icon,
  label,
  value,
  mono,
}: {
  icon: typeof Database;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={cn("truncate font-medium", mono && "tabular-nums")}>{value}</p>
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
    <tr className="border-b border-border/60 last:border-0 hover:bg-accent/40">
      <td className="max-w-[180px] px-4 py-2.5">
        <span className="block truncate font-medium" title={row.dataset}>
          {row.dataset}
        </span>
      </td>
      <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-muted-foreground">{range}</td>
      <td className="px-4 py-2.5">
        <span className="inline-flex rounded bg-muted px-1.5 py-0.5 text-xs font-medium uppercase text-muted-foreground">
          {row.fmt}
        </span>
      </td>
      <td className="px-4 py-2.5 text-right tabular-nums">{failed ? "—" : formatNumber(row.record_count)}</td>
      <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-muted-foreground">
        {formatDateTimeIST(row.created_at)}
      </td>
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
