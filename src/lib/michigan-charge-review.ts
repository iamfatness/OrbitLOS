import { z } from "zod";
import type { TridEntry } from "./trid-model";

export const michiganChargeCategories = ["Actual expense", "Processing fee", "Rate guarantee", "Unclassified"] as const;
export const michiganGuaranteeExtensions = ["Unresolved", "No extension", "Extended"] as const;
export const michiganChargeAuthority = "https://legislature.mi.gov/Laws/MCL?objectName=mcl-445-1673";
const amount = z.number().int().min(0).max(10_000_000_000);
const reference = z.string().trim().min(1).max(180);
const date = z.iso.date().refine(value => value >= "2022-01-01" && value <= "2099-12-31", "Enter a date from 2022 through 2099.");

export const michiganChargeReview = z.strictObject({
  type: z.literal("miChargeReview"),
  key: z.string().trim().toLowerCase().min(1).max(80),
  name: reference,
  applicability: z.enum(["First mortgage by this licensee or registrant", "Unresolved"]),
  category: z.enum(michiganChargeCategories),
  chargedCents: amount,
  paidCents: amount.optional(),
  collections: z.number().int().min(0).max(1000).optional(),
  expenseCents: amount.optional(),
  expenseReference: reference.optional(),
  termsReference: reference.optional(),
  originalExpiry: date.optional(),
  extension: z.enum(michiganGuaranteeExtensions).optional(),
  extendedExpiry: date.optional(),
  extensionReference: reference.optional(),
  reference,
}).superRefine((event, ctx) => {
  if (event.category !== "Actual expense" && (event.expenseCents !== undefined || event.expenseReference))
    ctx.addIssue({ code: "custom", message: "Enter expense evidence only for an actual expense." });
  if (event.category !== "Rate guarantee" && (event.termsReference || event.originalExpiry || event.extension || event.extendedExpiry || event.extensionReference))
    ctx.addIssue({ code: "custom", message: "Enter guarantee evidence only for a rate guarantee." });
  if (event.extension !== "Extended" && (event.extendedExpiry || event.extensionReference))
    ctx.addIssue({ code: "custom", message: "Select Extended before entering extension evidence." });
  if (event.paidCents !== undefined && event.collections !== undefined && ((event.paidCents === 0) !== (event.collections === 0)))
    ctx.addIssue({ code: "custom", message: "Total payments and collection count disagree. Check the payment record." });
});

export function reviewMichiganCharges(active: readonly TridEntry[]) {
  return active.flatMap(({ sequence, event }) => {
    if (event.type !== "miChargeReview") return [];
    const issues: string[] = [];
    if (event.applicability === "Unresolved") issues.push("Confirm the first mortgage and the party that assessed or accepted the fee.");
    if (event.category === "Unclassified") issues.push("Identify the type of charge.");
    if (event.paidCents === undefined || event.collections === undefined) issues.push("Reconcile the amount and count against the payment record.");
    if (event.collections !== undefined && event.collections > 1) issues.push("Multiple collections recorded. Check for duplicate payment or documented installments.");
    if (event.paidCents !== undefined && event.paidCents > event.chargedCents) issues.push("Recorded payments exceed the recorded charge.");
    if (event.category === "Actual expense") {
      if (event.expenseCents === undefined || !event.expenseReference) issues.push("Record the documented actual expense and its source.");
      if (event.expenseCents !== undefined && event.chargedCents > event.expenseCents) issues.push("Recorded charge exceeds the recorded actual expense.");
    }
    if (event.category === "Rate guarantee") {
      if (!event.termsReference || !event.originalExpiry) issues.push("Record the written guarantee terms and original expiration.");
      if (!event.extension || event.extension === "Unresolved") issues.push("Confirm whether the guarantee was extended.");
      if (event.extension === "Extended" && (!event.extendedExpiry || !event.extensionReference))
        issues.push("Record the extended expiration and the written extension agreed to by all parties.");
      if (event.extendedExpiry && event.originalExpiry && event.extendedExpiry <= event.originalExpiry)
        issues.push("The recorded extension does not move the original expiration later.");
    }
    return [{ sequence, issues }];
  });
}
