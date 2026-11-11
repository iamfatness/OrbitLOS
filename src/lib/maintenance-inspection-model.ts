import { z } from "zod";

export const inspectionPageSize = 25;
export const maintenanceInspectionInput = z.object({
  revision: z.number().int().nonnegative(),
  documents: z.number().int().min(0).max(1000000).default(0),
  requests: z.number().int().min(0).max(1000000).default(0),
});
export type MaintenanceInspectionInput = z.infer<typeof maintenanceInspectionInput>;
export const decisionOutcomes = ["Needs investigation", "Preserve observed result", "Known sample limitation"] as const;
export const maintenanceDecisionInput = maintenanceInspectionInput.extend({
  id:z.uuid(), reference:z.string().min(1).max(200), fingerprint:z.string().regex(/^[a-f0-9]{64}$/),
  outcome:z.enum(decisionOutcomes), note:z.string().trim().min(20).max(1000),
});
export type MaintenanceDecisionInput = z.infer<typeof maintenanceDecisionInput>;
export type InspectionDecision = {id:string;reference:string;fingerprint:string;outcome:typeof decisionOutcomes[number];note:string;actor:string;at:string};
export type InspectionEvidence = {fingerprint:string; decisions:InspectionDecision[]};
export type InspectionDocument = InspectionEvidence & { reference: string; label: string; recordId: string; recordName: string; revision: number | null;
  availability: "Available" | "Missing" | "No retained file" | "Check unavailable"; bytes: number | null };
export type InspectionRequest = InspectionEvidence & { reference: string; source: string; recordId: string; recordName: string; action: string; state: string; at: string; environment: string };
export type InspectionPage<T> = { items: T[]; total: number; offset: number; next: number | null };
export type MaintenanceInspection = { revision: number; inspectedAt: string;
  records: { label: string; count: number | null }[]; unavailable: string[];
  documents: InspectionPage<InspectionDocument>; requests: InspectionPage<InspectionRequest> };
