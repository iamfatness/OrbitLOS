import { z } from "zod";
import type { BrokerageTemplate, CommunicationDraft } from "./model";

export const draftQueueViews = ["Ready to copy", "Copied", "All drafts"] as const;
export const draftQueueUnavailable = "Could not load milestone drafts. Try again.";
const draftCursor = z.object({ createdAt: z.string().min(1).max(40), id: z.string().min(1).max(100) });
export const draftQueueInput = z.object({ view: z.enum(draftQueueViews), after: draftCursor.optional() });
export type DraftQueueQuery = z.infer<typeof draftQueueInput>;
export type DraftQueueRow = Pick<CommunicationDraft, "id" | "loanId" | "audience" | "milestone" | "createdAt" | "emailCopiedAt" |
  "textCopiedAt" | "supersededAt"> & { recipient: string | null; borrower: string | null; linked: boolean; current: boolean };
export type DraftQueuePage = { rows: DraftQueueRow[]; next: z.infer<typeof draftCursor> | null; templates?: BrokerageTemplate[] };
export type TemplateMutationResult = { template: BrokerageTemplate; message: string };
