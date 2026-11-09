import { z } from "zod";
import type { MigrationReport } from "./pipeline-migration-model";

export const migrationRecordUnavailable = "This imported record is unavailable or its source link changed.";
const record = { origin: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,59}$/),
  key: z.string().regex(/^(Contact|Lead|Note|Task|Callback):[a-zA-Z0-9_.:@-]{1,100}$/) };
export const migrationRecordInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("result"), ...record, targetId: z.string().min(1).max(240) }),
  z.object({ type: z.literal("receipt"), ...record, receiptId: z.uuid() }),
]);
export type MigrationRecordQuery = z.infer<typeof migrationRecordInput>;
export type MigrationDestination =
  | { kind: "contact" | "lead" | "archivedLead" | "contactTask"; id: string }
  | { kind: "loan"; id: string; target: string };
export type MigrationRecord = {
  destination: MigrationDestination;
  evidence?: { title: string; text?: string; at?: string; dueAt?: string; completedAt?: string };
};
export type MigrationMutationResult = { migrationChanged: boolean; message: string; migration?: MigrationReport;
  applicationLoanId?: string; mismoDuplicateLoanId?: string };
