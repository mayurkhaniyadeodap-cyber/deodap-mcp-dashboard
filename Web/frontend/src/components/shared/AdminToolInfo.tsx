import { Database } from "lucide-react";
import { ENDPOINT_TOOLS } from "@/config/mcpTools";
import { useHasRole } from "@/routes/RoleGuard";

/**
 * Admin-only affordance showing a card's Data Source + MCP tool(s), from the static
 * ENDPOINT_TOOLS map (mirrors status_service._specs — no MCP call). Renders nothing
 * for non-admins or unknown endpoints, so it's safe to drop onto any ChartCard.
 */
export function AdminToolInfo({ endpoint }: { endpoint: string }) {
  const isAdmin = useHasRole("admin");
  const tools = ENDPOINT_TOOLS[endpoint];
  if (!isAdmin || !tools) return null;

  return (
    <span className="group relative inline-flex shrink-0">
      <Database className="size-3.5 cursor-help text-muted-foreground/70" tabIndex={0} aria-label={`Data source ${endpoint}`} />
      <span
        role="tooltip"
        className="pointer-events-none absolute right-0 top-full z-30 mt-1.5 w-64 rounded-lg border border-[#334155] bg-[#1a2236] p-2.5 text-xs leading-snug text-[#f1f5f9] opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        <span className="block font-semibold">Data Source</span>
        <span className="block font-mono text-[11px] text-[#cbd5e1]">{endpoint}</span>
        <span className="mt-1.5 block font-semibold">MCP Tool{tools.length > 1 ? "s" : ""}</span>
        <span className="block font-mono text-[11px] text-[#cbd5e1]">{tools.join(", ")}</span>
      </span>
    </span>
  );
}
