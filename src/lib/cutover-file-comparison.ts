import { createHash } from "node:crypto";
import { z } from "zod";
import { cutoverFileConditionLimit, cutoverFileDocument, cutoverFileDocumentLimit, cutoverFileLenderFields, cutoverFileLenderKey,
  cutoverFileLenderLimit, cutoverFileSourceMaxBytes, cutoverFileText, type CutoverFileComparison, type CutoverFileItem, type CutoverFileSource,
  type CutoverFundingInventory } from "./cutover-file-model";
import { readFundingInventory } from "./cutover-funding-comparison";
import type { Store } from "./store";

type DocumentEvidence = z.infer<typeof cutoverFileDocument>;
type SourceLenderFile = NonNullable<CutoverFileSource["lenderFiles"]>[number];
type LenderFile = Pick<SourceLenderFile, "lender" | "reference" | "status">;
type LenderCondition = SourceLenderFile["conditions"][number];
type Entry = { key: string; label: string; summary: string; state: string; proof?: unknown };
type ComparisonRow = CutoverFileComparison["rows"][number];

const identifier = z.string().min(1).max(240);
const storedTime = z.iso.datetime({ offset: true });
const storedDocument = cutoverFileDocument.extend({
  id: identifier, revision: z.int().nonnegative(), deadlineRevision: z.int().nonnegative(),
  submissionId: identifier.nullable(), conditionId: identifier.nullable(),
  receipt: z.string().min(1).max(240).nullable(), deliveryRevision: z.int().nonnegative().nullable(),
  mockClearedAt: storedTime.nullable(),
});
const storedLenderFile = z.object({ ...cutoverFileLenderFields, id: identifier, conditions: z.string().max(cutoverFileSourceMaxBytes) });
const storedCondition = z.object({
  id: identifier, category: z.string().trim().min(1).max(160), description: z.string().trim().min(1).max(500),
  uploaded: z.boolean(), satisfiedAt: storedTime.nullable(), mockReopenedAt: storedTime.optional(),
  manual: z.object({
    revision: z.int().nonnegative(), reopenedAt: storedTime.optional(), confirmedDelivery: z.string().min(1).max(160).nullable(),
    deliveries: z.array(z.object({ documentRevision: z.int().nonnegative(), reference: z.string().min(1).max(160), at: storedTime }))
      .max(cutoverFileConditionLimit),
  }).optional(),
});
const storedConditions = z.array(storedCondition).max(cutoverFileConditionLimit);

function documentEntry(document: DocumentEvidence, proof?: unknown): Entry {
  const { kind, instructions, status, dueOn } = document;
  return { key: JSON.stringify([cutoverFileText(kind), cutoverFileText(instructions)]), label: [kind, instructions].filter(Boolean).join(" · "),
    summary: dueOn ? `${status} · Due ${dueOn}` : `${status} · No due date`, state: JSON.stringify([status, dueOn]), proof };
}

function lenderEntry(file: LenderFile, proof?: unknown): Entry {
  return { key: cutoverFileLenderKey(file.lender, file.reference), label: `${file.lender} · ${file.reference}`,
    summary: file.status, state: cutoverFileText(file.status), proof };
}

function conditionEntry(file: LenderFile, condition: LenderCondition, proof?: unknown): Entry {
  const fileKey = cutoverFileLenderKey(file.lender, file.reference);
  const conditionKey = JSON.stringify([cutoverFileText(condition.category), cutoverFileText(condition.description)]);
  return { key: `${fileKey}/${conditionKey}`, label: `${file.lender} · ${file.reference} · ${condition.category} · ${condition.description}`,
    summary: condition.status, state: condition.status, proof };
}

function sourceLenderEntries(files: SourceLenderFile[]) {
  return files.flatMap((file) => [lenderEntry(file), ...file.conditions.map((condition) => conditionEntry(file, condition))]);
}

function readDocuments(db: Store, loanId: string, linkedOnly = false) {
  const rows = db.prepare(`SELECT request.id, request.kind, request.instructions, request.status, request.dueOn, request.revision,
    request.deadlineRevision, request.submissionId, request.conditionId, delivery.receipt, delivery.documentRevision AS deliveryRevision,
    delivery.mockClearedAt
    FROM document_requests request
    LEFT JOIN uwm_document_deliveries delivery ON delivery.requestId = request.id AND request.status = 'Accepted'
      AND (delivery.documentRevision IS NULL OR delivery.documentRevision = request.revision)
    WHERE request.loanId = ? ${linkedOnly ? "AND request.submissionId IS NOT NULL" : ""}
    ORDER BY request.requestedAt, request.id LIMIT ?`).all(loanId, cutoverFileDocumentLimit + 1);
  const parsed = storedDocument.array().max(cutoverFileDocumentLimit).safeParse(rows);
  return parsed.success ? parsed.data : null;
}

function destinationDocumentEntries(db: Store, loanId: string) {
  return readDocuments(db, loanId)?.map(({ id, revision, deadlineRevision, submissionId, conditionId, receipt, deliveryRevision, mockClearedAt, ...document }) =>
    documentEntry(document, [id, revision, deadlineRevision, submissionId, conditionId, receipt, deliveryRevision, mockClearedAt])) ?? null;
}

function conditionState(condition: z.infer<typeof storedCondition>, request?: z.infer<typeof storedDocument>) {
  const accepted = request?.status === "Accepted";
  const { manual } = condition;
  const currentManualDeliveries = accepted && manual && condition.uploaded ? manual.deliveries.filter(({ documentRevision, at }) =>
    documentRevision === request.revision && (!manual.reopenedAt || Date.parse(at) >= Date.parse(manual.reopenedAt))) : [];
  const delivered = manual ? currentManualDeliveries.length > 0 : Boolean(condition.uploaded || request?.receipt);
  const status = condition.satisfiedAt ? "Cleared" : delivered ? "Delivered" : "Open";
  const proof = [condition.id, condition.satisfiedAt, condition.mockReopenedAt ?? null, manual?.revision ?? null, manual?.reopenedAt ?? null,
    manual?.confirmedDelivery ?? null, currentManualDeliveries, request ? [request.id, request.status, request.revision, request.receipt,
      request.deliveryRevision, request.mockClearedAt] : null];
  return { status, proof } as const;
}

function parseConditions(value: string) {
  try {
    const result = storedConditions.safeParse(JSON.parse(value));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

function destinationLenderEntries(db: Store, loanId: string) {
  const fileRows = db.prepare(`SELECT id, lender, externalId AS reference, status, substr(conditions, 1, ?) AS conditions
    FROM submissions WHERE loanId = ? LIMIT ?`).all(cutoverFileSourceMaxBytes + 1, loanId, cutoverFileLenderLimit + 1);
  const files = storedLenderFile.array().max(cutoverFileLenderLimit).safeParse(fileRows);
  if (!files.success || files.data.reduce((bytes, file) => bytes + file.conditions.length, 0) > cutoverFileSourceMaxBytes) return null;
  if (!files.data.length) return [];
  const docs = readDocuments(db, loanId, true);
  if (!docs) return null;
  const linked = new Map(docs.map((request) => [JSON.stringify([request.submissionId, request.conditionId]), request]));
  const entries: Entry[] = [];
  const fileKeys = new Set<string>();
  let conditionsSeen = 0;
  for (const file of files.data) {
    const fileEntry = lenderEntry(file, file.id);
    const conditions = parseConditions(file.conditions);
    if (!conditions || conditionsSeen + conditions.length > cutoverFileConditionLimit || fileKeys.has(fileEntry.key) ||
      new Set(conditions.map(({ id }) => id)).size !== conditions.length) return null;
    fileKeys.add(fileEntry.key);
    conditionsSeen += conditions.length;
    entries.push(fileEntry);
    for (const condition of conditions) {
      const request = linked.get(JSON.stringify([file.id, condition.id]));
      const { status, proof } = conditionState(condition, request);
      entries.push(conditionEntry(file, { ...condition, status }, proof));
    }
  }
  return entries;
}

function principalLabel(cents: number) {
  const remainder = cents % 100;
  return `$${((cents - remainder) / 100).toLocaleString("en-US")}.${String(remainder).padStart(2, "0")}`;
}

function fundingEntries(funding: CutoverFundingInventory, proof?: Partial<Record<keyof CutoverFundingInventory, unknown>>): Entry[] {
  const { closingDate, fundingDate, fundedPrincipalCents } = funding;
  const values = [
    ["closingDate", "Recorded closing date", closingDate],
    ["fundingDate", "Recorded funding date", fundingDate],
    ["fundedPrincipalCents", "Funded principal (Orbit loan amount)", fundedPrincipalCents === null ? null : principalLabel(fundedPrincipalCents)],
    ...([["borrowerFollowUp", "Borrower follow-up"], ["realtorFollowUp", "Realtor follow-up"], ["borrowerCallback", "Borrower callback or next follow-up"]] as const)
      .map(([key, label]) => {
        const followUp = funding[key];
        return [key, label, followUp ? `${followUp.status} · Due ${followUp.dueOn}` : null] as const;
      }),
  ] as const;
  return values.flatMap(([key, label, state], index) => state === null ? [] : [{ key: `${index}:${key}`, label, summary: state, state, proof: proof?.[key] }]);
}

function compareEntries(source: Entry[], destination: Entry[]) {
  const groups = new Map<string, { source: Entry[]; destination: Entry[] }>();
  for (const [side, entries] of [["source", source], ["destination", destination]] as const) {
    for (const entry of entries) {
      const group = groups.get(entry.key) ?? { source: [], destination: [] };
      group[side].push(entry);
      groups.set(entry.key, group);
    }
  }
  const rows: ComparisonRow[] = [];
  const add = (status: ComparisonRow["status"], original?: Entry, current?: Entry) => rows.push({
    label: original?.label ?? current!.label, source: original?.summary ?? null, destination: current?.summary ?? null, status,
  });
  const order = (left: Entry, right: Entry) => left.state.localeCompare(right.state) || left.label.localeCompare(right.label);
  for (const key of [...groups.keys()].sort()) {
    const group = groups.get(key)!;
    const remaining = group.destination.sort(order);
    const unmatched: Entry[] = [];
    // Pair equivalent entries first so duplicate checklist items retain their multiplicity.
    for (const original of group.source.sort(order)) {
      const index = remaining.findIndex(({ state }) => state === original.state);
      if (index < 0) unmatched.push(original);
      else add("Matched", original, remaining.splice(index, 1)[0]);
    }
    for (let index = 0; index < Math.max(unmatched.length, remaining.length); index++) {
      add(unmatched[index] ? remaining[index] ? "Changed" : "Missing" : "Added", unmatched[index], remaining[index]);
    }
  }
  return rows;
}

function fileComparison(loanId: string, item: CutoverFileItem, version: number, original: Entry[], destination: Entry[], cycle?: number): CutoverFileComparison {
  const evidence = (entries: Entry[]) => entries.map((entry) => JSON.stringify(entry)).sort();
  const facts = [version, loanId, item, evidence(original), evidence(destination)];
  if (cycle !== undefined) facts.push(cycle);
  const fingerprint = createHash("sha256").update(JSON.stringify(facts)).digest("hex");
  return { fingerprint, rows: compareEntries(original, destination) };
}

export function readFileComparison(db: Store, loanId: string, item: CutoverFileItem, source: CutoverFileSource): CutoverFileComparison | null {
  if (item === "funding") {
    if (!source.funding) return null;
    const current = readFundingInventory(db, loanId);
    return current ? fileComparison(loanId, item, source.version, fundingEntries(source.funding), fundingEntries(current.inventory, current.proof), current.cycle) : null;
  }
  const original = item === "documents" ? source.documents?.map((document) => documentEntry(document)) :
    source.lenderFiles && sourceLenderEntries(source.lenderFiles);
  if (!original) return null;
  const destination = item === "documents" ? destinationDocumentEntries(db, loanId) : destinationLenderEntries(db, loanId);
  return destination ? fileComparison(loanId, item, source.version, original, destination) : null;
}
