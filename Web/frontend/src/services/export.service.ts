import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import { useDateRange } from "@/store/dateRange.store";
import type { ExportCatalog } from "@/types/api";

/** GET /api/export — available datasets + formats. */
export function useExportCatalog() {
  return useQuery({
    queryKey: ["export-catalog"],
    queryFn: async () => (await api.get<ExportCatalog>("/export")).data,
  });
}

interface DownloadArgs {
  dataset: string;
  fmt: "csv" | "xlsx";
}

/**
 * GET /api/export/{fmt}?dataset= — downloads the file as a blob and triggers a
 * browser save. The filename comes from the Content-Disposition header.
 */
export function useExportDownload() {
  // Read the SAME range the navbar date-picker drives, so the export reflects
  // whatever the user currently has selected (Today / 7d / 30d / custom).
  const { from, to } = useDateRange();
  return useMutation({
    mutationFn: async ({ dataset, fmt }: DownloadArgs) => {
      const res = await api.get(`/export/${fmt}`, {
        params: { dataset, from, to },
        responseType: "blob",
      });
      const disposition = res.headers["content-disposition"] as string | undefined;
      const match = disposition?.match(/filename="?([^"]+)"?/);
      const filename = match?.[1] ?? `deodap_${dataset}.${fmt}`;

      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      return filename;
    },
  });
}
