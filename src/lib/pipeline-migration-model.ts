import { z } from "zod";
import { contactRoles, readCsv } from "./contact-csv";
import { activityKinds, contactOutcomes, followUpOutcomes, followUpPurposes, leadSources } from "./model";
import { leadOutcomes, outreachChannels } from "./lead-inbox-model";
import { callOutcomes } from "./call-campaign-model";

export const migrationColumns = ["type", "externalId", "parentId", "name", "email", "phone", "role", "ownerEmail",
  "purpose", "source", "zip", "createdAt", "dueAt", "completedAt", "text", "taskPurpose",
  "parentType", "realtorId", "firstContactAt", "heldAt", "holdReason", "revisitDate", "optedOut",
  "activityKind", "activityOutcome", "leadEventKind", "leadOutcome", "leadEventActor"] as const;
export type MigrationColumn = (typeof migrationColumns)[number];
export const requiredMigrationColumns: MigrationColumn[] = ["type", "externalId"];
export const migrationTypes = ["Contact", "Lead", "Note", "Task", "Callback"] as const;
const externalId = z.string().trim().regex(/^[a-zA-Z0-9_.:@-]{1,100}$/, "Use a stable source ID with letters, numbers, or ._:@-.");
const name = z.string().trim().min(1).max(160);
const email = z.union([z.literal(""), z.email().max(254)]);
const date = z.union([z.iso.date(), z.iso.datetime({ offset: true })]);
const optionalDate = z.union([z.literal(""), date]);
const identity = { externalId, name, email, phone: z.string().trim().max(40) };
const optedOut = z.literal(["", "Yes"]).optional();
const historyDate = z.iso.datetime({ offset: true });
const historyActor = { revision: z.int().positive(), actor: z.string().min(1).max(254), actorEmail: z.email().max(254).nullable() };
const followUpHistory = z.object({
  version: z.literal(1),
  revision: z.int().nonnegative(),
  loggedBy: z.string().min(1).max(254),
  postFundingCheckIn: z.boolean(),
  completions: z.array(z.object({ ...historyActor, completedAt: historyDate,
    outcome: z.enum(followUpOutcomes).nullable(), note: z.string().max(500) })),
  reschedules: z.array(z.object({ ...historyActor, changedAt: historyDate,
    previousDueAt: historyDate, dueAt: historyDate, reason: z.string().trim().min(1).max(500) })),
}).refine(({ revision, completions, reschedules }) => {
  const changes = [...completions, ...reschedules].map((item) => item.revision);
  return new Set(changes).size === changes.length && changes.every((value) => value <= revision);
}, "Follow-up history must use distinct revisions within the reminder’s current revision.");
export const callbackMigrationPromiseLimit = 100;
export const callbackMigrationSchedulingAttemptLimit = 100;
const callbackSchedulingAttempt = z.strictObject({
  attempt: z.int().positive(), operationId: externalId, mode: z.enum(["Trigger", "Retry"]), status: z.enum(["Failed", "Paused", "Completed"]),
  reason: z.string().max(500), actor: z.string().min(1).max(254), at: historyDate, taskChanges: z.int().min(0).max(1),
});
const callbackPromise = z.strictObject({
  id: externalId, callNumber: z.int().positive(), taskId: externalId, taskTitle: z.string().trim().min(1).max(120),
  originalDueAt: historyDate, dueAt: historyDate, requestedAt: historyDate, requestEventId: externalId,
  attemptEventId: externalId.nullable(), closedAt: historyDate.nullable(), closeReason: z.string().trim().min(1).max(160).nullable(),
  status: z.enum(["Failed", "Paused", "Completed", "Superseded"]), reason: z.string().max(500), ruleRevision: z.int().nonnegative(),
  schedulingAttempts: z.array(callbackSchedulingAttempt).min(1).max(callbackMigrationSchedulingAttemptLimit),
});
const callbackHistory = z.strictObject({
  version: z.literal(1), campaignId: externalId, campaignName: z.string().trim().min(1).max(80), joinedAt: historyDate,
  attempts: z.int().positive(), lastOutcome: z.enum(callOutcomes).nullable(), reachedAt: historyDate.nullable(), firstCallAt: historyDate.nullable(),
  currentTaskId: externalId.nullable(), currentTaskDueAt: historyDate.nullable(), currentTaskCompletedAt: historyDate.nullable(),
  promises: z.array(callbackPromise).min(1).max(callbackMigrationPromiseLimit),
}).superRefine((history, context) => {
  if (Boolean(history.currentTaskId) !== Boolean(history.currentTaskDueAt) || (!history.currentTaskId && history.currentTaskCompletedAt)) {
    context.addIssue({ code: "custom", path: ["currentTaskId"], message: "Include the current task and its due date together." });
  }
  const { promises } = history;
  const ids = new Set(promises.map(({ id }) => id));
  const requests = new Set(promises.map(({ requestEventId }) => requestEventId));
  const attempts = promises.flatMap(({ attemptEventId }) => attemptEventId ? [attemptEventId] : []);
  if (ids.size !== promises.length || requests.size !== promises.length || new Set(attempts).size !== attempts.length ||
    promises.some(({ callNumber }, index) => callNumber > history.attempts || (index > 0 && promises[index - 1].callNumber >= callNumber))) {
    context.addIssue({ code: "custom", path: ["promises"], message: "Use distinct promises and exact events in increasing campaign call order." });
  }
  const open = promises.filter(({ closedAt, attemptEventId }) => !closedAt && !attemptEventId);
  if (open.length > 1 || (open[0] && (open[0].callNumber !== history.attempts || history.lastOutcome !== "Requested callback"))) {
    context.addIssue({ code: "custom", path: ["promises"], message: "Only the current requested callback promise may remain open." });
  }
  for (const [index, promise] of promises.entries()) {
    const requested = Date.parse(promise.requestedAt);
    if (Date.parse(promise.originalDueAt) <= requested || Date.parse(promise.dueAt) <= requested ||
      (promise.closedAt && Date.parse(promise.closedAt) < requested) || (promise.attemptEventId && !promise.closedAt) ||
      (promise.closeReason && (!promise.closedAt || promise.attemptEventId)) || promise.attemptEventId === promise.requestEventId) {
      context.addIssue({ code: "custom", path: ["promises", index], message: "Use valid request, deadline, and closing evidence for the promise." });
    }
    if (promise.closedAt && (promise.status === "Failed" || promise.status === "Paused")) {
      context.addIssue({ code: "custom", path: ["promises", index, "status"], message: "Only an open promise can have a pending follow-up." });
    }
    const { schedulingAttempts } = promise;
    if (new Set(schedulingAttempts.map(({ operationId }) => operationId)).size !== schedulingAttempts.length ||
      schedulingAttempts.some(({ attempt, mode, at }, position) => attempt !== position + 1 || mode !== (position ? "Retry" : "Trigger") ||
        Date.parse(at) < Date.parse(schedulingAttempts[position - 1]?.at ?? promise.requestedAt))) {
      context.addIssue({ code: "custom", path: ["promises", index, "schedulingAttempts"], message: "Include the original scheduling attempts in order." });
    }
  }
});
export type CallbackMigrationHistory = z.infer<typeof callbackHistory>;
export const migrationRow = z.discriminatedUnion("type", [
  z.object({ type: z.literal("Contact"), ...identity, role: z.enum(contactRoles), optedOut }),
  z.object({ type: z.literal("Lead"), ...identity, parentId: z.union([z.literal(""), externalId]), ownerEmail: email,
    purpose: z.enum(["Purchase", "Refinance"]), source: z.enum(leadSources), zip: z.string().regex(/^([0-9]{5})?$/),
    createdAt: date, dueAt: optionalDate, realtorId: externalId.optional(), firstContactAt: date.optional(),
    heldAt: date.optional(), holdReason: z.string().trim().min(1).max(160).optional(), revisitDate: z.iso.date().optional(), optedOut }),
  z.object({ type: z.literal("Note"), externalId, parentId: externalId, createdAt: date, text: z.string().trim().min(1).max(1800),
    leadEventKind: z.enum(["Note", "Campaign", ...outreachChannels]).optional(), leadOutcome: z.enum([...leadOutcomes, "Opted out"]).optional(),
    leadEventActor: z.string().min(1).max(254).optional() }),
  z.object({ type: z.literal("Task"), externalId, parentId: externalId, dueAt: date, completedAt: optionalDate,
    text: z.string().trim().min(1).max(2000), taskPurpose: z.enum(followUpPurposes).optional(),
    parentType: z.enum(["Lead", "Contact"]).optional(), createdAt: date.optional(), ownerEmail: email.optional(),
    activityKind: z.enum(activityKinds).optional(), activityOutcome: z.enum(contactOutcomes).optional(), followUpHistory: followUpHistory.optional() }),
  z.object({ type: z.literal("Callback"), externalId, parentId: externalId, text: z.string().trim().min(1).max(200), callbackHistory }),
]).superRefine((row, context) => {
  if (row.type === "Task" && row.parentType !== "Contact" && row.text.length > 120) {
    context.addIssue({ code: "custom", path: ["text"], message: "Lead task titles can contain up to 120 characters." });
  }
  if (row.type === "Task" && row.followUpHistory && (row.parentType !== "Contact" ||
    (row.followUpHistory.reschedules.length > 0 && (!row.followUpHistory.postFundingCheckIn || row.activityOutcome !== "Requested callback")))) {
    context.addIssue({ code: "custom", path: ["followUpHistory"], message: "Follow-up history must belong to a contact reminder. Reschedules require a post-funding callback." });
  }
  if (row.type === "Lead" && (Boolean(row.heldAt) !== Boolean(row.holdReason) || (row.revisitDate && !row.heldAt))) {
    context.addIssue({ code: "custom", path: ["heldAt"], message: "Include a hold date and reason together." });
  }
  if (row.type === "Callback" && row.externalId !== row.parentId) {
    context.addIssue({ code: "custom", path: ["parentId"], message: "Use the source lead ID for both callback record IDs." });
  }
});
export type MigrationRow = z.infer<typeof migrationRow>;
export const migrationKey = (row: MigrationRow) => `${row.type}:${row.externalId}`;
export const migrationBatchRowLimit = 100;
export const migrationFileByteLimit = 200_000;
const orbitSourcePattern = /^orbit-[a-f0-9-]{36}$/;
const batchHeaders = ["orbitSnapshot", "orbitPart", "orbitPartCount"] as const;
const historyHeader = "orbitFollowUpHistory";
const callbackHistoryHeader = "orbitCampaignCallbackHistory";
const migrationBatch = z.object({
  origin: z.string().regex(orbitSourcePattern),
  snapshot: z.string().regex(/^[a-f0-9]{64}$/),
  part: z.number().int().min(1).max(1000),
  partCount: z.number().int().min(1).max(1000),
}).refine((batch) => batch.part <= batch.partCount);
export type MigrationBatch = z.infer<typeof migrationBatch>;

export const migrationInput = z.object({
  type: z.literal("migratePipeline"), origin: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9_-]{0,59}$/, "Enter a source key such as salesforce-demo."),
  rows: z.array(migrationRow).min(1).max(migrationBatchRowLimit),
  decisions: z.record(z.string().max(109), z.string().max(120)),
  correctionKeys: z.array(z.string().min(1).max(109)).max(migrationBatchRowLimit).optional(),
  ownerMappings: z.record(z.email().max(254), z.union([z.email().max(254), z.literal("unassigned")]))
    .refine((mappings) => Object.keys(mappings).length <= migrationBatchRowLimit).optional(),
  preview: z.string().length(64).optional(),
  campaignId: z.uuid().optional(),
  batch: migrationBatch.optional(),
});
export type MigrationInput = z.infer<typeof migrationInput>;

export interface MigrationReport {
  fingerprint: string;
  batch?: { completed: boolean; nextPart: number | null };
  ownership?: {
    missing: { email: string; count: number; target?: string }[];
    eligible: { email: string; name: string }[];
  };
  rows: {
    key: string;
    label: string;
    status: "Create" | "Reuse contact" | "Previously imported" | "Skipped" | "Review" | "Suppressed" | "Undone";
    detail: string;
    targetId?: string;
    correction?: boolean;
    matches?: { id: string; label: string }[];
    campaignDuplicates?: { id: string; name: string; campaignName: string | null; canEnroll: boolean }[];
    campaignEnrollment?: { owner: string | null; firstContactDueAt: string };
  }[];
}

export const migrationRecoveryInput = z.uuid().optional();
export const undoMigrationInput = z.object({
  type: z.literal("undoMigration"),
  importId: z.uuid(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  confirmed: z.literal(true),
});
export type UndoMigrationInput = z.infer<typeof undoMigrationInput>;

export interface MigrationImportReceipt {
  id: string;
  origin: string;
  importedAt: string;
  importedBy: string;
  part: number | null;
  partCount: number | null;
  recordCount: number;
  correctedCount: number;
}

export interface MigrationRecoveryReview {
  imports: MigrationImportReceipt[];
  preview?: {
    receipt: MigrationImportReceipt;
    fingerprint: string;
    rows: { key: string; label: string; result: "Candidate" | "Keep" | "No change" | "Removed"; reason: string; correction?: boolean; canOpen?: boolean;
      removal?: { at: string; by: string } }[];
  };
}

const aliases: Partial<Record<MigrationColumn, string[]>> = {
  type: ["record type", "object"], externalId: ["id", "record id", "source id"], parentId: ["parent", "related to id", "related id", "contact id"],
  name: ["full name"], ownerEmail: ["owner email", "assigned to"], createdAt: ["created date", "created"],
  dueAt: ["due date", "due"], completedAt: ["completed date"], text: ["body", "subject", "description"], zip: ["postal code", "zipcode"],
};
const normalizeHeader = (value: string) => value.toLowerCase().replace(/[\s_-]/g, "");
const escapedCell = /^(?:'|\s*[=+\-@])/;

export function migrationCsv(rows: MigrationRow[], origin: string, batch: MigrationBatch) {
  const cell = (value: string) => `"${(escapedCell.test(value) ? "'" + value : value).replaceAll('"', '""')}"`;
  const metadata = [batch.snapshot, String(batch.part), String(batch.partCount)].map(cell);
  return [[...migrationColumns, "orbitSource", ...batchHeaders, historyHeader, callbackHistoryHeader].join(","), ...rows.map((row) => {
    const fields = row as Partial<Record<MigrationColumn, string>>;
    const history = row.type === "Task" && row.followUpHistory ? JSON.stringify(row.followUpHistory) : "";
    const callbacks = row.type === "Callback" ? JSON.stringify(row.callbackHistory) : "";
    return [...migrationColumns.map((column) => cell(fields[column] ?? "")), cell(origin), ...metadata, cell(history), cell(callbacks)].join(",");
  })].join("\r\n");
}

export function migrationFile(input: string) {
  const [header, ...rows] = readCsv(input);
  if (!header || !rows.length || rows.length > migrationBatchRowLimit || rows.some((row) => row.length > header.length)) {
    throw new Error("Include a header and 1 to 100 records with the same column layout.");
  }
  const mapping: Partial<Record<MigrationColumn, number>> = {};
  for (const column of migrationColumns) {
    const names = [column, ...aliases[column] ?? []].map(normalizeHeader);
    const index = header.findIndex((value) => names.includes(normalizeHeader(value)));
    if (index >= 0) mapping[column] = index;
  }
  const sourceIndex = header.indexOf("orbitSource");
  const source = rows[0][sourceIndex];
  const orbitSource = orbitSourcePattern.test(source ?? "") && rows.every((row) => row[sourceIndex] === source) ? source : undefined;
  const indexes = batchHeaders.map((column) => header.indexOf(column));
  let batch: MigrationBatch | undefined;
  if (indexes.some((index) => index >= 0)) {
    const [snapshot, part, partCount] = indexes.map((index) => rows[0][index]);
    const parsed = migrationBatch.safeParse({ origin: orbitSource, snapshot, part: Number(part), partCount: Number(partCount) });
    if (!parsed.success || rows.some((row) => indexes.some((index) => row[index] !== rows[0][index]))) {
      throw new Error("Use the original Orbit batch file with matching batch details on every record.");
    }
    batch = parsed.data;
  }
  const historyIndex = header.indexOf(historyHeader);
  if (historyIndex >= 0 && (!batch || header.lastIndexOf(historyHeader) !== historyIndex)) {
    throw new Error("Use the original Orbit batch file to restore follow-up history.");
  }
  const callbackHistoryIndex = header.indexOf(callbackHistoryHeader);
  if (callbackHistoryIndex >= 0 && (!batch || header.lastIndexOf(callbackHistoryHeader) !== callbackHistoryIndex)) {
    throw new Error("Use the original Orbit batch file to restore campaign callback history.");
  }
  return { header, rows, mapping, orbitSource, batch, historyIndex, callbackHistoryIndex };
}

export function mappedMigrationRows(file: ReturnType<typeof migrationFile>, mapping: ReturnType<typeof migrationFile>["mapping"]) {
  if (requiredMigrationColumns.some((column) => mapping[column] === undefined)) throw new Error("Map the record type and external ID columns.");
  const usedColumns = Object.values(mapping);
  if (new Set(usedColumns).size !== usedColumns.length) throw new Error("Map each CSV column to one field.");
  return file.rows.map((row, index) => {
    const value = (column: MigrationColumn) => {
      const cell = row[mapping[column] ?? -1] ?? "";
      return file.orbitSource && cell.startsWith("'") && escapedCell.test(cell.slice(1)) ? cell.slice(1) : cell;
    };
    const pick = (values: readonly string[], column: MigrationColumn, fallback: string) =>
      values.find((item) => item.toLowerCase() === value(column).toLowerCase()) ?? (value(column) || fallback);
    const type = pick(migrationTypes, "type", "");
    const actor = value("leadEventActor");
    if ((type === "Callback" || actor) && !file.batch) throw new Error(`CSV record ${index + 1} requires a numbered Orbit batch.`);
    if (actor && type !== "Note") throw new Error(`CSV record ${index + 1} has an event actor outside a note.`);
    let history: unknown;
    const serialized = row[file.historyIndex];
    if (serialized) {
      try { history = JSON.parse(serialized); }
      catch { throw new Error(`CSV record ${index + 1} has unreadable follow-up history.`); }
      if (type !== "Task") throw new Error(`CSV record ${index + 1} has history outside a task.`);
    }
    let callbacks: unknown;
    const serializedCallbacks = row[file.callbackHistoryIndex];
    if (serializedCallbacks) {
      if (type !== "Callback") throw new Error(`CSV record ${index + 1} has campaign callback history outside a callback record.`);
      try { callbacks = JSON.parse(serializedCallbacks); }
      catch { throw new Error(`CSV record ${index + 1} has unreadable campaign callback history.`); }
    }
    const parsed = migrationRow.safeParse({
      ...Object.fromEntries(migrationColumns.map((column) => [column, value(column)])),
      type, role: pick(contactRoles, "role", "Borrower"),
      purpose: pick(["Purchase", "Refinance"], "purpose", "Purchase"), source: pick(leadSources, "source", "Imported CRM"),
      taskPurpose: value("taskPurpose") ? pick(followUpPurposes, "taskPurpose", "") : undefined,
      ...Object.fromEntries((["parentType", "realtorId", "firstContactAt", "heldAt", "holdReason", "revisitDate",
        "activityKind", "activityOutcome", "leadEventKind", "leadOutcome"] as const).map((column) => [column, value(column) || undefined])),
      createdAt: value("createdAt") || undefined,
      ownerEmail: value("ownerEmail").toLowerCase(),
      leadEventActor: actor || undefined,
      ...(serialized ? { followUpHistory: history } : {}),
      ...(serializedCallbacks ? { callbackHistory: callbacks } : {}),
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new Error(`CSV record ${index + 1} · ${issue.path.join(".")}: ${issue.message}`);
    }
    return parsed.data;
  });
}

export const migrationExample = [
  "record type,record id,parent id,full name,email,phone,role,owner email,purpose,source,postal code,created date,due date,completed date,description",
  "Contact,C-101,,Casey Example,casey@example.test,,Borrower,,,,,,,,",
  "Lead,L-101,C-101,Casey Example,casey@example.test,,,,Purchase,Imported CRM,48304,2026-10-01,2026-10-02,,",
  "Note,N-101,L-101,,,,,,,,,2026-10-01,,,Fictional buyer asked for a purchase quote.",
  "Task,T-101,L-101,,,,,,,,,,2026-10-03,,Follow up on the purchase timeline",
].join("\r\n");
