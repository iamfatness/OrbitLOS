import { z } from "zod";
import type { Contact } from "./model";
import { referralPhone } from "./referral-matches";

const id = z.string().min(1).max(160);
const pair = { sourceId: id, targetId: id };
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
const mergeCursor = z.object({ at: z.iso.datetime(), mergeId: z.uuid() });
const identityKey = z.string().max(330).regex(/^(email:.+|phone:\d{10,15})$/);
const groupRevision = z.string().regex(/^(legacy|[a-f0-9]{32})$/);
export const contactMergeInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("duplicateGroups"), after: identityKey.optional() }),
  z.object({ type: z.literal("duplicateMembers"), key: identityKey, after: id.optional() }),
  z.object({ type: z.literal("duplicateHistory"), after: mergeCursor.optional() }),
  z.object({ type: z.literal("keepDuplicatesSeparate"), key: identityKey, revision: groupRevision,
    reason: z.string().trim().min(1).max(300), operationId: z.uuid() }),
  z.object({ type: z.literal("reopenDuplicates"), reviewId: z.uuid() }),
  z.object({ type: z.literal("preview"), ...pair }),
  z.object({ type: z.literal("merge"), ...pair, fingerprint, operationId: z.uuid() }),
  z.object({ type: z.literal("history"), after: mergeCursor.optional() }),
  z.object({ type: z.literal("previewUndo"), mergeId: z.uuid() }),
  z.object({ type: z.literal("undo"), mergeId: z.uuid(), fingerprint, operationId: z.uuid() }),
]);
export const contactMergeUnavailable = "Contact merge review is available to brokerage admins.";

type Identity = Pick<Contact, "email" | "phone">;
export function contactMatchFields(first: Identity, second: Identity) {
  const email = first.email.trim().toLowerCase();
  const phone = referralPhone(first.phone);
  return {
    email: Boolean(email && email === second.email.trim().toLowerCase()),
    phone: /^\d{10,15}$/.test(phone) && phone === referralPhone(second.phone),
  };
}

export type ContactMergePreview = {
  kind: "preview"; fingerprint: string;
  source: Contact; target: Contact;
  kept: Pick<Contact, "name" | "email" | "phone" | "role">;
  matches: string[];
  links: { label: string; count: number }[];
  blockers: string[];
  optedOut: boolean;
};
export type ContactMergeCursor = z.infer<typeof mergeCursor>;
export type ContactMergeHistoryRow = ContactMergeCursor & {
  sourceName: string; targetName: string; actor: string; undoneAt: string | null; undoneBy: string | null;
};
export type ContactMergeHistory = { kind: "history"; rows: ContactMergeHistoryRow[]; next: ContactMergeCursor | null };
export type ContactUndoPreview = {
  kind: "undoPreview"; mergeId: string; sourceName: string; targetName: string;
  fingerprint: string | null; blocker: string | null; links: ContactMergePreview["links"];
};
export type DuplicateGroups = { kind: "duplicateGroups"; rows: { key: string; names: string[]; more: boolean }[]; next: string | null };
export type DuplicateMembers = { kind: "duplicateMembers"; contacts: Contact[]; next: string | null;
  revision: string | null; reviewed: boolean };
export type DuplicateScan = { kind: "duplicateScan" };
export type DuplicateHistory = { kind: "duplicateHistory"; rows: {
  reviewId: string; key: string; names: string[]; more: boolean; actor: string; at: string; reason: string;
  reopenedAt: string | null; reopenedBy: string | null;
}[]; next: ContactMergeCursor | null };
export type ContactMergeResult = ContactMergePreview | ContactMergeHistory | ContactUndoPreview | DuplicateGroups | DuplicateMembers | DuplicateScan |
  DuplicateHistory | { kind: "duplicateReviewed" | "duplicateReopened" } |
  { kind: "merged" | "undone"; contactId: string } | { error: string };
