import { useState } from "react";
import { Bug, RefreshCw } from "lucide-react";
import { SourceBadge } from "@/components/shared/SourceBadge";
import { Card } from "@/components/ui/card";
import { api } from "@/services/api";
import { useMCPStatus, useSchedulers } from "@/services/status.service";
import { badgeFromSource } from "@/utils/source";

type PerfHeaders = {
  calls?: string;
  real?: string;
  cache?: string;
  mcp?: string;
  endpoint?: string;
};

const PERF_TARGETS = ["/_status", "/sla-performance", "/cod", "/couriers"];

/**
 * Admin-only Debug Panel. Reuses EXISTING endpoints only:
 *   /_status            → per-endpoint source + MCP tools + response time
 *   /_status/schedulers → warm-cache scheduler telemetry (additive admin endpoint)
 *   /_mcp/probe         → raw MCP tool response (requires ENABLE_MCP_DEBUG)
 * MCP performance is read from the opt-in x-perf-debug response headers (Task 6).
 * No backend logic is invoked beyond these; no MCP request is added.
 */
export default function AdminDebugPage() {
  const status = useMCPStatus(true);
  const schedulers = useSchedulers(true);

  // --- MCP performance (opt-in headers) ---
  const [perf, setPerf] = useState<PerfHeaders | null>(null);
  const [perfTarget, setPerfTarget] = useState(PERF_TARGETS[0]);
  const [perfLoading, setPerfLoading] = useState(false);
  const runPerf = async () => {
    setPerfLoading(true);
    try {
      const res = await api.get(perfTarget, { headers: { "x-perf-debug": "1" } });
      const h = res.headers;
      setPerf({
        calls: h["x-mcp-calls"],
        real: h["x-mcp-real-calls"],
        cache: h["x-mcp-cache-hits"],
        mcp: h["x-mcp-seconds"],
        endpoint: h["x-endpoint-seconds"],
      });
    } catch {
      setPerf(null);
    } finally {
      setPerfLoading(false);
    }
  };

  // --- Raw MCP response viewer ---
  const [tool, setTool] = useState("sla_performance");
  const [raw, setRaw] = useState<string | null>(null);
  const [rawErr, setRawErr] = useState<string | null>(null);
  const [rawLoading, setRawLoading] = useState(false);
  const runProbe = async () => {
    setRawLoading(true);
    setRawErr(null);
    setRaw(null);
    try {
      const res = await api.get("/_mcp/probe", { params: { tool } });
      setRaw(JSON.stringify(res.data, null, 2));
    } catch (e) {
      setRawErr(
        (e as { response?: { status?: number } })?.response?.status === 404
          ? "MCP debug proxy is disabled (set ENABLE_MCP_DEBUG=true) or the tool name is unknown."
          : "Probe failed.",
      );
    } finally {
      setRawLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Bug className="size-5 text-primary" />
        <h1 className="text-2xl font-semibold tracking-tight">Admin Debug Panel</h1>
      </div>

      {/* Endpoint status (from /_status) */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-border p-4">
          <h3 className="text-lg font-semibold">Endpoints</h3>
          <button onClick={() => status.refetch()} className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
            <RefreshCw className="size-3.5" /> Refresh
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Endpoint</th>
                <th className="px-4 py-2.5 font-medium">MCP Tool(s)</th>
                <th className="px-4 py-2.5 text-right font-medium">Response Time</th>
                <th className="px-4 py-2.5 font-medium">Cache Status</th>
              </tr>
            </thead>
            <tbody>
              {status.isLoading ? (
                <tr><td className="p-4 text-muted-foreground" colSpan={4}>Probing endpoints… (slow on a cold cache)</td></tr>
              ) : (
                (status.data?.endpoints ?? []).map((e) => (
                  <tr key={e.endpoint} className="border-b border-border/60">
                    <td className="px-4 py-2.5 font-mono text-xs">{e.endpoint}</td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-muted-foreground">{e.mcp_tools.join(", ")}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{e.load_ms} ms</td>
                    <td className="px-4 py-2.5"><SourceBadge status={badgeFromSource(e.source)} /></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Scheduler status (from /_status/schedulers) */}
      <Card className="overflow-hidden">
        <div className="border-b border-border p-4">
          <h3 className="text-lg font-semibold">Schedulers</h3>
          <p className="mt-1 text-sm text-muted-foreground">Background warm-cache refreshers · ages are relative (monotonic clock).</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Scheduler</th>
                <th className="px-4 py-2.5 font-medium">Running</th>
                <th className="px-4 py-2.5 text-right font-medium">Cadence</th>
                <th className="px-4 py-2.5 text-right font-medium">Cache Age</th>
                <th className="px-4 py-2.5 text-right font-medium">Next Refresh</th>
              </tr>
            </thead>
            <tbody>
              {(schedulers.data?.schedulers ?? []).map((s) => (
                <tr key={s.name} className="border-b border-border/60">
                  <td className="px-4 py-2.5 font-medium">{s.name}</td>
                  <td className="px-4 py-2.5">{s.running ? "Yes" : "No"}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{s.cadence_seconds}s</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{s.cache_age_seconds == null ? "—" : `${s.cache_age_seconds}s`}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{s.next_refresh_seconds == null ? "—" : `${s.next_refresh_seconds}s`}</td>
                </tr>
              ))}
              {!schedulers.isLoading && (schedulers.data?.schedulers ?? []).length === 0 && (
                <tr><td className="p-4 text-muted-foreground" colSpan={5}>No scheduler data.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* MCP performance (opt-in headers) */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
          <h3 className="text-lg font-semibold">MCP Performance</h3>
          <select value={perfTarget} onChange={(e) => setPerfTarget(e.target.value)} className="rounded-md border border-border bg-background px-2 py-1 text-sm">
            {PERF_TARGETS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <button onClick={runPerf} disabled={perfLoading} className="rounded-md bg-primary px-3 py-1 text-sm font-medium text-primary-foreground disabled:opacity-50">
            {perfLoading ? "Measuring…" : "Measure"}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-5">
          {[
            { label: "Total Calls", v: perf?.calls },
            { label: "Real MCP Calls", v: perf?.real },
            { label: "Cache Hits", v: perf?.cache },
            { label: "MCP Time", v: perf?.mcp != null ? `${perf.mcp}s` : undefined },
            { label: "Endpoint Time", v: perf?.endpoint != null ? `${perf.endpoint}s` : undefined },
          ].map((m) => (
            <div key={m.label} className="rounded-lg border border-border p-3">
              <div className="text-xs text-muted-foreground">{m.label}</div>
              <div className="mt-1 text-lg font-semibold tabular-nums">{m.v ?? "—"}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* Raw MCP response viewer (/_mcp/probe) */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
          <h3 className="text-lg font-semibold">Raw MCP Response</h3>
          <input value={tool} onChange={(e) => setTool(e.target.value)} placeholder="tool name (e.g. sla_performance)" className="w-64 rounded-md border border-border bg-background px-2 py-1 text-sm" />
          <button onClick={runProbe} disabled={rawLoading} className="rounded-md bg-primary px-3 py-1 text-sm font-medium text-primary-foreground disabled:opacity-50">
            {rawLoading ? "Probing…" : "Probe"}
          </button>
        </div>
        <div className="p-4">
          {rawErr ? (
            <p className="text-sm text-destructive">{rawErr}</p>
          ) : raw ? (
            <pre className="max-h-96 overflow-auto rounded-lg bg-[#0f1525] p-3 text-[11px] leading-snug text-[#cbd5e1]">{raw}</pre>
          ) : (
            <p className="text-sm text-muted-foreground">Enter a tool name and probe to see its raw MCP response.</p>
          )}
        </div>
      </Card>
    </div>
  );
}
