import { z } from "zod";

export const playbookRunsUnavailable = "Automation run history is unavailable in this workspace.";
export const playbookRunFilters = ["All runs", "Failed", "Paused", "Completed", "Superseded"] as const;
export const playbookRunSources = ["All automations", "Post-funding follow-up", "Campaign follow-up", "Document reminders"] as const;
export const recoveryBatchLimit = 20;
const id = z.uuid();
const position = z.number().int().positive().safe();
const cursor = z.object({ id, at: z.iso.datetime() });
const source = z.enum(["funding", "campaign", "document"]).optional();
const recoveryItem = z.object({ id, attempt: position });
const uniqueRuns = (items: { id: string }[]) => new Set(items.map((item) => item.id)).size === items.length;
const recoveryItems = z.array(recoveryItem).min(1).max(recoveryBatchLimit).refine(uniqueRuns);
const campaignRecoveryItems = z.array(recoveryItem.extend({ leadRevision: z.number().int().nonnegative().safe(), ownerEmail: z.string().min(1).max(254) }))
  .min(1).max(recoveryBatchLimit).refine(uniqueRuns);
export const playbookRunInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("list"), filter: z.enum(playbookRunFilters), automation: z.enum(playbookRunSources).optional(), after: cursor.optional() }),
  z.object({ type: z.literal("attempts"), id, source, before: position.optional() }),
  z.object({ type: z.literal("retry"), id, source, attempt: position, operationId: id }),
  z.object({ type: z.literal("checkDocuments"), operationId: id, simulate: z.boolean() }),
  z.object({ type: z.literal("documentSchedule") }),
  z.object({ type: z.literal("setDocumentSchedule"), enabled: z.boolean(), revision: z.number().int().nonnegative().safe() }),
  z.object({ type: z.literal("previewDocumentRecovery") }),
  z.object({ type: z.literal("recoverDocuments"), operationId: id, items: recoveryItems }),
  z.object({ type: z.literal("previewCampaignRecovery"), runId: id.optional() }),
  z.object({ type: z.literal("recoverCampaignFollowUps"), operationId: id, items: campaignRecoveryItems }),
]);

export type PlaybookRunQuery = z.infer<typeof playbookRunInput>;
export type PlaybookRunStatus = Exclude<(typeof playbookRunFilters)[number], "All runs">;
type Run = { id: string; borrower: string; reason: string; at: string; attemptCount: number; ruleRevision: number; dueAt: string; canRetry: boolean };
export type FundingPlaybookRun = Run & { source: "funding"; loanId: string; fundingDate: string; fundingRevision: number; delayDays: number;
  status: Exclude<PlaybookRunStatus, "Paused"> };
export type CampaignPlaybookRun = Run & { source: "campaign"; campaignId: string; campaignName: string; leadId: string; outcome: string; callNumber: number;
  delayDays: number | null; status: PlaybookRunStatus; blockedReason: string | null };
export type DocumentReminderRun = Omit<Run, "ruleRevision" | "dueAt"> & { source: "document"; loanId: string; requestId: string;
  documentKind: string; dueOn: string; eligibleOn: string; timingOffsetDays: number;
  documentRevision: number; deadlineRevision: number; receipt: string | null; blockedReason: string | null;
  status: Exclude<PlaybookRunStatus, "Paused"> };
export type DocumentRecoveryCandidate = Pick<DocumentReminderRun, "id" | "loanId" | "requestId" | "borrower" | "documentKind" | "dueOn" | "eligibleOn" | "blockedReason"> & { attempt: number };
export type DocumentRecoveryResult = { kind: "document-recovery"; rows: { id: string; status: "Recovered" | "Skipped"; reason: string }[];
  recovered: number; skipped: number };
export type CampaignRecoveryCandidate = Pick<CampaignPlaybookRun, "id" | "leadId" | "campaignId" | "campaignName" | "borrower" | "dueAt" | "outcome" | "delayDays" | "blockedReason"> & {
  attempt: number; leadRevision: number; owner: string | null; ownerEmail: string | null; status: "Failed" | "Paused";
};
export type CampaignRecoveryResult = { kind: "campaign-recovery"; rows: { id: string; status: "Recovered" | "Skipped" | "Failed"; reason: string }[];
  recovered: number; skipped: number; failed: number };
export type DocumentReminderSchedule = { kind: "document-schedule"; available: boolean; enabled: boolean; revision: number;
  nextAt: string | null; lastCheckedAt: string | null; lastProcessed: number | null };
export type PlaybookRun = FundingPlaybookRun | CampaignPlaybookRun | DocumentReminderRun;
export type PlaybookAttempt = { attempt: number; mode: "Trigger" | "Retry" | "Reconcile"; status: Exclude<PlaybookRunStatus, "Superseded">; reason: string;
  actor: string; at: string; taskChanges: number };
export type PlaybookRunResult = { kind: "list"; runs: PlaybookRun[]; next: z.infer<typeof cursor> | null } |
  { kind: "attempts"; attempts: PlaybookAttempt[]; before: number | null } |
  { kind: "retry"; status: PlaybookRunStatus; message: string } |
  { kind: "document-recovery-preview"; ready: DocumentRecoveryCandidate[]; blocked: DocumentRecoveryCandidate[]; moreReady: boolean; moreBlocked: boolean } |
  { kind: "campaign-recovery-preview"; ready: CampaignRecoveryCandidate[]; blocked: CampaignRecoveryCandidate[]; moreReady: boolean; moreBlocked: boolean } |
  DocumentRecoveryResult | CampaignRecoveryResult | DocumentReminderSchedule |
  { kind: "document-check"; message: string; processed: number; interrupted: number; more: boolean } | { error: string };
