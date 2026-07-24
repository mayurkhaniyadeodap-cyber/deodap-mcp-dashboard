/**
 * Endpoint → MCP tool(s) map. MIRRORS the authoritative mapping in the backend's
 * status_service._specs() so the admin "tool info" affordance needs NO extra MCP
 * call (Task 4 requirement). Keep in sync with status_service if endpoints change.
 */
export const ENDPOINT_TOOLS: Record<string, string[]> = {
  "/api/couriers": ["courier_performance", "order_analytics", "rto_analysis", "shipping_cost_summary"],
  "/api/dashboard": ["order_analytics", "shipping_cost_summary", "cod_remittance_summary", "sla_performance"],
  "/api/dashboard/rate-diff": ["weight_reconciliation_summary"],
  "/api/dashboard/courier-billing": ["list_orders", "shipping_cost_summary"],
  "/api/cod": ["order_analytics", "cod_remittance_summary"],
  "/api/zones": ["shipping_cost_summary", "geo_performance"],
  "/api/weight": ["weight_reconciliation_summary", "list_orders"],
  "/api/discrepancies": ["order_analytics", "rto_analysis", "ndr_analysis", "weight_reconciliation_summary"],
  "/api/trend": ["daily_booking_trend", "shipping_cost_summary"],
  "/api/trend-recovery": ["weight_reconciliation_summary"],
  "/api/savings-opportunity": ["pincode_serviceability", "order_analytics", "rto_analysis", "list_orders"],
};
