/**
 * Shared app types. Data shapes come from the generated OpenAPI types
 * (see src/types/api.ts). This file re-exports the auth shapes under friendly
 * names and adds UI-only constants (role labels).
 */
import type { Role as ApiRole, TokenResponse, UserPublic } from "@/types/api";

export type Role = ApiRole;
export type User = UserPublic;
export type LoginResponse = TokenResponse;

/** Human-readable role labels for the UI. Two active roles: Admin, Employee.
 * Legacy labels are retained so the Record stays exhaustive over the type. */
export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  employee: "Employee",
  operations: "Operations",
  finance: "Finance",
  viewer: "Viewer",
};
