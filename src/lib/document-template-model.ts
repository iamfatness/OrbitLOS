import { z } from "zod";
import { documentKinds } from "./document-model";
import { shiftReportDate } from "./report-date-range";

export const documentTemplatePurposes = ["Any loan purpose", "Purchase", "Refinance"] as const;
export const documentTemplateLimit = 20;
export const documentTemplatesUnavailable = "Document templates are unavailable in this workspace.";
export const documentTemplateChanged = "The checklist template changed. Reload templates and review it again.";

const revision = z.number().int().nonnegative();
const loanId = z.string().min(1).max(100);
export const documentTemplateConfig = z.object({
  title: z.string().trim().min(3).max(80),
  purpose: z.enum(documentTemplatePurposes),
  items: z.array(z.object({ kind: z.enum(documentKinds), instructions: z.string().trim().max(500),
    dueDays: z.number().int().min(0).max(90).nullable() })).min(1).max(documentKinds.length)
    .refine((items) => new Set(items.map(({ kind }) => kind)).size === items.length, "Choose each document type once."),
});
export type DocumentTemplateConfig = z.infer<typeof documentTemplateConfig>;
export type DocumentTemplate = DocumentTemplateConfig & { id: string; revision: number; archived: boolean };
export type DocumentTemplatePage = { templates: DocumentTemplate[]; asOf: string; more: boolean };

export const documentTemplateRequest = z.discriminatedUnion("type", [
  z.object({ type: z.literal("loan"), loanId }),
  z.object({ type: z.literal("manage"), search: z.string().trim().max(80).default("") }),
  z.object({ type: z.literal("publish"), id: z.uuid(), revision, config: documentTemplateConfig }),
  z.object({ type: z.literal("archive"), id: z.uuid(), revision, archived: z.boolean() }),
]);

export const applyDocumentTemplateInput = z.object({
  type: z.literal("applyDocumentTemplate"), loanId, templateId: z.uuid(), revision: revision.min(1), asOf: z.iso.date(),
});

export function documentTemplateDueOn(asOf: string, days: number | null) {
  return days === null ? null : shiftReportDate(asOf, days);
}
