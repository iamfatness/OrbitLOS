import { z } from "zod";

const revision = z.number().int().positive();
export const preapprovalTemplateRef = z.strictObject({ id: z.uuid(), revision });
export const preapprovalTemplateConfig = z.object({
  title: z.string().trim().min(3).max(64),
  note: z.string().trim().max(180),
});
export const preapprovalTemplateSnapshot = preapprovalTemplateConfig.extend(preapprovalTemplateRef.shape);
export type PreapprovalTemplateConfig = z.infer<typeof preapprovalTemplateConfig>;
export type PreapprovalTemplateSnapshot = z.infer<typeof preapprovalTemplateSnapshot>;
export type PreapprovalTemplate = PreapprovalTemplateSnapshot & { archived: boolean };
export type PreapprovalTemplateVersion = PreapprovalTemplate & { publishedAt: string };
export const preapprovalTemplateChanged = "The sample template changed. Refresh letters and preview the current version.";
export const preapprovalTemplateRequests = [
  z.object({ type: z.literal("templateList"), search: z.string().trim().max(64).default("") }),
  z.object({ type: z.literal("templateHistory"), id: z.uuid(), beforeRevision: revision.optional() }),
  z.object({ type: z.literal("templatePublish"), id: z.uuid(), revision: z.number().int().nonnegative(), config: preapprovalTemplateConfig }),
  z.object({ type: z.literal("templateArchive"), ...preapprovalTemplateRef.shape, archived: z.boolean() }),
] as const;
export type PreapprovalTemplateRequest = z.infer<(typeof preapprovalTemplateRequests)[number]>;
export type PreapprovalTemplateResult =
  { templates: PreapprovalTemplate[]; more: boolean } |
  { history: PreapprovalTemplateVersion[]; beforeRevision: number | null };
