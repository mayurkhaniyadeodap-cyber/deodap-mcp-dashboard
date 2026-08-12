import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AxiosResponse } from "axios";
import { api } from "@/services/api";
import { useDateRange } from "@/store/dateRange.store";
import type { ExportCatalog, ExportHistoryList } from "@/types/api";

/** Save a blob response to disk using the Content-Disposition filename. */
function saveBlob(res: AxiosResponse, fallbackName: string): string {
  const disposition = res.headers["content-disposition"] as string | undefined;
  const match = disposition?.match(/filename="?([^"]+)"?/);
  const filename = match?.[1] ?? fallbackName;
  const url = URL.createObjectURL(res.data as Blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return filename;
}

/** GET /api/export — available datasets + formats. */
export function useExportCatalog() {
  return useQuery({
    queryKey: ["export-catalog"],
    queryFn: async () => (await api.get<ExportCatalog>("/export")).data,
  });
}

/**
 * GET /api/exports — recent export history (metadata only; never calls MCP). It is
 * the source of truth (the DB), NOT local state: `staleTime: 0` + `refetchOnMount:
 * "always"` force a fresh fetch on EVERY page load/refresh (overriding the app-wide
 * 60s staleTime), so history reappears after a browser refresh instead of relying on
 * cache or the last export action.
 */
export function useExportHistory() {
  return useQuery({
    queryKey: ["export-history"],
    queryFn: async () => (await api.get<ExportHistoryList>("/exports")).data,
    refetchOnWindowFocus: false,
    staleTime: 0,
    refetchOnMount: "always",
  });
}

interface DownloadArgs {
  dataset: string;
  fmt: "csv" | "xlsx";
}

/**
 * GET /api/export/{fmt}?dataset&from&to — generates + downloads the file for the
 * CURRENTLY selected date range, and (server-side) records it in Export History. On
 * success we refresh the history list so the new export appears immediately.
 */
export function useExportDownload() {
  const { from, to } = useDateRange();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ dataset, fmt }: DownloadArgs) => {
      const res = await api.get(`/export/${fmt}`, {
        params: { dataset, from, to },
        responseType: "blob",
      });
      return saveBlob(res, `deodap_${dataset}.${fmt}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["export-history"] });
    },
  });
}

/**
 * GET /api/exports/{id}/download — re-download an existing export straight from the
 * server's stored file. Makes ZERO MCP calls and does not regenerate anything. A
 * missing file returns 404 → the caller shows "File unavailable".
 */
export function useHistoryDownload() {
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await api.get(`/exports/${id}/download`, { responseType: "blob" });
      return saveBlob(res, `deodap_export_${id}`);
    },
  });
}
