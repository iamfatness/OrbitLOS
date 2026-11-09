import { z } from "zod";
import type { BrokerageRole, BrokerageMember } from "./brokerage-model";
import { officerQueueCursor, type CalendarItem, type CalendarPage } from "./officer-queue-model";

export const coverageUnavailable = "This coverage or work item is unavailable.";
export const coverageKinds = ["campaign", "lead-task", "contact", "closing", "checklist", "document"] as const;
export type CoverageKind = (typeof coverageKinds)[number];
export const coveredCampaignOutcomes = ["Connected", "Left message", "No response", "Opted out"] as const;
export const coveredContactOutcomes = ["Connected", "Left message", "No response", "Resolved", "No further follow-up needed"] as const;
const id = z.uuid();
const email = z.email().max(254);
const date = z.iso.date().refine((value) => value >= "1900-01-01" && value <= "9998-12-31");
const item = z.object({ kind: z.enum(coverageKinds), id: z.string().min(1).max(200) });
const revision = z.number().int().nonnegative();
const update = z.discriminatedUnion("kind", [
  item.extend({ kind: z.literal("campaign"), revision, outcome: z.enum(coveredCampaignOutcomes), note: z.string().trim().max(400) }),
  item.extend({ kind: z.literal("lead-task"), previous: z.iso.datetime() }),
  item.extend({ kind: z.literal("contact"), revision, outcome: z.enum(coveredContactOutcomes), note: z.string().trim().max(500) }),
  item.extend({ kind: z.literal("closing"), previous: date, dueOn: date }),
  item.extend({ kind: z.literal("checklist"), revision }),
  item.extend({ kind: z.literal("document"), revision, deadlineRevision: revision, dueOn: date }),
]);

export const coverageInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("list") }),
  z.object({ type: z.literal("schedule"), id, absentEmail: email, backupEmail: email, startsOn: date, endsOn: date }),
  z.object({ type: z.literal("end"), id }),
  z.object({ type: z.literal("queue"), id, after: officerQueueCursor.optional() }),
  z.object({ type: z.literal("item"), id, item }),
  z.object({ type: z.literal("act"), id, operationId: id, update }),
]);

export type CoverageInput = z.infer<typeof coverageInput>;
export type CoverageChange = z.infer<typeof update>;
export type CoverageWindow = {
  id: string; absentEmail: string; absentName: string; absentRole: BrokerageRole;
  backupEmail: string; backupName: string; backupRole: BrokerageRole;
  startsOn: string; endsOn: string; endedAt: string | null;
};
export type CoverageItem = Pick<CalendarItem, "id" | "name" | "title" | "dueAt" | "overdue"> & { kind: CoverageKind };
export type CoverageDetail = CoverageItem & { revision: number; deadlineRevision: number; phone: string; email: string; context: string };
export type CoverageResult = { kind: "list"; windows: CoverageWindow[]; members: BrokerageMember[]; today: string } |
  { kind: "queue"; items: CoverageItem[]; next: CalendarPage["next"] } | { kind: "item"; item: CoverageDetail } |
  { kind: "saved"; message: string } | { error: string };
