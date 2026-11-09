import { z } from "zod";
import { portalAccessCodePattern, portalTokenPattern } from "./brokerage-model";
import { documentKinds, type DocumentRequest } from "./document-model";
import { demoPdfFixtureIds } from "./document-files-model";

const leadId = z.uuid();
const requestId = z.uuid();
const revision = z.number().int().nonnegative();
const linkId = z.uuid();
const credentials = { token: z.string().regex(portalTokenPattern), code: z.string().trim().toLowerCase().regex(portalAccessCodePattern) };
export const leadDocumentStaffInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("read"), leadId }),
  z.object({ type: z.literal("request"), leadId, requestId, kind: z.enum(documentKinds), instructions: z.string().trim().min(1).max(500),
    dueOn: z.iso.date().nullable() }),
  z.object({ type: z.literal("issue"), leadId, linkId, ...credentials, hours: z.literal([1, 24, 72]), confirmedFictional: z.literal(true) }),
  z.object({ type: z.literal("revoke"), leadId, linkId }),
  z.object({ type: z.literal("review"), leadId, requestId, revision, decision: z.enum(["Accepted", "Needs replacement"]),
    replacementNote: z.string().trim().max(500) }),
]);

export const leadDocumentPortalInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("read"), ...credentials }),
  z.object({ type: z.literal("upload"), ...credentials, requestId, revision, fixture: z.enum(demoPdfFixtureIds) }),
]);
export type LeadDocumentPortalInput = z.infer<typeof leadDocumentPortalInput>;
export type LeadSampleUpload = Omit<Extract<LeadDocumentPortalInput, { type: "upload" }>, "type" | "fixture">;
export type LeadDocumentPage = {
  requests: DocumentRequest[];
  link: { id: string; expiresAt: string } | null;
  canRequest: boolean;
  canIssue: boolean;
  createdId?: string;
  message?: string;
};
export const leadDocumentsUnavailable = "Lead documents are available on assigned fictional leads in your pilot workspace.";
export const leadDocumentPortalUnavailable = "This lead document link is unavailable. Check the link and code or ask your loan officer for the current link.";
