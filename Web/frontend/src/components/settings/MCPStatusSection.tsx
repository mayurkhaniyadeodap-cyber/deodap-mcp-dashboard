import { AlertTriangle, Ban, CheckCircle2, RefreshCw, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useMCPStatus } from "@/services/status.service";
import type { EndpointStatus } from "@/types/api";

// The known SLOW endpoints (own caches, skipped unless Include-slow). Used only to
// compute a "not probed" count — never to change what the server returns.
const SLOW_ENDPOINTS = ["/api/trend-recovery", "/api/savings-opportunity"];


function SourcePill({ source }: { source: EndpointStatus["source"] }) {
  const live = source === "live";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold",
        live ? "bg-success/15 text-success" : "bg-muted text-muted-foreground",
      )}
    >
      <span className={cn("size-1.5 rounded-full", live ? "bg-success" : "bg-muted-foreground/60")} />
      {live ? "Live" : "Mock"}
    </span>
  );
}

function Indicator({ ok, label, okText, badText }: { ok: boolean; label: string; okText: string; badText: string }) {
  const Icon = ok ? CheckCircle2 : XCircle;
  return (
    <div className="flex items-center gap-2">
      <Icon className={cn("size-4 shrink-0", ok ? "text-success" : "text-destructive")} />
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="truncate text-sm font-medium">{ok ? okText : badText}</div>
      </div>
    </div>
  );
}

export function MCPStatusSection() {
  const [includeSlow, setIncludeSlow] = useState(false);
  const { data, isLoading, isFetching, refetch } = useMCPStatus(includeSlow);

  const endpoints = data?.endpoints ?? [];

  // Header counts — ALL derived from the actual response at render time.
  const liveCount = endpoints.filter((e) => e.source === "live").length;
  const mockCount = endpoints.filter((e) => e.source === "mock").length;
  const probed = new Set(endpoints.map((e) => e.endpoint));
  const notProbed = SLOW_ENDPOINTS.filter((s) => !probed.has(s)).length; // skipped slow endpoints
  // Capabilities are decided LIVE from the MCP tool schemas (server-side). Blocked
  // count = those still unavailable — never a hardcoded number.
  const capabilities = data?.capabilities ?? [];
  const blockedGroups = capabilities.filter((c) => !c.available);
  const resolvedGroups = capabilities.filter((c) => c.available);
  const blockedCount = blockedGroups.length;

  // Tool Health — built by INVERTING endpoint → mcp_tools from the response. No MCP call.
  const toolHealth = useMemo(() => {
    const map = new Map<string, { endpoints: string[]; maxMs: number }>();
    for (const e of endpoints) {
      for (const tool of e.mcp_tools) {
        const cur = map.get(tool) ?? { endpoints: [], maxMs: 0 };
        cur.endpoints.push(e.endpoint);
        cur.maxMs = Math.max(cur.maxMs, e.load_ms);
        map.set(tool, cur);
      }
    }
    return [...map.entries()]
      .map(([tool, v]) => ({ tool, endpoints: v.endpoints, count: v.endpoints.length, maxMs: v.maxMs }))
      .sort((a, b) => b.count - a.count || a.tool.localeCompare(b.tool));
  }, [endpoints]);

  return (
    <div className="space-y-4">
      {/* Header — connection summary + computed counts + controls */}
      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle>MCP Status</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Live-vs-mock across every dashboard endpoint · probed concurrently · cached 60s.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={includeSlow}
                onChange={(e) => setIncludeSlow(e.target.checked)}
                className="size-3.5 accent-[var(--primary)]"
              />
              Include slow
            </label>
            <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={cn("size-4", isFetching && "animate-spin")} />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading || !data ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-11 w-full" />)}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Indicator ok={data.mcp_connected} label="MCP Connected" okText="Connected" badText="Unreachable" />
                <div className="flex items-center gap-2">
                  <div className="grid size-4 place-items-center rounded-sm bg-primary/15 text-[10px] font-bold text-primary">{data.tool_count}</div>
                  <div className="min-w-0">
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Tools</div>
                    <div className="truncate text-sm font-medium">{data.tool_count} available</div>
                  </div>
                </div>
                <Indicator ok={data.token_present} label="Token" okText="Present" badText="Missing" />
                <div className="min-w-0">
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">MCP URL</div>
                  <div className="truncate text-sm font-medium" title={data.mcp_url}>{data.mcp_url}</div>
                </div>
              </div>
              {/* Computed summary line — every count from the response (never hardcoded). */}
              <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
                <span className="font-semibold">{data.tool_count}</span> tools ·{" "}
                <span className="font-semibold text-success">{liveCount}</span> live ·{" "}
                <span className={cn("font-semibold", mockCount > 0 && "text-warning")}>{mockCount}</span> mock ·{" "}
                <span className="font-semibold">{notProbed}</span> not probed
                {notProbed > 0 ? " (slow — enable Include slow)" : ""} ·{" "}
                <span className="font-semibold text-success">{resolvedGroups.length}</span> capabilities unblocked ·{" "}
                <span className={cn("font-semibold", blockedCount > 0 && "text-warning")}>{blockedCount}</span> blocked pending MCP enhancement
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Per-endpoint table */}
      <Card>
        <CardHeader>
          <CardTitle>Endpoint Status</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading || !data ? (
            <div className="space-y-2">
              {Array.from({ length: 9 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-2 py-2 font-medium">Endpoint</th>
                    <th className="px-2 py-2 font-medium">Source</th>
                    <th className="px-2 py-2 font-medium">MCP tools used</th>
                    <th className="px-2 py-2 text-right font-medium">Load</th>
                    <th className="px-2 py-2 font-medium">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {endpoints.map((e) => (
                    <tr key={e.endpoint} className="align-top">
                      <td className="whitespace-nowrap px-2 py-2.5 font-mono text-xs font-medium">{e.endpoint}</td>
                      <td className="px-2 py-2.5"><SourcePill source={e.source} /></td>
                      <td className="px-2 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {e.mcp_tools.map((t) => (
                            <span key={t} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">{t}</span>
                          ))}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums text-muted-foreground">
                        {e.load_ms.toLocaleString()} ms
                      </td>
                      <td className="px-2 py-2.5 text-xs text-muted-foreground">{e.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tool Health — inverted from the endpoint list above (no extra MCP call) */}
      <Card>
        <CardHeader>
          <CardTitle>Tool Health</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-xs italic text-muted-foreground">
            Cold probe times under concurrent load. May be inflated by client-side call queuing — pending
            verification. Not a per-tool benchmark.
          </p>
          {isLoading || !data ? (
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-2 py-2 font-medium">MCP Tool</th>
                    <th className="px-2 py-2 font-medium">Used By (endpoints)</th>
                    <th className="px-2 py-2 text-right font-medium"># Endpoints</th>
                    <th className="px-2 py-2 text-right font-medium">Slowest endpoint using this tool (ms)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {toolHealth.map((t) => (
                    <tr key={t.tool} className="align-top">
                      <td className="whitespace-nowrap px-2 py-2.5 font-mono text-xs font-medium">{t.tool}</td>
                      <td className="px-2 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {t.endpoints.map((ep) => (
                            <span key={ep} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">{ep}</span>
                          ))}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums font-medium">{t.count}</td>
                      <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums text-muted-foreground">
                        {t.maxMs.toLocaleString()} ms
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Capabilities — decided live from the MCP tool schemas. Blocked = still
          unavailable; Unblocked = a tool/param now satisfies it. */}
      <Card>
        <CardHeader className="flex-row items-center gap-2 space-y-0">
          <Ban className="size-4 text-warning" />
          <CardTitle className="text-base">
            Capabilities — {blockedCount} blocked, {resolvedGroups.length} unblocked (live from tool schemas)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {isLoading || !data ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : (
            <>
              {blockedGroups.length > 0 && (
                <ul className="space-y-3">
                  {blockedGroups.map((g) => (
                    <li key={g.domain} className="grid grid-cols-1 gap-1 sm:grid-cols-[130px_1fr] sm:gap-3">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                        <span className="text-sm font-semibold">{g.domain}</span>
                      </div>
                      <div className="min-w-0 sm:pt-0.5">
                        <div className="text-sm">{g.capability}</div>
                        <pre className="mt-1 whitespace-pre-wrap break-words rounded bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground">
                          Needs: {g.needs}
                        </pre>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {resolvedGroups.length > 0 && (
                <div>
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Recently unblocked
                  </div>
                  <ul className="space-y-3">
                    {resolvedGroups.map((g) => (
                      <li key={g.domain} className="grid grid-cols-1 gap-1 sm:grid-cols-[130px_1fr] sm:gap-3">
                        <div className="flex items-start gap-2">
                          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                          <span className="text-sm font-semibold">{g.domain}</span>
                        </div>
                        <div className="min-w-0 sm:pt-0.5">
                          <div className="text-sm">{g.capability}</div>
                          <pre className="mt-1 whitespace-pre-wrap break-words rounded bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground">
                            {g.resolved_by ? `Resolved by: ${g.resolved_by}` : `Satisfies: ${g.needs}`}
                          </pre>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
