import { readApplicationComparison } from "./cutover-application-comparison";
import type { CutoverApplicationComparison } from "./cutover-application-model";
import { readCutoverCallbackEvidence } from "./cutover-callback-evidence";
import { readFileComparison } from "./cutover-file-comparison";
import { applyCutoverOpenWork, planCutoverOpenWork } from "./cutover-open-work";
import { cutoverFileComparisonUnavailable, cutoverFileSource, cutoverFileSourceSection, type CutoverFileItem, type CutoverFileSource } from "./cutover-file-model";
import { cutoverReviewReference, renderCutoverHandoff } from "./cutover-handoff";
import { cutoverApplicationQuery, cutoverCallbackItem, cutoverFileInventoryInput, cutoverFileLookupQuery, cutoverHandoffQuery, cutoverItems,
  cutoverReadinessLimit, cutoverReviewInput, cutoverSourceInput, cutoverUnavailable, type CutoverApplicationQuery, type CutoverCallbackEvidence,
  type CutoverDraft, type CutoverDraftItem, type CutoverDraftReadiness, type CutoverFileInventory, type CutoverFileLookup, type CutoverHandoff, type CutoverReadiness, type CutoverReview,
  type MigrationCutover, type RestoreCutoverWorkInput } from "./migration-cutover-model";
import type { WorkspaceStaff } from "./staff-store";
import type { SqlValue, Store } from "./store";
import { accessEvent } from "./workspace-access";

const draftPageSize = 20;
const changedSource = "The migration source changed. Refresh to review the current export.";
const unlinkedDraft = "This MISMO draft is no longer linked to this migration source.";
const missingComparison = "The MISMO source or current 1003 draft is unavailable for comparison.";
const draftItems = Object.keys(cutoverItems) as CutoverDraftItem[];
const draftFields = "loan.id, contact.name, loan.address, loan.purpose, loan.amount";
const draftRecords = `FROM contacts contact JOIN loans loan ON loan.contactId = contact.id JOIN mismo_rehearsals draft ON draft.loanId = loan.id`;
const linkedDrafts = `${draftRecords} WHERE contact.id IN (
    SELECT targetId FROM migration_records WHERE origin = ? AND recordKey GLOB 'Contact:*'
  )`;
const exactLinkedDraft = `${draftRecords} WHERE loan.id = ? AND EXISTS (
  SELECT 1 FROM migration_records INDEXED BY migration_records_by_target
  WHERE targetId = contact.id AND origin = ? AND recordKey GLOB 'Contact:*'
)`;

function canReview(staff: WorkspaceStaff | null, brokerageId: string) {
  return !!staff && staff.brokerage.id === brokerageId && staff.brokerage.role === "Admin" && Boolean(staff.brokerage.pilot);
}

function basisForSource(db: Store, origin: string) {
  const snapshot = db.prepare("SELECT snapshot FROM migration_batches WHERE origin = ? ORDER BY rowid DESC LIMIT 1").get(origin)?.snapshot;
  if (typeof snapshot === "string") return { basis: snapshot, numbered: true };
  const receipt = db.prepare("SELECT id FROM migration_imports WHERE origin = ? ORDER BY importedAt DESC, id DESC LIMIT 1").get(origin)?.id;
  return typeof receipt === "string" ? { basis: receipt, numbered: false } : null;
}

function hasLinkedDraft(db: Store, origin: string, loanId: string) {
  return Boolean(db.prepare(`SELECT 1 ${exactLinkedDraft}`).get(loanId, origin));
}

function fileScopeError(db: Store, { origin, basis, loanId }: CutoverApplicationQuery) {
  if (basisForSource(db, origin)?.basis !== basis) return changedSource;
  return hasLinkedDraft(db, origin, loanId) ? null : unlinkedDraft;
}

export function readCutoverApplicationComparison(db: Store, staff: WorkspaceStaff | null, brokerageId: string,
  input: unknown): CutoverApplicationComparison | { error: string } {
  if (!canReview(staff, brokerageId)) return { error: cutoverUnavailable };
  const parsed = cutoverApplicationQuery.safeParse(input);
  if (!parsed.success) return { error: "Choose a valid migration source and MISMO draft." };
  return db.transaction(() => {
    const error = fileScopeError(db, parsed.data);
    return error ? { error } : readApplicationComparison(db, parsed.data.loanId) ?? { error: missingComparison };
  });
}

function fileSourceRecord(db: Store, { origin, basis, loanId }: CutoverApplicationQuery) {
  return db.prepare("SELECT source, revision FROM migration_cutover_file_sources WHERE loanId = ? AND origin = ? AND basis = ?")
    .get(loanId, origin, basis);
}

function readFileSource(value: SqlValue | undefined): CutoverFileSource | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = cutoverFileSource.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function readCutoverFileInventory(db: Store, staff: WorkspaceStaff | null, brokerageId: string,
  input: unknown): CutoverFileInventory | { error: string } {
  if (!canReview(staff, brokerageId)) return { error: cutoverUnavailable };
  const parsed = cutoverApplicationQuery.safeParse(input);
  if (!parsed.success) return { error: "Choose a valid migration source and MISMO draft." };
  return db.transaction(() => {
    const error = fileScopeError(db, parsed.data);
    if (error) return { error };
    const record = fileSourceRecord(db, parsed.data);
    const source = readFileSource(record?.source);
    const { loanId } = parsed.data;
    const revision = Number(record?.revision ?? 0);
    const documents = source ? readFileComparison(db, loanId, "documents", source) : null;
    const lender = source ? readFileComparison(db, loanId, "lender", source) : null;
    return { revision, source, documents, lender, funding: source ? readFileComparison(db, loanId, "funding", source) : null,
      openWork: source ? planCutoverOpenWork(db, parsed.data, source, revision, documents, lender)?.preview ?? null : null };
  });
}

export function restoreCutoverWork(db: Store, staff: WorkspaceStaff | null, input: RestoreCutoverWorkInput, now: string) {
  if (!staff?.brokerage.pilot || staff.brokerage.role !== "Admin") return { error: cutoverUnavailable };
  const { origin, basis, loanId, preview } = input;
  const scope = { origin, basis, loanId };
  const error = fileScopeError(db, scope);
  if (error) return { error };
  const record = fileSourceRecord(db, scope);
  const source = readFileSource(record?.source);
  const plan = source && planCutoverOpenWork(db, scope, source, Number(record?.revision ?? 0),
    readFileComparison(db, loanId, "documents", source), readFileComparison(db, loanId, "lender", source));
  if (!plan || plan.preview.fingerprint !== preview) return { error: "The open work preview changed. Refresh the cutover checklist and review it again." };
  if (!plan.preview.documents && !plan.preview.conditions) return { error: "This file has no eligible open work to restore." };
  return applyCutoverOpenWork(db, loanId, plan, staff, now);
}

export function saveCutoverFileInventory(db: Store, staff: WorkspaceStaff | null, brokerageId: string, input: unknown, now = new Date().toISOString()) {
  if (!canReview(staff, brokerageId)) return { error: cutoverUnavailable };
  const parsed = cutoverFileInventoryInput.safeParse(input);
  if (!parsed.success) return { error: "Provide a valid fictional source inventory for this MISMO draft." };
  const { origin, basis, loanId, revision, source } = parsed.data;
  return db.transaction(() => {
    const error = fileScopeError(db, parsed.data);
    if (error) return { error };
    const prior = fileSourceRecord(db, parsed.data);
    const savedRevision = Number(prior?.revision ?? 0);
    const serialized = JSON.stringify(source);
    if (prior?.source === serialized && (revision === savedRevision || revision === savedRevision - 1)) {
      return { message: "This source inventory is up to date." };
    }
    if (revision !== savedRevision) return { error: "The source inventory changed. Refresh it before saving." };
    db.prepare(`INSERT INTO migration_cutover_file_sources (loanId, origin, basis, source, revision) VALUES (?, ?, ?, ?, 1)
      ON CONFLICT (loanId, origin, basis) DO UPDATE SET source = excluded.source, revision = revision + 1`)
      .run(loanId, origin, basis, serialized);
    accessEvent(db, staff, "Saved migration file source inventory", [origin, loanId].join(" · "), now);
    return { message: "Source inventory saved." };
  });
}

function fileReviewItem(item: CutoverReview["item"]): item is CutoverFileItem {
  return Object.hasOwn(cutoverFileSourceSection, item);
}

type StoredDraftReview = CutoverReview & { loanId: string; applicationFingerprint: string | null; fileFingerprint: string | null };
type DraftReviews = ReadonlyMap<CutoverDraftItem, StoredDraftReview>;
type CutoverScope = Pick<CutoverApplicationQuery, "origin" | "basis">;

function readDraftReviews(db: Store, { origin, basis }: CutoverScope, loanIds: string[]) {
  const rows = db.prepare(`SELECT loanId, item, decision, note, updatedBy, updatedAt, revision, applicationFingerprint, fileFingerprint
    FROM migration_cutover_loan_reviews WHERE loanId IN (SELECT value FROM json_each(?)) AND origin = ? AND basis = ?`)
    .all(JSON.stringify(loanIds), origin, basis) as unknown as StoredDraftReview[];
  const reviews = new Map<string, Map<CutoverDraftItem, StoredDraftReview>>();
  for (const review of rows) {
    if (review.item === cutoverCallbackItem) continue;
    const existing = reviews.get(review.loanId) ?? new Map<CutoverDraftItem, StoredDraftReview>();
    existing.set(review.item, review);
    reviews.set(review.loanId, existing);
  }
  return reviews;
}

function applicationEvidenceBlocker(comparison: CutoverApplicationComparison) {
  const missingFields = comparison.rows.some(({ status }) => status === "Missing in draft");
  const missingBorrowers = comparison.missingExtraBorrowers > 0;
  if (missingFields && missingBorrowers) return "Resolve missing 1003 fields and additional borrowers before sign-off.";
  if (missingFields) return "Resolve missing 1003 fields before sign-off.";
  return missingBorrowers ? "Add the missing additional borrowers before sign-off." : null;
}

function draftReadiness(db: Store, scope: CutoverApplicationQuery, reviews?: DraftReviews,
  summaryOnly = false): CutoverDraftReadiness {
  if (summaryOnly && draftItems.some((item) => {
    const review = reviews?.get(item);
    return review?.decision !== "Out of scope" && (review?.decision !== "Reconciled" ||
      !(item === "application" ? review.applicationFingerprint : review.fileFingerprint));
  })) return { status: "Needs review", checks: [] };

  let source: CutoverFileSource | null | undefined;
  function check(item: CutoverDraftItem): CutoverDraftReadiness["checks"][number] {
    const review = reviews?.get(item);
    if (review?.decision === "Out of scope") return { item, state: "Out of scope" };
    const signed = review?.decision === "Reconciled";
    const unresolved = (reason: string) => ({ item, state: signed ? "Review again" as const : "Pending" as const, reason });
    let fingerprint: string;
    let priorFingerprint: string | null | undefined;
    if (item === "application") {
      const comparison = readApplicationComparison(db, scope.loanId);
      if (!comparison) return unresolved(missingComparison);
      const blocker = applicationEvidenceBlocker(comparison);
      if (blocker) return unresolved(blocker);
      fingerprint = comparison.fingerprint;
      priorFingerprint = review?.applicationFingerprint;
    } else {
      if (source === undefined) source = readFileSource(fileSourceRecord(db, scope)?.source);
      if (!source || source[cutoverFileSourceSection[item]] === undefined) return unresolved("Save the corresponding fictional source inventory.");
      const comparison = readFileComparison(db, scope.loanId, item, source);
      if (!comparison) return unresolved(cutoverFileComparisonUnavailable);
      if (comparison.rows.some(({ status }) => status === "Missing")) return unresolved("Resolve missing file inventory records or evidence before sign-off.");
      fingerprint = comparison.fingerprint;
      priorFingerprint = review?.fileFingerprint;
    }
    if (signed && fingerprint === priorFingerprint) return { item, state: "Reconciled" };
    return unresolved(signed ? "The comparison evidence changed. Review and sign off again." : "The evidence is ready for sign-off.");
  }

  const checks: CutoverDraftReadiness["checks"] = [];
  let status: CutoverDraftReadiness["status"] = "Ready";
  for (const item of draftItems) {
    const result = check(item);
    if (result.state === "Pending" || result.state === "Review again") {
      if (summaryOnly) return { status: "Needs review", checks: [] };
      status = "Needs review";
    } else if (result.state === "Out of scope" && status === "Ready") status = "Reviewed with exclusions";
    checks.push(result);
  }
  return { status, checks };
}

function readCutoverDraft(db: Store, scope: CutoverScope, row: Record<string, SqlValue>, stored?: DraftReviews): CutoverDraft {
  const { id, name, address, purpose, amount } = row;
  const loanId = String(id);
  const readiness = draftReadiness(db, { ...scope, loanId }, stored);
  const reviews = [...stored?.values() ?? []].map(({ item, decision, note, updatedAt, updatedBy, revision }) => {
    const review: CutoverReview = { item, decision, note, updatedAt, updatedBy, revision };
    if (decision === "Reconciled") {
      const current = readiness.checks.some((check) => check.item === item && check.state === "Reconciled");
      if (item === "application") review.applicationCurrent = current;
      else review.fileCurrent = current;
    }
    return review;
  });
  return { id: loanId, name: String(name), address: String(address), purpose: String(purpose), amount: Number(amount), reviews, readiness };
}

export function lookupCutoverFile(db: Store, staff: WorkspaceStaff | null, brokerageId: string, input: unknown): CutoverFileLookup {
  if (!canReview(staff, brokerageId)) return { error: cutoverUnavailable };
  const parsed = cutoverFileLookupQuery.safeParse(input);
  if (!parsed.success) return { error: "Enter a valid full Orbit file reference." };
  const { origin, basis, reference } = parsed.data;
  return db.transaction(() => {
    if (basisForSource(db, origin)?.basis !== basis) return { error: changedSource };
    const row = db.prepare(`SELECT ${draftFields} ${exactLinkedDraft}`).get(reference, origin);
    if (!row) return { error: "No linked MISMO draft matches that exact file reference." };
    const scope = { origin, basis };
    const stored = readDraftReviews(db, scope, [reference]).get(reference);
    return { draft: readCutoverDraft(db, scope, row, stored) };
  });
}

function numberedBatch(db: Store, origin: string, basis: string) {
  const totals = db.prepare(`SELECT count(*) AS received, max(partCount) AS expected,
    coalesce(sum((SELECT count(*) FROM json_each(batch.excluded) WHERE value = 'Skipped')), 0) AS skipped,
    coalesce(sum((SELECT count(*) FROM json_each(batch.excluded) WHERE value = 'Suppressed')), 0) AS suppressed
    FROM migration_batches batch WHERE origin = ? AND snapshot = ?`).get(origin, basis);
  return { received: Number(totals?.received ?? 0), expected: Number(totals?.expected ?? 0),
    skipped: Number(totals?.skipped ?? 0), suppressed: Number(totals?.suppressed ?? 0) };
}

function completeBatch(batch: ReturnType<typeof numberedBatch> | null) {
  return !!batch && batch.expected > 0 && batch.received === batch.expected;
}

function callbacksReady(evidence: CutoverCallbackEvidence) {
  const { counts, total, unrestored, oversized } = evidence;
  return total > 0 && !unrestored && !oversized && !counts["Needs owner"] && !counts["Needs recovery"] && !counts["Missing evidence"];
}

export function readMigrationCutover(db: Store, staff: WorkspaceStaff, brokerageId: string, input?: unknown,
  activeOwners: ReadonlySet<string> = new Set([staff.email])): MigrationCutover | { error: string } {
  if (!canReview(staff, brokerageId)) return { error: cutoverUnavailable };
  const parsed = cutoverSourceInput.safeParse(input);
  if (!parsed.success) return { error: "Choose a valid migration source." };
  return readCutoverSnapshot(db, parsed.data, activeOwners);
}

export function exportCutoverHandoff(db: Store, staff: WorkspaceStaff | null, brokerageId: string, input: unknown,
  activeOwners: ReadonlySet<string> = new Set(staff ? [staff.email] : []), checkedAt = new Date().toISOString()): CutoverHandoff | { error: string } {
  if (!canReview(staff, brokerageId)) return { error: cutoverUnavailable };
  const parsed = cutoverHandoffQuery.safeParse(input);
  if (!parsed.success) return { error: "Choose a valid migration source and snapshot for the handoff." };
  const snapshot = readCutoverSnapshot(db, { origin: parsed.data.origin }, activeOwners, parsed.data.basis);
  if ("error" in snapshot) return snapshot;
  return snapshot.evidence ? renderCutoverHandoff(snapshot.evidence, checkedAt, snapshot.reviewReference) : { error: changedSource };
}

function readCutoverSnapshot(db: Store, input: ReturnType<typeof cutoverSourceInput.parse>, activeOwners: ReadonlySet<string>,
  handoffBasis?: string): (MigrationCutover & { reviewReference?: string }) | { error: string } {
  return db.transaction(() => {
    const recent = db.prepare(`SELECT origin FROM (SELECT origin FROM migration_imports ORDER BY importedAt DESC, id DESC LIMIT 100)
      UNION ALL SELECT origin FROM (SELECT origin FROM migration_batches ORDER BY rowid DESC LIMIT 100)`).all();
    const sources = [...new Set(recent.map(({ origin }) => String(origin)))].slice(0, 20);
    const origin = input?.origin ?? sources[0];
    if (!origin) return { sources, evidence: null };
    const current = basisForSource(db, origin);
    if (handoffBasis && current?.basis !== handoffBasis) return { error: changedSource };
    if (!current) return { error: "This migration source has no committed imports in this brokerage." };
    const { basis, numbered } = current;
    const count = handoffBasis ? db.prepare(`SELECT count(*) AS total FROM (SELECT 1 ${linkedDrafts} LIMIT ?)`).get(origin, cutoverReadinessLimit + 1) :
      db.prepare(`SELECT count(*) AS total ${linkedDrafts}`).get(origin);
    const draftCount = Number(count?.total ?? 0);
    if (handoffBasis && draftCount > cutoverReadinessLimit) {
      return { error: `This source exceeds the cutover handoff limit of ${cutoverReadinessLimit} linked files.` };
    }
    const batch = numbered ? numberedBatch(db, origin, basis) : null;
    const linkedRecords = db.prepare(`SELECT count(*) AS total,
      sum(recordKey GLOB 'Contact:*') AS contacts, sum(recordKey GLOB 'Lead:*') AS leads,
      sum(recordKey GLOB 'Note:*') AS notes, sum(recordKey GLOB 'Task:*') AS tasks, sum(recordKey GLOB 'Callback:*') AS callbacks
      FROM migration_records WHERE origin = ?`).get(origin);
    const callbackLinks = Number(linkedRecords?.callbacks ?? 0);
    const byType = { contacts: Number(linkedRecords?.contacts ?? 0), leads: Number(linkedRecords?.leads ?? 0),
      notes: Number(linkedRecords?.notes ?? 0), tasks: Number(linkedRecords?.tasks ?? 0), ...(callbackLinks ? { callbacks: callbackLinks } : {}) };
    const undone = Number(db.prepare(`SELECT count(DISTINCT removed.recordKey) AS count FROM migration_undone_records removed
      WHERE removed.origin = ? AND NOT EXISTS (SELECT 1 FROM migration_records current
        WHERE current.origin = removed.origin AND current.recordKey = removed.recordKey)`).get(origin)?.count);
    const { after, callbackAfter } = input ?? {};
    const pageSize = handoffBasis ? cutoverReadinessLimit : draftPageSize;
    const createdAt = "coalesce(loan.createdAt, loan.stageSince)";
    const linked = db.prepare(`SELECT ${draftFields}, ${createdAt} AS createdAt
      ${linkedDrafts} ${after ? `AND (${createdAt} < ? OR (${createdAt} = ? AND loan.id > ?))` : ""}
      ORDER BY createdAt DESC, loan.id LIMIT ?`).all(origin, ...(after ? [after.createdAt, after.createdAt, after.id] : []), pageSize + 1);
    const page = linked.slice(0, pageSize);
    const withinReadinessLimit = draftCount <= cutoverReadinessLimit;
    const reviewIds = withinReadinessLimit && page.length !== draftCount
      ? db.prepare(`SELECT loan.id ${linkedDrafts} ORDER BY loan.id LIMIT ?`).all(origin, cutoverReadinessLimit).map(({ id }) => String(id))
      : page.map(({ id }) => String(id));
    const scope = { origin, basis };
    const reviewsByLoan = readDraftReviews(db, scope, reviewIds);
    const drafts = page.map((row) => readCutoverDraft(db, scope, row, reviewsByLoan.get(String(row.id))));
    let counts: CutoverReadiness["counts"] = null;
    if (withinReadinessLimit) {
      counts = { Ready: 0, "Reviewed with exclusions": 0, "Needs review": 0 };
      const visible = new Map(drafts.map(({ id, readiness }) => [id, readiness.status]));
      for (const loanId of reviewIds) {
        const status = visible.get(loanId) ?? draftReadiness(db, { origin, basis, loanId }, reviewsByLoan.get(loanId), true).status;
        counts[status]++;
      }
    }
    const last = page.at(-1);
    const draftNext = last && linked.length > pageSize ? { id: String(last.id), createdAt: String(last.createdAt) } : null;
    const callbacks = readCutoverCallbackEvidence(db, origin, basis, activeOwners, callbackAfter);
    const reviews = db.prepare(`SELECT item, decision, note, updatedBy, updatedAt, revision, callbackFingerprint FROM migration_cutover_reviews
      WHERE origin = ? AND basis = ?`).all(origin, basis).map(({ callbackFingerprint, ...row }) =>
      row.item === cutoverCallbackItem && row.decision === "Reconciled" ? {
        ...row,
        callbackCurrent: callbackFingerprint === callbacks.fingerprint && completeBatch(batch) && callbacksReady(callbacks),
      } : row) as unknown as CutoverReview[];
    const evidence = { origin, basis, batch, links: Number(linkedRecords?.total ?? 0), byType, undone, draftCount, draftNext, drafts, reviews, callbacks,
      readiness: { counts, limit: cutoverReadinessLimit } };
    const reviewReference = handoffBasis ? cutoverReviewReference(evidence, [...reviewsByLoan.values()].flatMap((file) => [...file.values()])) : undefined;
    return { sources: sources.includes(origin) ? sources : [origin, ...sources.slice(0, 19)], evidence,
      ...(reviewReference ? { reviewReference } : {}) };
  });
}

export function saveMigrationCutover(db: Store, staff: WorkspaceStaff, brokerageId: string, input: unknown, now = new Date().toISOString(),
  activeOwners: ReadonlySet<string> = new Set([staff.email])) {
  if (!canReview(staff, brokerageId)) return { error: cutoverUnavailable };
  const parsed = cutoverReviewInput.safeParse(input);
  if (!parsed.success) return { error: "Choose a review decision and add a short evidence note for a completed check." };
  const { origin, basis, loanId, item, decision, note, revision, callbackFingerprint, applicationFingerprint, fileFingerprint } = parsed.data;
  const callbackReview = item === cutoverCallbackItem;
  return db.transaction(() => {
    const current = basisForSource(db, origin);
    if (current?.basis !== basis) return { error: changedSource };
    if (loanId && !hasLinkedDraft(db, origin, loanId)) return { error: unlinkedDraft };
    const evidence: [string, SqlValue][] = [];
    if (callbackReview) {
      if (decision === "Reconciled") {
        if (!current.numbered || !completeBatch(numberedBatch(db, origin, basis))) {
          return { error: "Import every part of the numbered CRM export before reconciling callbacks." };
        }
        const callbacks = readCutoverCallbackEvidence(db, origin, basis, activeOwners);
        if (callbackFingerprint !== callbacks.fingerprint) return { error: "The callback evidence changed. Refresh it before saving." };
        if (!callbacksReady(callbacks)) return { error: "Resolve callback ownership, recovery, and missing evidence before reconciling." };
      }
      evidence.push(["callbackFingerprint", decision === "Reconciled" ? callbackFingerprint ?? null : null]);
    }
    if (loanId && item === "application") {
      if (decision === "Reconciled") {
        const comparison = readApplicationComparison(db, loanId);
        if (!comparison) return { error: missingComparison };
        if (comparison.fingerprint !== applicationFingerprint) return { error: "The application comparison changed. Refresh it before saving." };
        if (applicationEvidenceBlocker(comparison)) {
          return { error: "Resolve missing 1003 fields and additional borrowers before reconciling this draft." };
        }
        evidence.push(["applicationFingerprint", comparison.fingerprint], ["applicationRevision", comparison.revision]);
      } else {
        evidence.push(["applicationFingerprint", null], ["applicationRevision", null]);
      }
    }
    if (loanId && fileReviewItem(item)) {
      if (decision === "Reconciled") {
        const source = readFileSource(fileSourceRecord(db, { origin, basis, loanId })?.source);
        if (!source || source[cutoverFileSourceSection[item]] === undefined) {
          return { error: "Save the corresponding fictional source inventory before reconciling this file." };
        }
        const comparison = readFileComparison(db, loanId, item, source);
        if (!comparison) return { error: cutoverFileComparisonUnavailable };
        if (comparison.fingerprint !== fileFingerprint) return { error: "The file inventory comparison changed. Refresh it before saving." };
        if (comparison.rows.some(({ status }) => status === "Missing")) {
          return { error: "Resolve missing file inventory records or evidence before reconciling this draft." };
        }
      }
      evidence.push(["fileFingerprint", decision === "Reconciled" ? fileFingerprint ?? null : null]);
    }
    const table = loanId ? "migration_cutover_loan_reviews" : "migration_cutover_reviews";
    const key = loanId ? [loanId, origin, basis, item] : [origin, basis, item];
    const columns = loanId ? "loanId, origin, basis, item" : "origin, basis, item";
    const evidenceColumns = evidence.map(([column]) => `, ${column}`).join("");
    const prior = db.prepare(`SELECT decision, note, revision${evidenceColumns} FROM ${table}
      WHERE ${loanId ? "loanId = ? AND " : ""}origin = ? AND basis = ? AND item = ?`).get(...key);
    // Borrower navigation can increment the audited revision without changing the evidence.
    if (prior?.decision === decision && prior.note === note &&
      evidence.every(([column, value]) => column === "applicationRevision" || prior[column] === value)) {
      return { message: "This review is up to date." };
    }
    if ((prior?.revision ?? 0) !== revision) return { error: "This review changed. Refresh the checklist before saving." };
    db.prepare(`INSERT INTO ${table} (${columns}, decision, note, updatedBy, updatedAt, revision${evidenceColumns})
      VALUES (${loanId ? "?, " : ""}?, ?, ?, ?, ?, ?, ?, 1${", ?".repeat(evidence.length)}) ON CONFLICT (${columns}) DO UPDATE SET decision = excluded.decision,
      note = excluded.note, updatedBy = excluded.updatedBy, updatedAt = excluded.updatedAt, revision = revision + 1
      ${evidence.map(([column]) => `, ${column} = excluded.${column}`).join("")}`)
      .run(...key, decision, note, staff.name, now, ...evidence.map(([, value]) => value));
    accessEvent(db, staff, loanId ? "Recorded migration loan review" : "Recorded migration cutover review",
      [origin, loanId, item, decision].filter(Boolean).join(" · "), now);
    return { message: "Cutover review saved." };
  });
}
