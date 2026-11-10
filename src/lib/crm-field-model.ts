import { z } from "zod";

export const crmFieldUnavailable = "These CRM fields are unavailable in your workspace.";
export const crmFieldLimit = 20;
export const crmFieldKinds = ["Short text", "Choice", "Yes or no", "Number", "Date"] as const;
export const crmFieldRoles = ["LO", "Processor"] as const;
export const crmFieldScopes = ["Lead and borrower", "Loan file"] as const;
const crmFieldRecord = z.enum(["lead", "contact", "loan"]);
const valueText = z.string().trim().max(120);
const revision = z.number().int().nonnegative();
const fieldId = z.uuid();
const target = { record: crmFieldRecord, recordId: z.string().min(1).max(160) };
export const crmFieldFilter = z.object({ fieldId, value: valueText.min(1) });
export type CrmFieldFilter = z.infer<typeof crmFieldFilter>;
export const crmFieldDefinition = z.object({
  label: z.string().trim().min(2).max(60), kind: z.enum(crmFieldKinds),
  options: z.array(z.string().trim().min(1).max(50)).max(12),
  roles: z.array(z.enum(crmFieldRoles)).max(2),
  recordScope: z.enum(crmFieldScopes).default("Lead and borrower"),
  editRoles: z.array(z.enum(crmFieldRoles)).max(2).optional(),
}).superRefine(({ kind, options, roles, recordScope, editRoles }, ctx) => {
  if (kind === "Choice" ? options.length < 2 : options.length !== 0) {
    ctx.addIssue({ code: "custom", path: ["options"], message: "A choice field needs at least two options." });
  }
  if (new Set(options.map((option) => option.toLowerCase())).size !== options.length || new Set(roles).size !== roles.length) {
    ctx.addIssue({ code: "custom", message: "Use each option and role only once." });
  }
  if (editRoles && (recordScope !== "Loan file" || new Set(editRoles).size !== editRoles.length || editRoles.some((role) => !roles.includes(role)))) {
    ctx.addIssue({ code: "custom", message: "Choose edit access from the roles that can see this loan field." });
  }
});
export type CrmFieldDefinition = z.infer<typeof crmFieldDefinition>;
export type CrmField = CrmFieldDefinition & { id: string; revision: number };
export type CrmFieldRecord = z.infer<typeof crmFieldRecord>;
export type CrmFieldTarget = { record: CrmFieldRecord; recordId: string };
export type CrmFieldEntry = { field: CrmField; value: string | null; revision: number; editable: boolean };
export function crmFieldAppliesTo(field: Pick<CrmField, "recordScope">, record: CrmFieldRecord) {
  return (field.recordScope === "Loan file") === (record === "loan");
}

export const crmFieldInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("list") }),
  z.object({ type: z.literal("saveField"), fieldId, revision, definition: crmFieldDefinition }),
  z.object({ type: z.literal("archiveField"), fieldId, revision: revision.min(1) }),
  z.object({ type: z.literal("values"), ...target }),
  z.object({ type: z.literal("saveValue"), ...target, fieldId, fieldRevision: revision.min(1), revision, value: valueText.nullable() }),
]);
export type CrmFieldInput = z.infer<typeof crmFieldInput>;
export type CrmFieldResult = { kind: "list"; fields: CrmField[] } |
  { kind: "savedField"; field: CrmField } | { kind: "archived" } |
  { kind: "values"; entries: CrmFieldEntry[]; editable: boolean } | { error: string };

export function normalizeCrmFieldValue(field: Pick<CrmField, "kind" | "options">, value: string | null) {
  const text = value?.trim();
  if (!text) return null;
  if (field.kind === "Choice") return field.options.includes(text) ? text : undefined;
  if (field.kind === "Yes or no") return text === "Yes" || text === "No" ? text : undefined;
  if (field.kind === "Date") return z.iso.date().safeParse(text).success ? text : undefined;
  if (field.kind === "Number") {
    const parts = /^(-?)(\d{1,12})(?:\.(\d{1,4}))?$/.exec(text);
    if (!parts) return undefined;
    const whole = parts[2].replace(/^0+(?=\d)/, "");
    const fraction = parts[3]?.replace(/0+$/, "");
    const sign = whole !== "0" || fraction ? parts[1] : "";
    return sign + whole + (fraction ? `.${fraction}` : "");
  }
  return text.length <= 120 ? text : undefined;
}

export const newCrmField: CrmFieldDefinition = { label: "", kind: "Choice", options: [], roles: ["LO"], recordScope: "Lead and borrower" };
