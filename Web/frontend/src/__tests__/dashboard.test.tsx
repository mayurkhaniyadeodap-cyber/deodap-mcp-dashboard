/**
 * Premium Command Center dashboard — data-trust behaviour of the redesigned UI:
 *   - KPI tiles show the exact Indian-format amount; charts may use short units;
 *   - missing values render as N/A / Unavailable, never ₹0;
 *   - a recalculating warm-cache figure is labelled as such (not "Live") and explained;
 *   - a failed trend month is a gap (null), never 0;
 *   - Recent Shipments shows the response's real source and an honest unavailable state.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { RecentShipments } from "@/components/dashboard/RecentShipments";
import { ShipmentDistributionCard } from "@/components/dashboard/ShipmentDistributionCard";
import { StateCostCard } from "@/components/dashboard/StateCostCard";
import { KpiCard, KpiCardUnavailable } from "@/components/shared/KpiCard";
import { SourceBadge } from "@/components/shared/SourceBadge";
import DashboardPage from "@/pages/DashboardPage";
import { api } from "@/services/api";
import { useDateRangeStore } from "@/store/dateRange.store";
import type { Kpi, TrendResponse } from "@/types/api";
import { formatCurrencyINRShort, formatNumberShort } from "@/utils/format";
import { monthlyBilled } from "@/utils/trend";

beforeAll(() => {
  // Recharts' ResponsiveContainer needs ResizeObserver, which jsdom lacks.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

beforeEach(() => {
  useDateRangeStore.setState({ preset: "custom", customFrom: "2026-09-01", customTo: "2026-09-30" });
});

afterEach(() => {
  cleanup();
});

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const kpi = (over: Partial<Kpi> = {}): Kpi => ({
  key: "total_billing", label: "Total Billed Amount", value: 1234567, format: "currency",
  delta: 4.2, delta_tone: "negative", has_delta: true, unavailable: false, ...over,
});

describe("formatCurrencyINRShort", () => {
  it("uses lakh / crore units for large amounts and the full amount below ₹1L", () => {
    expect(formatCurrencyINRShort(1234567)).toBe("₹12.3L");
    expect(formatCurrencyINRShort(12345678)).toBe("₹1.2Cr");
    expect(formatCurrencyINRShort(10000000)).toBe("₹1Cr");
    expect(formatCurrencyINRShort(1234567890)).toBe("₹123Cr");
    expect(formatCurrencyINRShort(-250000)).toBe("-₹2.5L");
    expect(formatCurrencyINRShort(45678)).toBe("₹45,678");
    expect(formatNumberShort(130139)).toBe("1.3L");
    expect(formatNumberShort(129580)).toBe("1.3L");
    expect(formatNumberShort(25000000)).toBe("2.5Cr");
    expect(formatNumberShort(4321)).toBe("4,321");
  });
});

describe("KpiCard", () => {
  it("shows the exact amount, the real delta and a sparkline only when a series is given", () => {
    const { container } = wrap(<KpiCard kpi={kpi()} source="live" />);
    const card = screen.getByRole("article", { name: "Total Billed Amount" });
    expect(within(card).getByText("₹12,34,567")).toBeTruthy();
    expect(container.querySelector("svg[viewBox='0 0 100 28']")).toBeNull();
    expect(within(card).getByText("4.2%")).toBeTruthy();
    expect(within(card).getByText("Live")).toBeTruthy();
  });

  it("renders an unavailable value as N/A — never ₹0 — and hides the delta", () => {
    wrap(<KpiCard kpi={kpi({ value: 0, unavailable: true })} source="live" />);
    const card = screen.getByRole("article", { name: "Total Billed Amount" });
    expect(within(card).getByText("N/A")).toBeTruthy();
    expect(card.textContent).not.toContain("₹0");
    expect(card.textContent).not.toContain("vs previous month");
  });

  it("labels a recalculating figure as Recalculating (not Live) and explains it", () => {
    wrap(<KpiCard kpi={kpi({ has_delta: false })} source="live" recalculating note="Last completed figure" />);
    const card = screen.getByRole("article", { name: "Total Billed Amount" });
    expect(within(card).getByText("Recalculating")).toBeTruthy();
    expect(within(card).queryByText("Live")).toBeNull();
    expect(within(card).getByText("Last completed figure")).toBeTruthy();
  });

  it("whole-endpoint failure shows Unavailable with a working Retry", () => {
    const onRetry = vi.fn();
    wrap(<KpiCardUnavailable kpiKey="total_cod" label="COD Remittance" onRetry={onRetry} />);
    const card = screen.getByRole("article", { name: "COD Remittance" });
    expect(within(card).getAllByText("Unavailable").length).toBeGreaterThan(0);
    expect(card.textContent).not.toContain("₹");
    within(card).getByRole("button", { name: /Retry/ }).click();
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

describe("KpiCard sparkline", () => {
  it("draws the sparkline from a real series and hides it for a missing value", () => {
    const { container } = wrap(<KpiCard kpi={kpi({ key: "total_shipments", format: "number" })} trend={[3, 5, 4]} />);
    expect(container.querySelector("svg[viewBox='0 0 100 28']")).toBeTruthy();
    cleanup();
    const missing = wrap(<KpiCard kpi={kpi({ unavailable: true })} trend={[3, 5, 4]} />);
    expect(missing.container.querySelector("svg[viewBox='0 0 100 28']")).toBeNull();
  });
});

describe("SourceBadge", () => {
  it("names every provenance state in text (never colour alone)", () => {
    wrap(
      <>
        <SourceBadge status="live" />
        <SourceBadge status="sample" />
        <SourceBadge status="unavailable" />
      </>,
    );
    for (const label of ["Live", "Sample", "Unavailable"]) expect(screen.getByText(label)).toBeTruthy();
  });
});

describe("monthlyBilled", () => {
  it("sums couriers per month, keeps a failed month as a gap and marks partial months", () => {
    const data = {
      couriers: ["Delhivery", "Ekart"],
      by_month: [{ month: "Aug", Delhivery: 100, Ekart: 50 }, { month: "Sep" }, { month: "Oct", Delhivery: 30 }],
      partial_months: ["Oct"],
      failed_months: ["Sep"],
    } as unknown as TrendResponse;
    expect(monthlyBilled(data)).toEqual([
      { label: "Aug", billed: 150 },
      { label: "Sep", billed: null },
      { label: "Oct*", billed: 30 },
    ]);
  });
});

const BILL = { id: 1, awb: "7712345678", courier: "Delhivery", date: "2026-09-20", weight: 0.5, zone: "Gujarat", amount: 85, cod: 0, status: "delivered" };

describe("RecentShipments", () => {
  it("lists live rows newest-first under a Live badge", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ data: { items: [BILL], total: 1, page: 1, page_size: 10, total_pages: 1, source: "live" } });
    wrap(<RecentShipments />);
    expect(await screen.findByText("7712345678")).toBeTruthy();
    expect(screen.getByText("Live")).toBeTruthy();
    expect(within(screen.getByRole("table")).getByText("Delivered")).toBeTruthy();
  });

  it("shows the unavailable state (no rows) when the MCP fetch failed", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ data: { items: [], total: 0, page: 1, page_size: 10, total_pages: 0, source: "unavailable" } });
    wrap(<RecentShipments />);
    expect(await screen.findByText("Live data unavailable")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("DashboardPage", () => {
  it("MCP outage: KPI tiles say Unavailable, no ₹0 anywhere; no Claimable card", async () => {
    const responses: Record<string, unknown> = {
      "/dashboard": { kpis: [], distribution: [], state_cost: [], source: "unavailable", date_field: "order_date" },
      "/dashboard/rate-diff": {
        kpi: { key: "rate_diff", label: "x", value: 0, format: "currency", delta: 0, delta_tone: "neutral", has_delta: false, unavailable: true },
        source: "unavailable", date_field: "reconciliation_at", maturing: false,
      },
      "/disputes/claimable-rate": {
        claimable_amount: 512345, excluded_no_applied_rate: 0, excluded_below_threshold: 0, count: 12, threshold: 50,
        source: "live", date_field: "reconciliation_at", computing: false, recalculating: true, maturing: false,
      },
      "/couriers": [],
      "/dashboard/courier-billing": { rows: [], sample_size: 0, total_matched: 0, is_full: true, source: "unavailable", date_field: "order_date" },
      "/savings-opportunity": { rows: [], sampled: 0, skipped: 0, total_saving: 0, source: "unavailable", note: "" },
      "/trend": { daily: [], couriers: [], by_month: [], partial_months: [], failed_months: [], window: "", source: "unavailable", date_field: "order_date" },
      "/bills": { items: [], total: 0, page: 1, page_size: 10, total_pages: 0, source: "unavailable" },
      "/dashboard/kpi-trends": { buckets: [], series: {}, source: "unavailable", date_field: "order_date" },
    };
    vi.spyOn(api, "get").mockImplementation(async (url: string) => ({ data: responses[url] }));
    const { container } = wrap(<DashboardPage />);

    const billed = await screen.findByRole("article", { name: "Total Billed Amount" });
    expect(within(billed).getAllByText("Unavailable").length).toBeGreaterThan(0);

    const pending = await screen.findByRole("article", { name: "Pending Reconciliation" });
    expect(within(pending).getByText("N/A")).toBeTruthy();
    expect(within(pending).queryByText("Live")).toBeNull();

    // The Claimable Rate Difference card was removed from the Dashboard.
    expect(screen.queryByText("Claimable Rate Difference")).toBeNull();

    expect(screen.getByRole("complementary", { name: "Data status legend" })).toBeTruthy();
    expect(container.textContent).not.toMatch(/₹0(?![\d,.])/);
  });
});

const SPARK = "svg[viewBox='0 0 100 28']";

describe("DashboardPage sparklines", () => {
  it("draws a real sparkline on every KPI card", async () => {
    const k = (key: string, label: string, value: number, format: Kpi["format"] = "currency"): Kpi => ({
      key, label, value, format, delta: 1, delta_tone: "neutral", has_delta: true, unavailable: false,
    });
    const series = { total_billing: [1, 3, 2], total_shipments: [5, 6, 7], average_cost: [2, 2, 3], total_cod: [4, 1, 2], pending_recon: [0, 0, 1] };
    const responses: Record<string, unknown> = {
      "/dashboard": {
        kpis: [k("total_billing", "Total Billed Amount", 100), k("total_shipments", "Total Shipments", 10, "number"),
               k("average_cost", "Avg Cost/Shipment", 10), k("total_cod", "COD Remittance", 50)],
        distribution: [], state_cost: [], source: "live", date_field: "order_date",
      },
      "/dashboard/rate-diff": {
        kpi: { key: "rate_diff", label: "x", value: 5, format: "currency", delta: 0, delta_tone: "neutral", has_delta: false, unavailable: false },
        source: "live", date_field: "order_date", maturing: false,
      },
      "/disputes/claimable-rate": {
        claimable_amount: 9, excluded_no_applied_rate: 0, excluded_below_threshold: 0, count: 1, threshold: 50,
        source: "live", date_field: "order_date", computing: false, recalculating: false, maturing: false,
      },
      "/couriers": [],
      "/dashboard/courier-billing": { rows: [], sample_size: 0, total_matched: 0, is_full: true, source: "live", date_field: "order_date" },
      "/savings-opportunity": { rows: [], sampled: 0, skipped: 0, total_saving: 0, source: "live", note: "" },
      "/trend": { daily: [], couriers: [], by_month: [], partial_months: [], failed_months: [], window: "", source: "live", date_field: "order_date" },
      "/bills": { items: [], total: 0, page: 1, page_size: 10, total_pages: 0, source: "live" },
      "/dashboard/kpi-trends": {
        buckets: [{ date_from: "2026-09-01", date_to: "2026-09-10" }, { date_from: "2026-09-11", date_to: "2026-09-20" }, { date_from: "2026-09-21", date_to: "2026-09-30" }],
        series, source: "live", date_field: "order_date",
      },
    };
    vi.spyOn(api, "get").mockImplementation(async (url: string) => ({ data: responses[url] }));
    wrap(<DashboardPage />);

    for (const label of ["Total Billed Amount", "Total Shipments", "Avg Cost/Shipment", "COD Remittance", "Pending Reconciliation"]) {
      const card = await screen.findByRole("article", { name: label });
      await vi.waitFor(() => expect(card.querySelector(SPARK)).toBeTruthy());
    }
  });
});

describe("ShipmentDistributionCard", () => {
  it("shows the hovered courier in the centre instead of a floating tooltip", () => {
    wrap(
      <ShipmentDistributionCard
        distribution={[{ name: "BlueDart", value: 300 }, { name: "DTDC", value: 100 }]}
        loading={false}
        unavailable={false}
        onRetry={() => {}}
      />,
    );
    expect(screen.getByText("Total Shipments")).toBeTruthy();
    fireEvent.focus(screen.getByLabelText(/^DTDC: 100 shipments/));
    expect(screen.queryByText("Total Shipments")).toBeNull();
    expect(screen.getByText("25.0% of shipments")).toBeTruthy();
  });
});

describe("StateCostCard", () => {
  it("shades only the listed states on the map and links hover between map and list", () => {
    const { container } = wrap(
      <StateCostCard
        rows={[{ state: "Maharashtra", total_cost: 900 }, { state: "Jammu And Kashmir", total_cost: 300 }]}
        loading={false}
        unavailable={false}
        onRetry={() => {}}
      />,
    );
    const paths = [...container.querySelectorAll("svg[role='img'] path")] as SVGPathElement[];
    expect(paths.length).toBe(36); // every state/UT, incl. Ladakh and DNH & DD
    const shaded = paths.filter((p) => p.style.fill.includes("--primary"));
    expect(shaded.map((p) => p.querySelector("title")?.textContent)).toEqual([
      "Jammu and Kashmir: ₹300",
      "Maharashtra: ₹900",
    ]);
    fireEvent.mouseEnter(screen.getByText("Maharashtra"));
    expect(screen.getByText("Maharashtra: ₹900", { selector: "span" })).toBeTruthy();
  });
});
