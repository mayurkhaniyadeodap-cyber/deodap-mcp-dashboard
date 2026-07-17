import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import type { SettingsResponse } from "@/types/api";

/** GET /api/settings — courier connections, rate-card meta, read-only system preferences. */
export function useSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: async () => (await api.get<SettingsResponse>("/settings")).data,
  });
}
