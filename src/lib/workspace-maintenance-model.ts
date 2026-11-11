import { z } from "zod";

export const maintenanceMessage = "This workspace is paused for maintenance. Your saved work is retained. Try again after your brokerage admin reopens it.";
export const maintenanceChecks = ["Saved work and documents", "Unresolved requests and provider outcomes", "Staff and portal access"] as const;
export type MaintenanceMode = "Open" | "Pausing" | "Paused";
export type MaintenanceState = { mode: MaintenanceMode; revision: number; reason: string; startedAt: string | null;
  startedBy: string | null; reviewedAt: string | null; reviewedBy: string | null; review: string; checks: boolean[] };
export type MaintenanceView = MaintenanceState & {
  active: number;
  pendingRestore: boolean;
  pendingEditRecovery: boolean;
  history: { action: string; actor: string; at: string; note: string }[];
};
export const maintenanceInput = z.discriminatedUnion("type", [
  z.object({type:z.literal("pause"),revision:z.number().int().nonnegative(),reason:z.string().trim().min(8).max(500),confirmation:z.string().max(80)}),
  z.object({type:z.literal("review"),revision:z.number().int().nonnegative(),review:z.string().trim().min(8).max(1000),checks:z.tuple([z.literal(true),z.literal(true),z.literal(true)])}),
  z.object({type:z.literal("reopen"),revision:z.number().int().nonnegative(),confirmation:z.string().max(80)}),
]);
export type MaintenanceInput = z.infer<typeof maintenanceInput>;
