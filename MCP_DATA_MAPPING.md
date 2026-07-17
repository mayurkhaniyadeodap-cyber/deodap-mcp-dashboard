# Live MCP Data Mapping

A field-level provenance map for the DeoDap Courier Billing dashboard. Every value
below was traced through the real code path:

```
UI component → React Query hook → API endpoint → backend service → MCP tool → response field
```

All data ultimately comes from the **Ship MCP** server (`ship.deodap.in`, 18 tools).
The frontend API base URL is `/api`, so every endpoint path below is prefixed with `/api`.

## Status legend

| Status | Meaning |
|---|---|
| **LIVE** | Read straight from an MCP tool response field. |
| **DERIVED** | Calculated on the backend from one or more live fields (formula given). |
| **SAMPLED** | From a `list_orders` stride/sequential sample, not the full population. |
| **MOCK** | Served from a committed JSON fixture (fallback, or an un-migratable panel). |
| **STATIC** | Hardcoded in the backend (not MCP, not a fixture file). |
| **UNAVAILABLE** | The MCP server does not expose this — cannot be built truthfully. |

## How live vs mock is decided (per response)

Every live service is wrapped in `live_support.live_or_mock(...)`: it tries the MCP
tools and, on **blank token / MCP error / unusable result**, returns the committed
mock fixture with `source="mock"`. The frontend `SourceBadge` reads that `source`
field and flips **LIVE → Sample** automatically. Two exceptions:

- **Bills** and **Courier Comparison** badges read a *static* provenance map
  (`GET /_meta/sources`), not the response `source`.
- `rate_diff`, `savings-opportunity`, `trend-recovery` have **no mock file** — their
  fallback is an in-code empty response with `source="mock"`.

---

# 1. Dashboard

**Endpoints:** `/dashboard` (fast), `/dashboard/rate-diff` (slow, own skeleton),
`/dashboard/courier-billing` (slow ~2,500-order sample, own skeleton), `/couriers`.
**Mock files:** `dashboard.json`, `courier_billing.json`, `couriers.json` (rate-diff has none).
**Response `date_field`:** `order_date` (main), `reconciliation_at` (rate-diff).

### KPI cards

| UI Component | API Endpoint | Backend Service | MCP Tool | Response Field | Status |
|---|---|---|---|---|---|
| Total Shipments | /api/dashboard | dashboard_service | order_analytics | `totals.orders` | **LIVE** (delta DERIVED) |
| Applied Shipping Cost | /api/dashboard | dashboard_service | shipping_cost_summary | `totals.total_cost` | **LIVE** (delta DERIVED) |
| Avg Cost / Shipment | /api/dashboard | dashboard_service | shipping_cost_summary ÷ order_analytics | `totals.total_cost / totals.orders` | **DERIVED** |
| COD Value | /api/dashboard | dashboard_service | order_analytics | `totals.cod_value` | **LIVE** (delta DERIVED) |
| Pending Reconciliation | /api/dashboard | dashboard_service | cod_remittance_summary | `by_status[Pending].records` | **LIVE** |
| On-time % | /api/dashboard | dashboard_service | sla_performance | `on_time_pct` (+ `on_time`, `late`, `avg_delay_days` in subtitle) | **LIVE** |
| Overdue in Transit | /api/dashboard | dashboard_service | sla_performance | `overdue_in_transit` | **LIVE** |
| Rate Difference to Investigate | /api/dashboard/rate-diff | dashboard_service | weight_reconciliation_summary | `fwd_rate_diff` | **LIVE** |

**Deltas** on the first four KPIs are **DERIVED**: `(cur − prev) / prev × 100`, where
`cur`/`prev` come from *two extra* `order_analytics` / `shipping_cost_summary` calls over
complete equal-length windows (`_delta_windows`: current window anchored to yesterday).
`pending_recon`, `on_time`, `overdue`, `rate_diff` carry **no delta** (outcome/reconciliation
metrics lag). `savings` KPI key exists in the metadata map but is **not emitted** by the live
service (marked `sample` in `_meta/sources`).

### Charts

| Chart | Endpoint | Backend fn | MCP Tool(s) | Response fields | Status |
|---|---|---|---|---|---|
| **Courier-wise Cost** (stacked bar: Forward + RTO) | /api/couriers | `list_couriers` | shipping_cost_summary `group_by=courier` | `breakdown[].fwd_cost` (Forward), `breakdown[].rto_cost` (RTO) | **LIVE** (population) |
| **Shipment Distribution** (donut) | /api/dashboard | `_fetch_live` | order_analytics `group_by=courier` | `breakdown[].group`, `breakdown[].orders` | **LIVE** (Top-6 + Others merged locally = DERIVED) |
| **Forward Cost Breakdown** (stacked bar: Base Freight / GST / COD) | /api/dashboard/courier-billing | `_billing_live` | list_orders (sampled) | Σ `orders[].rate_summary.base_rates.forward.{base_freight,gst,cod_charges}` | **SAMPLED** (list_orders, limit 500, cap 2,500) |
| **Top N States** (bar + value labels) | /api/dashboard | `_fetch_live` | shipping_cost_summary `group_by=state` | Σ `breakdown[].total_cost` by canonical state, top 10 | **DERIVED** (aggregated + canonicalized) |

> Note: the "Forward Cost Breakdown" bar is the **only** sampled series on the dashboard;
> Fuel/Other are structurally ₹0 and omitted. `rto_actual` in the same billing response is
> **LIVE** (population `shipping_cost_summary.breakdown[].rto_cost`), not sampled.

### Courier Cost Detail table (`CourierBillsTable`, data = `/api/couriers`)

| Column | MCP Tool | Field | Status |
|---|---|---|---|
| Courier / code | courier_performance | `couriers[].courier_slug` → name+code | **LIVE** (mapped) |
| Shipments | courier_performance | `couriers[].total` | **LIVE** |
| Freight | shipping_cost_summary | `breakdown[].fwd_cost` | **LIVE** |
| RTO | shipping_cost_summary | `breakdown[].rto_cost` | **LIVE** |
| Cost (our rate card) | — | `freight + rto` | **DERIVED** |
| COD Value | order_analytics | `breakdown[].cod_value` | **LIVE** |

---

# 2. Bills Overview

**Endpoint:** `/bills` (paged). **Mock file:** `bills.json`. **Badge:** static `/_meta/sources → bills.table`.

**HYBRID provenance.** Live only when `live_capable = not search AND sort in (None, "date:desc", "date")`.
Any text search or arbitrary-column sort falls back to **`bills.json`** (mock) — MCP `list_orders`
cannot server-side search/sort those columns.

| Column | API | Backend | MCP Tool | Field | Status |
|---|---|---|---|---|---|
| AWB | /api/bills | bills_service | list_orders | `orders[].awb` / `rt_awb` / `order_no` / `id` | **LIVE** |
| Courier | /api/bills | bills_service | list_orders | `orders[].shipping_company` / `courier_name` / `courier_slug` | **LIVE** |
| Date | /api/bills | bills_service | list_orders | `orders[].order_date[:10]` | **LIVE** |
| Weight | /api/bills | bills_service | list_orders | `orders[].total_weight_kg` / `actual_weight_kg` | **LIVE** |
| Amount | /api/bills | bills_service | list_orders | `orders[].applied_courier_rate` / `order_total` | **LIVE** |
| COD | /api/bills | bills_service | list_orders | `orders[].cod_total` | **LIVE** |
| State (`zone` col) | /api/bills | bills_service | list_orders | `orders[].customer_state` | **LIVE** |
| Status | /api/bills | bills_service | list_orders | `orders[].status` → bill status map | **DERIVED** |
| Pagination total | /api/bills | bills_service | list_orders | `total_matched` | **LIVE** |

Status filter maps bill status → order status server-side (e.g. `rto → RTO`, `discrepancy → NDR`).
→ **When you see search results or sort by non-date, the table is MOCK.**

---

# 3. Courier Comparison

**Endpoint:** `/couriers` → `Courier[]` (bare list, no `source` field).
**Mock file:** `couriers.json`. **Badge:** static `/_meta/sources → couriers.comparison`.
**MCP tools (4, concurrent):** courier_performance, shipping_cost_summary `group_by=courier`, rto_analysis, order_analytics `group_by=courier`. Join key = `courier_slug`.

### CourierScorecard (one per courier)

| Field shown | MCP Tool | Response Field | Status |
|---|---|---|---|
| Name + code | courier_performance | `couriers[].courier_slug` → name/code | **LIVE** (mapped) |
| Shipments (+ volume bar) | courier_performance | `couriers[].total` | **LIVE** |
| Cost (our rate card) | shipping_cost_summary | `breakdown[].fwd_cost + rto_cost` | **DERIVED** from LIVE |
| Cost / Shipment | shipping_cost_summary | `breakdown[].avg_cost` (fallback `(freight+rto)/shipments`) | **LIVE** (DERIVED fallback) |
| RTO Rate | rto_analysis ÷ order_analytics | `by_courier[].count ÷ breakdown[].orders × 100` | **DERIVED** (matches Discrepancies) |
| COD Value | order_analytics | `breakdown[].cod_value` | **LIVE** |

> `courier_performance.rto_rate_pct` is deliberately **not** used — RTO% is recomputed from
> `rto_analysis` so it reconciles exactly with the Discrepancies page.

---

# 4. Discrepancies

**Endpoints:** `/discrepancies`, `/savings-opportunity` (slow ~30s, 30-min cache).
**Mock files:** `discrepancies.json` (savings has none → empty in-code fallback).
**Response `date_field`s:** `recon_date_field="reconciliation_at"`, `order_date_field="order_date"` (two bases).
**MCP tools:** weight_reconciliation_summary, rto_analysis, order_analytics `group_by=courier`, ndr_analysis; savings adds list_orders + pincode_serviceability.

| Panel / value | MCP Tool | Response Field | Status |
|---|---|---|---|
| Rate Difference — forward diff | weight_reconciliation_summary | `fwd_rate_diff` | **LIVE** (round) |
| Rate Difference — lines / overcharged / extra-kg | weight_reconciliation_summary | `rows`, `weight_overcharged`, `weight_diff_kg` | **LIVE** |
| Reconciliation Status — reconciled / disputed | weight_reconciliation_summary | `by_status.Reconciled` / `.Disputed` | **LIVE** |
| RTO Analysis (per courier) | rto_analysis ÷ order_analytics | `by_courier[].count ÷ breakdown[].orders × 100` | **DERIVED** |
| NDR Analysis (per courier) | ndr_analysis ÷ order_analytics | `by_courier[].count ÷ breakdown[].orders × 100` | **DERIVED** |
| NDR count / avg attempts | ndr_analysis | `ndr_orders`, `avg_attempts` | **LIVE** |

### Savings Opportunity table (`/savings-opportunity`)

| Column | MCP Tool | Field | Status |
|---|---|---|---|
| AWB / courier used / applied rate | list_orders (limit 40, stride) | `orders[].awb` / `courier_slug` / `applied_courier_rate` | **SAMPLED** |
| Cheapest courier / rate | pincode_serviceability | min `methods[].fwd_billed` (× 1.18 GST) | **LIVE** (per-AWB, ≤25 sampled) |
| Saving | — | `applied − cheapest_rate` | **DERIVED** |
| Cheapest RTO % | rto_analysis ÷ order_analytics | per cheapest courier | **DERIVED** |

> ⚠️ **Temporal mix:** `pincode_serviceability` takes **no date argument** — it returns the
> **current** rate card, compared against each order's **historical** applied rate. If the rate
> card changed since those orders shipped, the saving is an estimate vs current pricing, not what
> was actually quoted then.

---

# 5. COD Reconciliation

**Endpoint:** `/cod`. **Mock file:** `cod.json`. **`date_field`:** `order_date`.
**MCP tools:** order_analytics `group_by=courier`, cod_remittance_summary (+ 3 delta calls, + 8 weekly calls).

### KPI cards

| KPI | MCP Tool | Field | Status |
|---|---|---|---|
| COD Value | order_analytics | `totals.cod_value` | **LIVE** (delta DERIVED) |
| COD Remitted | cod_remittance_summary | `totals.remitted` | **LIVE** |
| COD Records | cod_remittance_summary | `totals.records` | **LIVE** |
| Pending Records | cod_remittance_summary | `by_status[Pending].records` | **LIVE** |

### Charts / table

| Element | MCP Tool | Field | Status |
|---|---|---|---|
| **COD Collection vs Remittance** (4-week bar) | order_analytics + cod_remittance_summary (per window) | `totals.cod_value` (collected), `totals.remitted` | **LIVE** per window (windows split locally) |
| **COD value by courier** (bar) | order_analytics | `breakdown[].cod_value` | **LIVE** |
| **COD by Courier** (table) | order_analytics | `breakdown[].{group, orders, cod_value}` | **LIVE** |

---

# 6. State Analysis

**Endpoint:** `/zones`. **Mock file:** `zones.json`. **`date_field`:** `order_date`.
**MCP tools:** shipping_cost_summary `group_by=state`, geo_performance `group_by=state, limit=500`.
Joined on **canonicalized** state name (`_canon_state` alias map → "Unknown" fallback).

| Element / column | MCP Tool | Field | Status |
|---|---|---|---|
| **Shipping Cost by State** (bar) | shipping_cost_summary | Σ `breakdown[].total_cost` | **LIVE** |
| orders | shipping_cost_summary | `breakdown[].orders` | **LIVE** |
| avg_cost | shipping_cost_summary | `total_cost / orders` | **DERIVED** |
| fwd_cost / rto_cost | shipping_cost_summary | `breakdown[].fwd_cost` / `rto_cost` | **LIVE** |
| Delivery % | geo_performance | `areas[].delivered / orders × 100` | **DERIVED** |
| RTO % | geo_performance | `areas[].rto / orders` | **DERIVED** |
| NDR % | geo_performance | `areas[].ndr / orders` | **DERIVED** |
| Avg delivery days | geo_performance | order-weighted `areas[].avg_delivery_days` | **DERIVED** |
| **State × Metric Heatmap** | (both above) | avg_cost, delivery/rto/ndr %, avg days | **LIVE/DERIVED** (blank when state present in only one tool) |
| unmapped/unjoined diagnostics | — | reconciliation counters | **DERIVED** |

---

# 7. Weight Analysis

**Endpoint:** `/weight`. **Mock file:** `weight.json`.
**`date_field`s:** `recon_date_field="reconciliation_at"` (KPIs), `sample_date_field="order_date"` (charts).
**MCP tools:** weight_reconciliation_summary + list_orders (sampled, limit 500).

| Element | MCP Tool | Field | Status |
|---|---|---|---|
| Reconciliation Lines (StatCard) | weight_reconciliation_summary | `rows` | **LIVE** |
| Weight-Overcharged Lines | weight_reconciliation_summary | `weight_overcharged` | **LIVE** |
| Extra Weight (kg) | weight_reconciliation_summary | `weight_diff_kg` | **LIVE** (round) |
| Forward Rate Difference | weight_reconciliation_summary | `fwd_rate_diff` | **LIVE** (round) |
| `has_recon` gate | weight_reconciliation_summary | `rows > 0` | **DERIVED** |
| **Actual vs Charged Weight** (scatter) | list_orders (sampled) | `orders[].actual_weight_kg` (actual), `total_weight_kg` (charged), `courier_slug` | **SAMPLED** (render cap 500) |
| **Weight Slab Distribution** (histogram) | list_orders (sampled) | `total_weight_kg` bucketized (0–0.5 / 0.5–1 / 1–2 / 2–5 / 5+) | **SAMPLED / DERIVED** |
| Missing-weight note | list_orders | count of null `actual_weight_kg` ÷ sampled | **DERIVED** |

---

# 8. Trend Analysis

**Endpoints:** `/trend`, `/trend-recovery` (slow ~27s, 10-min cache).
**Mock files:** `trend.json` (recovery has none). **`date_field`:** `order_date` (trend), `reconciliation_at` (recovery).
**MCP tools:** daily_booking_trend, shipping_cost_summary `group_by=courier` (per-month), weight_reconciliation_summary (per-month, recovery).

| Chart | MCP Tool | Field | Status |
|---|---|---|---|
| **Cumulative Rate Difference Identified** (area) | weight_reconciliation_summary (N× per month) | running Σ `fwd_rate_diff` | **LIVE** per month; cumulative **DERIVED**; hollow dots = partial/gap months |
| **Daily Order Value** (area) | daily_booking_trend | `days[].order_value` | **LIVE** |
| **Daily Orders** (line) | daily_booking_trend | `days[].orders` | **LIVE** |
| **Monthly Billing by Courier** (multi-line) | shipping_cost_summary (per month) | `breakdown[].total_cost` per courier (top-8) | **LIVE** per month (aggregated = DERIVED) |

---

# 9. Export

**Endpoints:** `/export` (catalog), `/export/{csv|xlsx}?dataset` (role-gated: admin/employee).
**Provenance: LIVE — re-uses the real services** (each with its own live/mock fallback).

| Dataset | Backing service | MCP Tool(s) | Status |
|---|---|---|---|
| bills | bills_service.list_bills | list_orders | **LIVE** (capped 500 rows) |
| couriers | courier_service.list_couriers | courier_performance, shipping_cost_summary, rto_analysis, order_analytics | **LIVE** |
| cod | cod_service.get_cod → `reconciliation` | order_analytics, cod_remittance_summary | **LIVE** |
| discrepancies | discrepancy_service → `rto` | rto_analysis, order_analytics, … | **LIVE** |
| zones | zone_service.get_zones → `states` | shipping_cost_summary, geo_performance | **LIVE** |

> The **catalog row counts** shown before download come from the mock files (`load_mock`) — nominal
> only. The **rendered file** is live (or the downstream service's own mock fallback). Export itself
> calls no MCP tool directly.

---

# 10. Configuration

**Endpoint(s):** `/settings` + several live sub-sections. **Mixed provenance.**

| Section | Source | Status |
|---|---|---|
| Preferences (currency/timezone/weight unit) | `/settings` ← `settings.json` (load-time) | **MOCK / STATIC** (read-only) |
| Profile | `/profile` (GET/PATCH) | Live (user store, not MCP) |
| Courier Roster | `/couriers` (live MCP) + badge from `/_meta/sources` | **LIVE** (same as Courier Comparison) |
| MCP Status | `/_status` — probes every endpoint concurrently, reads each `source` | **LIVE** (diagnostic) |
| Security (change password) | `/profile/change-password` | Live (user store) |
| Theme | local only | n/a |
| User Management (admin) | `/users` CRUD | Live (user store, not MCP) |

`GET /_meta/sources` (drives Live/Sample badges on Bills & Couriers) is a **STATIC** hardcoded map — not MCP, not a fixture.

---

# MCP Tool Inventory

12 of 18 available tools are used. Per tool: pages, endpoints, per-request call count, live fields consumed, notable unused fields.

### ✓ order_analytics
- **Pages:** Dashboard, COD, Couriers, Discrepancies, Savings
- **Endpoints:** `/dashboard`, `/cod`, `/couriers`, `/discrepancies`, `/savings-opportunity`
- **Calls:** Dashboard 3× (1 value + 2 delta, `group_by=courier`), COD 3× + 4× weekly, Couriers 1×, Discrepancies 1×, Savings 1× — always `group_by=courier`
- **Fields used:** `totals.orders`, `totals.cod_value`, `breakdown[].{group, orders, cod_value}`
- **Unused:** `totals.order_value`, `totals.errors`, `totals.ndr`

### ✓ shipping_cost_summary
- **Pages:** Dashboard, Couriers, State Analysis, Trend
- **Endpoints:** `/dashboard`, `/dashboard/courier-billing`, `/couriers`, `/zones`, `/trend`
- **Calls:** Dashboard 3× (`group_by=state`), courier-billing 1× (`group_by=courier`), Couriers 1×, Zones 1× (`group_by=state`), Trend N× (per month, `group_by=courier`)
- **Fields used:** `totals.total_cost`, `breakdown[].{group, orders, fwd_cost, rto_cost, total_cost, avg_cost}`
- **Unused:** `totals.{orders, fwd_cost, rto_cost}` (dashboard uses only `total_cost`)

### ✓ weight_reconciliation_summary
- **Pages:** Weight, Discrepancies, Trend (recovery), Dashboard (rate-diff)
- **Endpoints:** `/weight`, `/discrepancies`, `/trend-recovery`, `/dashboard/rate-diff`
- **Calls:** Weight 1×, Discrepancies 1×, Dashboard rate-diff 1×, Recovery **N× (one per month, ~6–7)**
- **Fields used:** `rows`, `weight_overcharged`, `weight_diff_kg`, `fwd_rate_diff`, `by_status.{Reconciled, Disputed}`
- **Unused:** `rto_rate_diff`, `net_rate_diff`, `note` (RTO/net legs are un-invoiced → 0)
- **Basis:** `reconciliation_at` (no `group_by` param, no `date_field` param — global only)

### ✓ list_orders
- **Used only for:** Bills (full table), Dashboard Forward-Cost Breakdown (sample), Weight scatter/histogram (sample), Savings (sample)
- **Endpoints:** `/bills`, `/dashboard/courier-billing`, `/weight`, `/savings-opportunity`
- **Calls:** Bills = paged (`limit`/`offset`); sampled elsewhere via `sample_orders` (limit **500**, cap 2,500, ≤5 pages) — except Savings which uses limit **40**
- **Fields used:** `awb`/`rt_awb`, `courier_slug`, `order_date`, `total_weight_kg`, `actual_weight_kg`, `applied_courier_rate`, `cod_total`, `order_total`, `customer_state`, `status`, `pincode`, `warehouse_id`, `payment_type`, `rate_summary.base_rates.forward.{base_freight, gst, cod_charges}`, `total_matched`
- **Unused:** `rate_summary.rto.*`, `rate_summary.rate_source`/`rate_remark`/`status`, and most other `rate_summary`/order fields (see UNAVAILABLE notes)

### ✓ cod_remittance_summary
- **Pages:** Dashboard, COD
- **Endpoints:** `/dashboard`, `/cod`
- **Calls:** Dashboard 1×, COD 1× + 4× weekly
- **Fields used:** `totals.remitted`, `totals.records`, `by_status[Pending].records`
- **Unused:** `totals.shortfall`, `by_status[Settled]`, `by_status[].difference` (no `group_by` → global only)

### ✓ rto_analysis
- **Pages:** Discrepancies, Savings, Couriers
- **Endpoints:** `/discrepancies`, `/savings-opportunity`, `/couriers`
- **Calls:** 1× each
- **Fields used:** `by_courier[].{value, count}`

### ✓ ndr_analysis
- **Pages:** Discrepancies · **Endpoint:** `/discrepancies` · **Calls:** 1×
- **Fields used:** `by_courier[].{value, count}`, `ndr_orders`, `avg_attempts`

### ✓ sla_performance
- **Pages:** Dashboard · **Endpoint:** `/dashboard` · **Calls:** 1× (global, no `group_by`)
- **Fields used:** `on_time_pct`, `overdue_in_transit`, `on_time`, `late`, `avg_delay_days`
- **Unused:** `delivered`

### ✓ geo_performance
- **Pages:** State Analysis · **Endpoint:** `/zones` · **Calls:** 1× (`group_by=state, limit=500`)
- **Fields used:** `areas[].{area, orders, delivered, rto, ndr, avg_delivery_days}`

### ✓ daily_booking_trend
- **Pages:** Trend · **Endpoint:** `/trend` · **Calls:** 1×
- **Fields used:** `days[].{day, orders, order_value}`

### ✓ courier_performance
- **Pages:** Couriers · **Endpoint:** `/couriers` · **Calls:** 1×
- **Fields used:** `couriers[].{courier_slug, total, delivery_rate_pct}`
- **Unused:** `couriers[].rto_rate_pct` (deliberately — recomputed from rto_analysis)

### ✓ pincode_serviceability
- **Pages:** Savings only · **Endpoint:** `/savings-opportunity`
- **Calls:** **per sampled AWB** (≤25, concurrency 6), args `{pincode, weight_kg, payment_type, warehouse_id}` — **NO date arg**
- **Fields used:** `methods[].{courier_slug, fwd_billed, rate_status}`
- **Note:** returns the **current** rate card (not date-scoped) → the savings temporal mix.

---

# UNUSED MCP TOOLS (6 of 18)

Available on the server but **never called** by any business-logic service (only reachable via the
gated `/_mcp/probe` debug endpoint when `MCP_DEBUG=true`):

- `booking_error_report`
- `get_order_status`
- `merchant_profitability`
- `repeat_customer_analysis`
- `rule_building_blocks`
- `shipping_rules`

---

# UNAVAILABLE — what MCP does not expose (verified by probing)

These were requested at some point and confirmed **impossible** with the current MCP surface, so
they are either omitted or approximated:

| Wanted | Why unavailable |
|---|---|
| Courier-wise **COD remitted / pending** | `cod_remittance_summary` has **no `group_by`** — remittance is global-only. |
| Courier-wise **reconciliation** split | `weight_reconciliation_summary` has **no `group_by`** — `by_status` is global-only. |
| **GST / COD** components in aggregate cost | `shipping_cost_summary` returns only `fwd_cost`/`rto_cost`/`total_cost` — no component breakdown. Components are **SAMPLED** from `list_orders.rate_summary` instead. |
| Per-AWB **invoiced** rate & weight (dispute line items) | `list_orders` invoiced fields are null/0 — no per-shipment reconciliation lines. |
| Canonical **zone** dimension | No zone field in the data → replaced by **State Analysis**. |
| Daily trend **per courier** | `daily_booking_trend` ignores `group_by` — global daily only. |
| Fuel Surcharge as its own line | Structurally ₹0 (folded into all-inclusive base freight) — never rendered. |

---

## Quick reference: is this page live?

| Page | Live? | Caveat |
|---|---|---|
| Dashboard | ✅ LIVE | Forward-Cost Breakdown is SAMPLED; state cost DERIVED |
| Bills | ⚠️ HYBRID | LIVE by default; **MOCK** on text search or non-date sort |
| Courier Comparison | ✅ LIVE | RTO% is DERIVED |
| Discrepancies | ✅ LIVE | Savings table SAMPLED + temporal-mixed |
| COD | ✅ LIVE | weekly windows split locally |
| State Analysis | ✅ LIVE | outcome rates DERIVED from geo_performance |
| Weight | ✅ LIVE | scatter + histogram SAMPLED |
| Trend | ✅ LIVE | monthly billing + recovery aggregated per-month |
| Export | ✅ LIVE | reuses live services; catalog counts are MOCK |
| Configuration | ⚠️ MIXED | Preferences MOCK/static; Roster + MCP Status LIVE |

*All "LIVE" pages fall back to their committed mock fixture (`source="mock"`) on MCP error or blank
token; the Live/Sample badge reflects the actual response.*
