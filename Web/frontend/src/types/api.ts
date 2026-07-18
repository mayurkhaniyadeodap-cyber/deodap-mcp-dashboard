/**
 * Friendly aliases over the generated OpenAPI types (src/types/api.gen.ts).
 *
 * The OpenAPI schema is the single source of truth for data shapes. Regenerate
 * with `pnpm gen:types` (backend must be running) whenever the API changes;
 * never hand-edit api.gen.ts. Import shapes from HERE, not the generated file.
 */
import type { components } from "@/types/api.gen";

type Schemas = components["schemas"];

// --- Auth ---
export type Role = Schemas["Role"];
export type UserPublic = Schemas["UserPublic"];
export type LoginRequest = Schemas["LoginRequest"];
export type TokenResponse = Schemas["TokenResponse"];

// --- Users & profile (Phase 2) ---
export type UserOut = Schemas["UserOut"];
export type UserCreate = Schemas["UserCreate"];
export type UserUpdate = Schemas["UserUpdate"];
export type ProfileUpdate = Schemas["ProfileUpdate"];
export type ChangePasswordRequest = Schemas["ChangePasswordRequest"];
export type MessageResponse = Schemas["MessageResponse"];

// --- Bills ---
export type Bill = Schemas["Bill"];
export type BillStatus = Schemas["BillStatus"];
export type BillsPage = Schemas["Page_Bill_"];

// --- Dashboard ---
export type DashboardResponse = Schemas["DashboardResponse"];
export type Kpi = Schemas["Kpi"];
export type DistributionSlice = Schemas["DistributionSlice"];
export type StateCostRow = Schemas["StateCostRow"];
export type RateDiffKpi = Schemas["RateDiffKpi"];
export type CourierBillingResponse = Schemas["CourierBillingResponse"];
export type CourierBillingRow = Schemas["CourierBillingRow"];

// --- Couriers ---
export type Courier = Schemas["Courier"];

// --- State Analysis (formerly Zones) ---
export type ZonesResponse = Schemas["ZonesResponse"];
export type StateRow = Schemas["StateRow"];

// --- Weight ---
export type WeightResponse = Schemas["WeightResponse"];
export type WeightPoint = Schemas["WeightPoint"];
export type WeightBucket = Schemas["WeightBucket"];
export type WeightSummary = Schemas["WeightSummary"];

// --- COD ---
export type CodResponse = Schemas["CodResponse"];
export type CodCourier = Schemas["CodCourier"];
export type CodPendingResponse = Schemas["CodPendingResponse"];
export type CodPendingCourier = Schemas["CodPendingCourier"];
export type CodWeekly = Schemas["CodWeekly"];

// --- Trend ---
export type TrendResponse = Schemas["TrendResponse"];
export type TrendDay = Schemas["TrendDay"];

// --- Recovery (separate slow endpoint) ---
export type RecoveryResponse = Schemas["RecoveryResponse"];
export type RecoveryPoint = Schemas["RecoveryPoint"];

// --- Settings ---
export type SettingsResponse = Schemas["SettingsResponse"];
export type Preferences = Schemas["Preferences"];

// --- Discrepancies ---
export type DiscrepancyResponse = Schemas["DiscrepancyResponse"];
export type ReconciliationResponse = Schemas["ReconciliationResponse"];
export type ClaimableRateResponse = Schemas["ClaimableRateResponse"];
export type DisputeLine = Schemas["DisputeLine"];
export type DisputeLinesResponse = Schemas["DisputeLinesResponse"];
export type DisputeInvoiceGroup = Schemas["DisputeInvoiceGroup"];
export type DisputeInvoicesResponse = Schemas["DisputeInvoicesResponse"];
export type WeightDispute = Schemas["WeightDispute"];
export type RateDispute = Schemas["RateDispute"];
export type ReconciledCourier = Schemas["ReconciledCourier"];
export type RateDiff = Schemas["RateDiff"];
export type CourierRate = Schemas["CourierRate"];

// --- Savings Opportunity (separate slow endpoint) ---
export type SavingsResponse = Schemas["SavingsResponse"];
export type SavingRow = Schemas["SavingRow"];

// --- Export ---
export type ExportCatalog = Schemas["ExportCatalog"];
export type ExportDataset = Schemas["ExportDataset"];

// --- MCP status view ---
export type StatusResponse = Schemas["StatusResponse"];
export type EndpointStatus = Schemas["EndpointStatus"];
export type Capability = Schemas["Capability"];

