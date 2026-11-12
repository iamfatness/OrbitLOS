import { z } from "zod";
import { documentKinds, documentRecipients, type DocumentKind, type DocumentRecipient } from "./document-model";
import { shiftReportDate } from "./report-date-range";
import type { QuoteProfile } from "./quote-intake-model";

export const documentTemplatePurposes = ["Any loan purpose", "Purchase", "Refinance"] as const;
export const documentTemplateOccupancies = ["Primary residence", "Second home", "Investment property", "FHA secondary residence"] as const;
export const documentTemplateEmployment = ["Current wage employment", "Current self-employment"] as const;
export const documentTemplateLimit = 20;
export const documentTemplatesUnavailable = "Document templates are unavailable in this workspace.";
export const documentTemplateChanged = "The checklist template changed. Reload templates and review it again.";
export const documentTemplateApplicationChanged = "The reviewed 1003 changed. Reload templates and preview the requests again.";

const revision = z.number().int().nonnegative();
const loanId = z.string().min(1).max(100);
const answerRule = z.strictObject({
  questionId: z.uuid(), prompt: z.string().trim().min(3).max(120), equals: z.enum(["Yes", "No"]),
});
export type DocumentAnswerRule = z.infer<typeof answerRule>;
export type DocumentAnswerChoice = Omit<DocumentAnswerRule, "equals"> & { profile: QuoteProfile };
export const documentAnswerBasis = answerRule.extend({ formRevision: revision, responseRevision: revision });
export type DocumentAnswerBasis = z.infer<typeof documentAnswerBasis>;
const itemRule = z.object({
  occupancy: z.enum(documentTemplateOccupancies).optional(),
  employment: z.enum(documentTemplateEmployment).optional(),
  answer: answerRule.optional(),
}).refine(({ occupancy, employment, answer }) => Boolean(occupancy || employment || answer));
export const documentTemplateConfig = z.object({
  title: z.string().trim().min(3).max(80),
  purpose: z.enum(documentTemplatePurposes),
  items: z.array(z.object({ kind: z.enum(documentKinds), instructions: z.string().trim().max(500),
    dueDays: z.number().int().min(0).max(90).nullable(), when: itemRule.optional() })).min(1).max(documentKinds.length)
    .refine((items) => new Set(items.map(({ kind }) => kind)).size === items.length, "Choose each document type once."),
});
export type DocumentTemplateConfig = z.infer<typeof documentTemplateConfig>;
export type DocumentTemplateRule = z.infer<typeof itemRule>;
export type DocumentTemplate = DocumentTemplateConfig & { id: string; revision: number; archived: boolean };
export type DocumentRuleMatch = "Matches" | "Does not match" | "Needs reviewed 1003" | "Missing answer" | "Question changed";
export type DocumentTemplatePage = { templates: DocumentTemplate[]; asOf: string; more: boolean; answerChoices?: DocumentAnswerChoice[]; preview?: {
  recipient: DocumentRecipient; reviewedRevision: number | null; matches: Record<string, Partial<Record<DocumentKind, DocumentRuleMatch>>>;
  answerEvidence?: Record<string, Partial<Record<DocumentKind, DocumentAnswerBasis>>>;
} };

export const documentTemplateRequest = z.discriminatedUnion("type", [
  z.object({ type: z.literal("loan"), loanId, recipient: z.enum(documentRecipients).optional() }),
  z.object({ type: z.literal("manage"), search: z.string().trim().max(80).default("") }),
  z.object({ type: z.enum(["publish", "publishRules", "publishAnswerRules"]), id: z.uuid(), revision, config: documentTemplateConfig }),
  z.object({ type: z.literal("archive"), id: z.uuid(), revision, archived: z.boolean() }),
]);

export const applyDocumentTemplateInput = z.object({
  type: z.literal("applyDocumentTemplate"), loanId, templateId: z.uuid(), revision: revision.min(1), asOf: z.iso.date(),
  recipient: z.enum(documentRecipients).optional(), reviewedRevision: revision.nullable().optional(),
  selectedKinds: z.array(z.enum(documentKinds)).min(1).max(documentKinds.length)
    .refine((kinds) => new Set(kinds).size === kinds.length).optional(),
});

export function documentTemplateRuleLabel(rule: DocumentTemplateRule) {
  return [rule.occupancy, rule.employment, rule.answer && `“${rule.answer.prompt}” · ${rule.answer.equals}`].filter(Boolean).join(" and ");
}

export function documentAnswerKey(answer: Omit<DocumentAnswerRule, "equals">) {
  return JSON.stringify([answer.questionId, answer.prompt]);
}

export function documentTemplateDueOn(asOf: string, days: number | null) {
  return days === null ? null : shiftReportDate(asOf, days);
}
