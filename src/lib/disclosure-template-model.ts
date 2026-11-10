import { z } from "zod";
import { isUsStateCode, type ApplicationDraft } from "./application-model";
import { disclosureDocuments, disclosureTemplateChoice } from "./disclosure-model";

export const disclosureTemplateUnavailable = "Sample disclosure templates are unavailable in this workspace.";
export const disclosureTemplateChanged = "The sample template changed or no longer matches this loan. Refresh and choose a current template.";
export const disclosureTemplatePurposes = ["Any loan purpose", "Purchase", "Refinance"] as const;
export const disclosureTemplateConfig = z.object({
  title: z.string().trim().min(2).max(80),
  purpose: z.enum(disclosureTemplatePurposes),
  propertyState: z.string().trim().toUpperCase().refine((state) => !state || isUsStateCode(state), "Enter a two-letter property state code or leave it blank."),
  documents: disclosureDocuments,
});
export type DisclosureTemplateConfig = z.infer<typeof disclosureTemplateConfig>;
export type DisclosureTemplateBasis = Omit<DisclosureTemplateConfig, "documents"> & z.infer<typeof disclosureTemplateChoice>;
export type DisclosureTemplate = DisclosureTemplateBasis & Pick<DisclosureTemplateConfig, "documents"> & { archived: boolean };
export type DisclosureTemplateMatch = { purpose: ApplicationDraft["purpose"]; propertyState: string };
export type DisclosureTemplateOptions = DisclosureTemplateMatch & { templates: DisclosureTemplate[]; recommendedId: string | null };
export const disclosureTemplateInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("list") }),
  z.object({ type: z.literal("publish"), id: z.uuid(), revision: z.number().int().nonnegative(), config: disclosureTemplateConfig }),
  z.object({ type: z.literal("archive"), ...disclosureTemplateChoice.shape, archived: z.boolean() }),
]);
export type DisclosureTemplateResult = { templates: DisclosureTemplate[]; moreArchived: boolean } | { error: string };

export function disclosureTemplateMatch(draft: ApplicationDraft): DisclosureTemplateMatch {
  const state = draft.propertyLocation.state.trim().toUpperCase();
  return { purpose: draft.purpose, propertyState: isUsStateCode(state) ? state : "" };
}
