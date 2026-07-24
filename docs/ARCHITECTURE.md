# DeoDap MCP Courier Dashboard — Architecture & Operations

Production-readiness reference for the Courier Billing Dashboard. Covers the
architecture, the (third-party) MCP integration, the scheduler + cache strategy,
admin/debug tooling, testing, health checks, and deployment.

> **Golden rule:** this project **consumes** the third-party Ship MCP server; it
> never owns or modifies MCP tools, requests, or calculations. Every MCP response
> is treated as the source of truth. All dashboard numbers are either a live MCP
> field or a clearly-labelled local derivation of live fields — never fabricated.

---

## 1. System architecture

```
React (Vite + TanStack Query)                 FastAPI                 Ship MCP (3rd-party)
─────────────────────────────      ───────────────────────────      ───────────────────────
Pages/components  ──HTTP──▶  /api/* routers ──▶ services ──▶ mcp_client.call_tool ──▶ tools
   (services/*.ts)              (api/routers)     (services/*)     (transport + cache)
                               ◀── JSON (source-tagged) ──────────────────────────────
```

- **Frontend** — React 18 + Vite + TypeScript, TanStack Query for data fetching
  (global `staleTime` 60s, `retry: 1`, no refetch-on-focus). API types are
  **generated** from the backend OpenAPI (`pnpm gen:types` → `src/types/api.gen.ts`);
  friendly aliases live in `src/types/api.ts`. Auth is a JWT in a Zustand store.
- **Backend** — FastAPI. Routers (`app/api/routers`) are thin; each delegates to a
  service (`app/services`) that is the only data source. Services call the MCP via a
  single `mcp_client`. Pydantic schemas (`app/schemas`) define every response shape.
- **MCP** — external analytics server reached over `streamable-http`/`sse` with a
  URL `mcp_token`. ~21 read-only tools (e.g. `order_analytics`, `shipping_cost_summary`,
  `sla_performance`, `cod_remittance_aging`, `geo_performance`, `reconciliation_disputes`).
- **Local DB** — SQLite (users/profile only, via SQLAlchemy). No dashboard data is stored.

## 2. MCP integration

- **Client** — `app/services/mcp_client.py`. `call_tool(name, args)` connects with the
  first working transport/auth combo (cached), plus:
  - **Single-flight**: concurrent identical calls share one in-flight request.
  - **TTL cache** (60s): a completed result is reused; **errors are never cached**.
- **Parsing** — `live_support.parse_tool_json()` extracts the JSON payload (text block
  or `structuredContent`).
- **Live-or-mock** — `live_support.live_or_mock()` wraps each service: on ANY MCP
  failure it returns the service's honest fallback. With `USE_MOCK_FALLBACK=False`
  (production default) the fallback is an **empty `source="unavailable"`** response —
  **never fixture numbers**. Fixtures load only in dev when the flag is on.
- **Provenance** — every analytics response carries a `source` field
  (`live` / `sample` / `unavailable`) that drives the frontend `SourceBadge`.
- **Do-not-touch boundary** — MCP tool names, arguments, and server-side calculations
  are fixed. Known third-party data quirks (inter-tool count differences, dirty
  `customer_state` labels, occasional impossible values) are **normalized/guarded**
  in the backend, never "fixed" upstream.

## 3. Scheduler workflow (warm caches)

Slow MCP fan-outs never run on the request path. A background scheduler recomputes
each on a fixed cadence and stores the last-good result; the endpoint always serves
the warm value instantly (stale-while-revalidate). Started in `main.py` on startup:

| Scheduler | Endpoint | Cadence | Serve TTL |
|---|---|---|---|
| dashboard | `/api/dashboard` | 5 min | 6 min |
| trend-recovery | `/api/trend-recovery` | 10 min | 10 min |
| savings | `/api/savings-opportunity` | 30 min | 30 min |
| claimable | `/api/disputes/claimable-rate` | 30 min | 30 min |
| dispute-lines | `/api/disputes/lines` | 30 min | 30 min |

**Serve rules:** fresh → serve; stale → serve last-good **and** refresh in the
background (`recalculating`); cold → compute once (or `computing` placeholder).
**Failure-safe:** a failed refresh is logged and the last-good value is kept — the
scheduler loop never crashes (covered by `tests/test_scheduler.py`).

## 4. Cache strategy

| Layer | Where | TTL | Notes |
|---|---|---|---|
| MCP tool cache + single-flight | `mcp_client` | 60s | de-dupes identical tool calls; errors never cached |
| Per-service result cache | `live_support.new_cache()` keyed by `(from,to)` | 60s | one per analytics service |
| Warm caches | scheduler services | 6–30 min | see §3; served instantly |
| Frontend query cache | TanStack Query | 60s stale | `retry: 1`, no focus refetch |

Invalidation is time-based (no manual bust in normal operation); `clear_tool_cache()`
exists for tests.

## 5. Admin / debug features

All admin-gated (role `admin`); additive and off the normal user path.

- **MCP Status** (`/api/_status`) — live-vs-mock snapshot per endpoint (source, MCP
  tools, response time).
- **Scheduler status** (`GET /api/_status/schedulers`, admin) — cache age / next
  refresh from the existing warm timestamps.
- **Admin Debug Panel** (`/admin-debug`, admin) — endpoint table, scheduler table,
  MCP performance (opt-in headers), and a raw MCP response viewer via `/api/_mcp/probe`
  (requires `ENABLE_MCP_DEBUG=true`, off in production).
- **Chart tool info** — admins see a card's data source + MCP tool(s) (static map,
  no extra MCP call).
- **MCP performance headers** — sent **only** when a request carries `x-perf-debug`
  (the Debug Panel): `X-MCP-Calls`, `X-MCP-Real-Calls`, `X-MCP-Cache-Hits`,
  `X-MCP-Seconds`, `X-Endpoint-Seconds`. Normal traffic is unaffected.

## 6. Monitoring & logging

- **Per-request perf log** (`perf` logger): endpoint time, MCP time, cache hit/miss,
  call counts — one line per request (`middleware/perf.py`).
- **Live logger** (`live`): every service logs `served LIVE` / `serving 'unavailable'`
  with the real exception on failure (MCP failures always log a clear reason).
- **Scheduler logs**: each refresh logs done/failed with the window.
- **Startup diagnostics**: env, scheduler count, `mcp_configured`, and a best-effort
  MCP connectivity probe (non-blocking, non-fatal).

## 7. Health checks

| Probe | Path | Meaning |
|---|---|---|
| Liveness | `GET /api/health/live` | process is up (fast; no MCP/DB). Restart if failing. |
| Readiness | `GET /api/health/ready` | 200 once schedulers launched **and** MCP configured; 503 during boot. Does **not** call MCP, so a transient MCP blip degrades to `unavailable` rather than failing readiness. |
| Legacy | `GET /api/health` | simple `{status: ok}` (kept for the frontend). |

## 8. Testing

Offline, deterministic backend suite (`Web/backend/tests`, `pytest`):

- `test_unit.py` — helpers (`rate_pct`, `date_args`, `parse_tool_json`,
  `scheduler_snapshot`) and state normalization (`_canon_state`).
- `test_api.py` — every analytics endpoint with **mocked MCP** (`mock_mcp` routes
  `call_tool` by tool name to canned payloads), plus the honest `unavailable`
  fallback and the negative-avg-days guard.
- `test_scheduler.py` — scheduler telemetry + failure-swallowing.
- `test_health.py` — health/readiness probes.

Run: `cd Web/backend && python -m pytest`. Tests never touch the live MCP.
*(Frontend component tests are not yet wired — the project has no Vitest/RTL runner;
adding one is the next testing increment.)*

## 9. Deployment

- **Config** — `.env` (never committed): `MCP_URL`, `MCP_TOKEN`, `JWT_SECRET`
  (must differ from the dev default in prod — enforced at startup), `DATABASE_URL`,
  `CORS_ORIGINS`, `USE_MOCK_FALLBACK=false`, `ENABLE_MCP_DEBUG=false`.
- **Build** — frontend `pnpm build` → static bundle; FastAPI serves it (SPA fallback)
  in the single-container image, or host separately.
- **Run** — `uvicorn app.main:app`; schedulers start automatically.
- **Probes** — point the orchestrator liveness at `/api/health/live` and readiness at
  `/api/health/ready`.
- **Prod guards** (fail-fast at import): refuses the dev JWT secret; refuses
  `ENABLE_MCP_DEBUG=true`; disables `/docs` and `/openapi.json`.
