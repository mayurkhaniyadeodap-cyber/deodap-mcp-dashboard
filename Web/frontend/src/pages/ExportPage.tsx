import { Check, Download, FileSpreadsheet, FileText, Loader2, Lock } from "lucide-react";
import { useEffect, useState } from "react";
import { PageError } from "@/components/shared/PageError";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { useHasRole } from "@/routes/RoleGuard";
import { apiErrorMessage } from "@/services/api";
import { useExportCatalog, useExportDownload } from "@/services/export.service";
import { cn } from "@/lib/utils";

type Fmt = "csv" | "xlsx";

export default function ExportPage() {
  const { data, isLoading, isError, refetch } = useExportCatalog();
  const download = useExportDownload();
  const { toast } = useToast();
  const canExport = useHasRole("admin", "employee");

  const [dataset, setDataset] = useState<string>("");
  const [fmt, setFmt] = useState<Fmt>("csv");

  useEffect(() => {
    if (data && !dataset) setDataset(data.datasets[0]?.key ?? "");
  }, [data, dataset]);

  if (isError) return <PageError onRetry={() => refetch()} />;

  const onExport = () => {
    download.mutate(
      { dataset, fmt },
      {
        onSuccess: (filename) =>
          toast({ title: "Export ready", description: `${filename} downloaded.`, variant: "success" }),
        onError: (err) =>
          toast({ title: "Export failed", description: apiErrorMessage(err), variant: "error" }),
      },
    );
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
        <Button onClick={onExport} disabled={!canExport || !dataset || download.isPending}>
          {download.isPending ? (
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
    </div>
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
