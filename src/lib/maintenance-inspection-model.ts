import { z } from "zod";

export const inspectionPageSize = 25;
export const maintenanceInspectionInput = z.object({
  revision: z.number().int().nonnegative(),
  documents: z.number().int().min(0).max(1000000).default(0),
  requests: z.number().int().min(0).max(1000000).default(0),
});
export type MaintenanceInspectionInput = z.infer<typeof maintenanceInspectionInput>;
export type InspectionDocument = { reference: string; label: string; recordId: string; recordName: string; revision: number | null;
  availability: "Available" | "Missing" | "No retained file" | "Check unavailable"; bytes: number | null };
export type InspectionRequest = { reference: string; source: string; recordId: string; recordName: string; action: string; state: string; at: string; environment: string };
export type InspectionPage<T> = { items: T[]; total: number; offset: number; next: number | null };
export type MaintenanceInspection = { revision: number; inspectedAt: string;
  records: { label: string; count: number | null }[]; unavailable: string[];
  documents: InspectionPage<InspectionDocument>; requests: InspectionPage<InspectionRequest> };
