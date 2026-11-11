import { z } from "zod";

// Verified against the authenticated UWM Developer Portal on November 10, 2026.
// No default branch, contact, condition category, product or price is invented.
const contact = z.string().min(1).max(25);
export const uwmScanRequest = z.strictObject({
  entityId: contact, contactId: contact, alternativeContactId: contact.optional(),
  lockAndShop: z.boolean().optional(), teamMemberLoan: z.boolean().optional(),
  loanOriginatorType: z.enum(["Broker", "Correspondent", "Lender", "Other"]).optional(),
  correspondentReason: z.enum(["BranchNotCorrespondent", "CorrespondentNotFHAApproved", "NotLicensedInPropertyType",
    "TransitioningToCorrespondent", "WarehouseLineProductTypeNotAllowed", "WarehouseLineMaxedOut"]).optional(),
  name: z.string().max(50).optional(), email: z.string().max(50).optional(),
});
export const uwmDocumentType = z.enum(["All Conditions", "Underwriter II Conditions", "Senior Underwriter Conditions",
  "Project Review Conditions", "Disclosures/Compliance Conditions", "Master Conditions"]);
const attachment = z.strictObject({ documentType: uwmDocumentType, comments: z.string(),
  files: z.array(z.strictObject({ documentId: z.number().int().positive() })).min(1),
  conditions: z.array(z.string().min(1)).min(1),
});
export const uwmConditionSubmission = z.strictObject({ attachments: z.array(attachment).min(1) });
export const uwmConditionAttachments = z.strictObject({ attachments: z.array(attachment.extend({
  attachmentId: z.number().int().nonnegative().nullable(), revisionId: z.string().min(1).nullable(),
}).refine(value => value.attachmentId ? value.revisionId !== null : value.revisionId === null,
  "Existing attachments require their current revision; new attachments require a null revision.")).min(1) });
export const uwmConditionAcknowledgment = z.object({ documentTypes: z.array(uwmDocumentType), errors: z.array(z.string()) });
export const uwmDocumentName = z.string().min(1).max(255)
  .regex(/^[^/\\\u0000-\u001f]+\.(docx?|txt|tiff?|gif|jpe?g|png|xlsx?|csv|heif|heic|bmp|pdf)$/i);
