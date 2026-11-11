import { createHash } from "node:crypto";
import { z } from "zod";
import { cutoverFileSource, cutoverFileConditionLimit, cutoverFileDocument, cutoverFileDocumentLimit, cutoverFileLenderFields, cutoverFileLenderKey,
  cutoverFileLenderLimit, cutoverFileSourceMaxBytes, cutoverFileText, cutoverHistoryLimit, type CutoverDeliveryReceipt, type CutoverFileComparison,
  type CutoverFileItem, type CutoverFileSource, type CutoverFundingInventory } from "./cutover-file-model";
import { readFundingInventory } from "./cutover-funding-comparison";
import { compareRevisionEvidence, conditionDeliveryEvidence, documentRevisionEvidence, readAcceptanceHistory, readMockDeliveryHistory,
  type RevisionEvidence } from "./cutover-revision-evidence";
import type { Store } from "./store";

type DocumentEvidence = z.infer<typeof cutoverFileDocument>;
type SourceLenderFile = NonNullable<CutoverFileSource["lenderFiles"]>[number];
type LenderFile = Pick<SourceLenderFile, "lender" | "reference" | "status">;
type LenderCondition = SourceLenderFile["conditions"][number];
type Entry = { key: string; label: string; summary: string; state: string; proof?: unknown; evidence?: RevisionEvidence };
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
  const { kind, instructions, status, dueOn, evidence } = document;
  return { key: JSON.stringify([cutoverFileText(kind), cutoverFileText(instructions)]), label: [kind, instructions].filter(Boolean).join(" · "),
    summary: dueOn ? `${status} · Due ${dueOn}` : `${status} · No due date`, state: JSON.stringify([status, dueOn]), proof,
    evidence: evidence && documentRevisionEvidence(evidence) };
}

function lenderEntry(file: LenderFile, proof?: unknown): Entry {
  return { key: cutoverFileLenderKey(file.lender, file.reference), label: `${file.lender} · ${file.reference}`,
    summary: file.status, state: cutoverFileText(file.status), proof };
}

function conditionEntry(file: LenderFile, condition: LenderCondition, proof?: unknown): Entry {
  const fileKey = cutoverFileLenderKey(file.lender, file.reference);
  const conditionKey = JSON.stringify([cutoverFileText(condition.category), cutoverFileText(condition.description)]);
  return { key: `${fileKey}/${conditionKey}`, label: `${file.lender} · ${file.reference} · ${condition.category} · ${condition.description}`,
    summary: condition.status, state: condition.status, proof, evidence: condition.evidence && conditionDeliveryEvidence(condition.evidence) };
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

function documentInventory(db: Store, loanId: string, withVersions: boolean, withAcceptances: boolean) {
  const history = withAcceptances ? readAcceptanceHistory(db, loanId) : undefined;
  if (history === null) return null;
  return readDocuments(db, loanId)?.map(({ id, revision, deadlineRevision, submissionId, conditionId, receipt, deliveryRevision, mockClearedAt, ...document }) => ({
    document: { ...document, evidence: withVersions ? { revision, acceptedRevisions: history ? history.get(id) ?? [] : undefined } : undefined },
    proof: [id, revision, deadlineRevision, submissionId, conditionId, receipt, deliveryRevision, mockClearedAt],
  })) ?? null;
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
  return { status, proof, currentManualDeliveries } as const;
}

function parseConditions(value: string) {
  try {
    const result = storedConditions.safeParse(JSON.parse(value));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

function lenderInventory(db: Store, loanId: string, withHistory: boolean, withReceipts: boolean) {
  const fileRows = db.prepare(`SELECT id, lender, externalId AS reference, status, substr(conditions, 1, ?) AS conditions
    FROM submissions WHERE loanId = ? ORDER BY id LIMIT ?`).all(cutoverFileSourceMaxBytes + 1, loanId, cutoverFileLenderLimit + 1);
  const files = storedLenderFile.array().max(cutoverFileLenderLimit).safeParse(fileRows);
  if (!files.success || files.data.reduce((bytes, file) => bytes + file.conditions.length, 0) > cutoverFileSourceMaxBytes) return null;
  if (!files.data.length) return [];
  const docs = readDocuments(db, loanId, true);
  if (!docs) return null;
  const mockHistory = withReceipts ? readMockDeliveryHistory(db, loanId) : undefined;
  if (mockHistory === null) return null;
  const linked = new Map(docs.map((request) => [JSON.stringify([request.submissionId, request.conditionId]), request]));
  const inventory: { file: LenderFile; id: string; conditions: { condition: LenderCondition; proof: unknown }[] }[] = [];
  const fileKeys = new Set<string>();
  let conditionsSeen = 0;
  let receiptsSeen = 0;
  for (const { id, conditions: raw, ...file } of files.data) {
    const fileKey = cutoverFileLenderKey(file.lender, file.reference);
    const conditions = parseConditions(raw);
    if (!conditions || conditionsSeen + conditions.length > cutoverFileConditionLimit || fileKeys.has(fileKey) ||
      new Set(conditions.map(({ id }) => id)).size !== conditions.length) return null;
    fileKeys.add(fileKey);
    conditionsSeen += conditions.length;
    const items: (typeof inventory)[number]["conditions"] = [];
    for (const condition of conditions) {
      const request = linked.get(JSON.stringify([id, condition.id]));
      const { status, proof, currentManualDeliveries } = conditionState(condition, request);
      let evidence: LenderCondition["evidence"];
      if (withHistory) {
        const receipts: CutoverDeliveryReceipt[] = !withReceipts ? [] : condition.manual ? condition.manual.deliveries.map((delivery) => ({
          reference: delivery.reference, documentRevision: delivery.documentRevision,
          state: currentManualDeliveries.includes(delivery) ? "Current" : "Prior",
        })) : (request && mockHistory?.get(request.id)) ?? [];
        receiptsSeen += receipts.length;
        if (receiptsSeen > cutoverHistoryLimit) return null;
        evidence = { receipts: withReceipts ? receipts : undefined,
          clearance: condition.satisfiedAt ? { at: condition.satisfiedAt, reference: condition.manual?.confirmedDelivery ?? null } : null };
      }
      items.push({ condition: { category: condition.category, description: condition.description, status, evidence }, proof });
    }
    inventory.push({ file, id, conditions: items });
  }
  return inventory;
}

export function readCutoverSourceInventory(db: Store, loanId: string): CutoverFileSource | null {
  const documents = documentInventory(db, loanId, true, true);
  const lenders = lenderInventory(db, loanId, true, true);
  const funding = readFundingInventory(db, loanId);
  if (!documents || !lenders || !funding) return null;
  const parsed = cutoverFileSource.safeParse({
    version: 1, documents: documents.map(row => row.document), funding: funding.inventory,
    lenderFiles: lenders.map(({ file, conditions }) => ({ ...file, conditions: conditions.map(row => row.condition) })),
  });
  return parsed.success ? parsed.data : null;
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
  const add = (status: ComparisonRow["status"], original?: Entry, current?: Entry) => {
    const evidence = original?.evidence && compareRevisionEvidence(original.evidence, current?.evidence);
    if (evidence?.some((row) => row.status === "Missing")) status = "Missing";
    else if (status === "Matched" && evidence?.some((row) => row.status !== "Matched")) status = "Changed";
    rows.push({ label: original?.label ?? current!.label, source: original?.summary ?? null, destination: current?.summary ?? null, status,
      ...(evidence?.length ? { evidence } : {}) });
  };
  const order = (left: Entry, right: Entry) => left.state.localeCompare(right.state) || left.label.localeCompare(right.label) ||
    JSON.stringify(left.evidence ?? null).localeCompare(JSON.stringify(right.evidence ?? null));
  for (const key of [...groups.keys()].sort()) {
    const group = groups.get(key)!;
    const remaining = group.destination.sort(order);
    const unmatched: Entry[] = [];
    // Pair equivalent entries first so duplicate checklist items retain their multiplicity.
    // Specific evidence gets first pick when two source rows share an identity.
    for (const original of group.source.sort((left, right) => Number(Boolean(right.evidence)) - Number(Boolean(left.evidence)) || order(left, right))) {
      const index = remaining.findIndex(({ state, evidence }) => state === original.state &&
        (!original.evidence || compareRevisionEvidence(original.evidence, evidence).every((row) => row.status === "Matched")));
      if (index < 0) unmatched.push(original);
      else add("Matched", original, remaining.splice(index, 1)[0]);
    }
    for (let index = 0; index < Math.max(unmatched.length, remaining.length); index++) {
      const [original, current] = [unmatched[index], remaining[index]];
      add(original ? current ? original.state === current.state ? "Matched" : "Changed" : "Missing" : "Added", original, current);
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
  const withEvidence = original.some(({ evidence }) => evidence !== undefined);
  const destination = item === "documents" ?
    documentInventory(db, loanId, withEvidence, original.some(({ evidence }) => evidence?.acceptances !== undefined))
      ?.map(({ document, proof }) => documentEntry(document, proof)) :
    lenderInventory(db, loanId, withEvidence, original.some(({ evidence }) => evidence?.receipts !== undefined))
      ?.flatMap(({ file, id, conditions }) => [lenderEntry(file, id),
        ...conditions.map(({ condition, proof }) => conditionEntry(file, condition, proof))]);
  return destination ? fileComparison(loanId, item, source.version, original, destination) : null;
}
