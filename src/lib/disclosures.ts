import { addApplicationActivity, getApplication } from "./applications";
import { applicationDraft, type ApplicationDraft } from "./application-model";
import { demoBrokerageId } from "./brokerage-model";
import { currentClosingGatePolicy } from "./closing-gate-policy-store";
import { easternDate, easternDayStart } from "./client-retention";
import { changedDisclosureTarget, currentDisclosureCalendar } from "./disclosure-calendar";
import { compareDisclosureTerms } from "./disclosure-change-model";
import { disclosureSigningDeadline, storedDisclosureCalendarBasis, type DisclosureCalendarBasis } from "./disclosure-calendar-model";
import { disclosureTemplateChanged, disclosureTemplateMatch, type DisclosureTemplateBasis } from "./disclosure-template-model";
import { disclosureTemplatesForLoan, selectedDisclosureTemplate } from "./disclosure-templates";
import { approvedIncomeSql } from "./income-review-freshness";
import { disclosureClosingReviewPrefix, disclosureDeclinePrefix, disclosureDeclineTaskTitle, disclosureIssuePrefix, disclosureReviewPrefix, disclosureSigningPrefix, type BorrowerDisclosure, type BorrowerDisclosureResponse,
  changedClosingApprovalRequired, closingPackageReviewCategory, type ChangedClosingApproval, type ClosingPackageAssignment, type ClosingPackageReviewEvidence, type ClosingPackageReviewRef,
  type ClosingDisclosureReview, type DisclosureCommand, type DisclosurePackage, type DisclosureSigner,
  type DisclosureSource, type DisclosureWork } from "./disclosure-model";
import { quoteFeeWorksheet, quoteSnapshot } from "./quote-worksheet-store";
import { allocatedFeeLines } from "./quote-worksheet";
import { savedPricingRun, type Store } from "./store";
import type { WorkspaceStaff } from "./staff-store";

export function canUseSampleDisclosures(staff: WorkspaceStaff | null) {
  return !staff || staff.brokerage.pilot || staff.brokerage.id === demoBrokerageId;
}

function disclosureSource(db: Store, loanId: string) {
  const app = getApplication(db, loanId);
  if (!app?.submittedAt || !app.reviewedAt || app.correctionNote) return { error: "Submit and review the current 1003 first." } as const;
  const run = savedPricingRun(db, loanId);
  if (!run || typeof run.selectedId !== "string" || run.mode !== "mock") return { error: "Save a sample quote in Pricing & credit first." } as const;
  const runId = String(run.id);
  const worksheet = quoteFeeWorksheet(db, loanId, runId, run.selectedId);
  if (!worksheet) return { error: "Save a fee worksheet for the selected sample quote." } as const;
  const quote = quoteSnapshot(db, loanId, { runId, offerId: run.selectedId, feeRevision: worksheet.revision }, app);
  if ("error" in quote) return { error: quote.error } as const;
  const source: DisclosureSource = { applicationRevision: app.revision, feeRevision: worksheet.revision, quote: quote.option };
  return { source, draft: app.draft, manualExpiresOn: quote.manualExpiresOn } as const;
}

type PackageRow = Omit<DisclosurePackage, "documents" | "signers" | "quote" | "declineFollowUp" | "changeReview" | "deadlineBasis" | "templateBasis"> & {
  loanId: string; runId: string; offerId: string; documents: string; signers: string; quote: string;
  declineFollowUp: string | null;
  changeReview: string | null;
  deadlineBasis: string | null;
  templateBasis: string | null;
};

function packageRows(db: Store, loanId: string, limit: number) {
  return db.prepare("SELECT * FROM disclosure_packages WHERE loanId = ? ORDER BY version DESC LIMIT ?")
    .all(loanId, limit) as unknown as PackageRow[];
}

function changeReviewEvidence(db: Store, loanId: string, raw: string | null, replacement: DisclosureSource) {
  const changeReview: DisclosurePackage["changeReview"] = raw ? JSON.parse(raw) : null;
  if (!changeReview || changeReview.changes) return { changeReview };
  const before = db.prepare("SELECT quote,applicationRevision,feeRevision FROM disclosure_packages WHERE loanId=? AND version=?")
    .get(loanId, changeReview.fromVersion);
  if (!before) return { changeReview };
  return { changeReview, legacyChanges: compareDisclosureTerms({
    quote: JSON.parse(String(before.quote)), applicationRevision: Number(before.applicationRevision), feeRevision: Number(before.feeRevision),
  }, replacement) };
}

export function readDisclosureWork(db: Store, loanId: string, now = new Date()): DisclosureWork {
  const current = disclosureSource(db, loanId);
  const templateOptions = current.source ?
    disclosureTemplatesForLoan(db, disclosureTemplateMatch(applicationDraft.parse(JSON.parse(current.draft)))) : undefined;
  const rows = packageRows(db, loanId, 6);
  const latest = rows[0];
  const calendar = currentDisclosureCalendar(db);
  const suggestedDeadline = disclosureSigningDeadline(calendar.rules, { version: calendar.version, anchorOn: easternDate(now) });
  const draftTargetChanged = latest && !latest.issuedAt
    ? changedDisclosureTarget(storedDisclosureCalendarBasis(latest.deadlineBasis), latest.signBy, calendar) : null;
  const closingReviews = db.prepare(`SELECT review.version, review.revision, review.reviewedAt AS at, review.actor,
      package.applicationRevision, package.feeRevision, package.signers, package.changeReview, package.quote
    FROM closing_disclosure_reviews review
    JOIN disclosure_packages package ON package.loanId = review.loanId AND package.version = review.version
    WHERE review.loanId = ? ORDER BY review.version DESC, review.revision DESC LIMIT 4`).all(loanId)
    .map(({ signers, changeReview, quote, ...row }) => {
      const source = JSON.parse(String(quote)) as DisclosurePackage["quote"];
      const feeAllocations = allocatedFeeLines(source.estimate?.inputs);
      return {
        ...row, signers: JSON.parse(String(signers)), ...changeReviewEvidence(db, loanId, changeReview as string | null, {
          quote: source, applicationRevision: Number(row.applicationRevision), feeRevision: Number(row.feeRevision),
        }),
        ...(feeAllocations.length ? { feeAllocations } : {}),
        current: !!(latest && current.source && !latest.reviewReason && !latest.supersededAt &&
          row.version === latest.version && row.revision === latest.revision && matchesSource(latest, current.source)),
      };
    }) as ClosingDisclosureReview[];
  const revisionReason = latest ? latest.reviewReason ?? (current.source ?
    matchesSource(latest, current.source) ? null : "Application, quote or fees changed" : current.error ?? null) : null;
  const assignment = latest ? readClosingPackageAssignment(db, loanId) : undefined;
  const assignmentCurrent = assignment?.status === "Requested" ? sameClosingPackage(assignment, currentClosingPackage(db, loanId)) :
    !!(assignment && !revisionReason && latest?.issuedAt && sameClosingPackage(assignment, latest));
  const closingAssignment = assignment && (assignment.status !== "Approved" || assignmentCurrent)
    ? { ...assignment, current: assignmentCurrent } : undefined;
  const changedClosingApproval = latest ? readChangedClosingApproval(db, loanId) : undefined;
  return { source: current.source ?? null, unavailable: current.error ?? null, revisionReason, closingReviews, closingAssignment, changedClosingApproval, suggestedDeadline, draftTargetChanged, templateOptions, packages: rows
    .map((item) => {
      const quote = JSON.parse(item.quote) as DisclosurePackage["quote"];
      return {
        version: item.version, revision: item.revision, applicationRevision: item.applicationRevision, feeRevision: item.feeRevision,
        preparedAt: item.preparedAt, issuedAt: item.issuedAt, signBy: item.signBy, supersededAt: item.supersededAt, reviewReason: item.reviewReason,
        documents: JSON.parse(item.documents), signers: JSON.parse(item.signers), quote,
        deadlineBasis: storedDisclosureCalendarBasis(item.deadlineBasis),
        ...(item.templateBasis ? { templateBasis: JSON.parse(item.templateBasis) as DisclosureTemplateBasis } : {}),
        declineFollowUp: item.declineFollowUp ? JSON.parse(item.declineFollowUp) : null,
        ...changeReviewEvidence(db, loanId, item.changeReview, { quote, applicationRevision: item.applicationRevision, feeRevision: item.feeRevision }),
      };
    }) };
}

function taskId(prefix: string, item: Pick<PackageRow, "loanId" | "version">) {
  return `${prefix}${item.loanId}:${item.version}`;
}

function completeTask(db: Store, prefix: string, item: Pick<PackageRow, "loanId" | "version">, now: string) {
  db.prepare("UPDATE tasks SET completedAt = ? WHERE id = ? AND completedAt IS NULL").run(now, taskId(prefix, item));
}

function createTask(db: Store, prefix: string, item: Pick<PackageRow, "loanId" | "version">, title: string, dueAt: string) {
  db.prepare("INSERT INTO tasks (id, loanId, title, dueAt) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO NOTHING")
    .run(taskId(prefix, item), item.loanId, title, dueAt);
}

function replacesConfirmedPackage(db: Store, { loanId, version }: Pick<PackageRow, "loanId" | "version">) {
  return db.prepare("SELECT 1 FROM closing_disclosure_reviews WHERE loanId = ? AND version < ? LIMIT 1").get(loanId, version);
}

export function sameClosingPackage(a?: ClosingPackageReviewRef, b?: ClosingPackageReviewRef) {
  return !!a && !!b && a.version === b.version && a.revision === b.revision;
}

export function readClosingPackageAssignment(db: Store, loanId: string): ClosingPackageAssignment | undefined {
  return db.prepare(`SELECT review.id, review.status, review.reviewerName, review.reviewerEmail, review.dueOn, review.escalatedAt, pinned.version, pinned.revision,
    CASE WHEN review.status = 'Changes requested' THEN (
      SELECT decision.note FROM loan_review_events decision WHERE decision.reviewId = review.id AND decision.action = 'Changes requested'
      ORDER BY decision.sequence DESC LIMIT 1
    ) END AS correctionReason
    FROM loan_reviews review JOIN loan_review_events event ON event.sequence = (
      SELECT max(candidate.sequence) FROM loan_review_events candidate
      JOIN loan_review_closing_packages basis ON basis.eventId = candidate.id
      WHERE candidate.reviewId = review.id AND candidate.action IN ('Requested', 'Resubmitted')
    ) JOIN loan_review_closing_packages pinned ON pinned.eventId = event.id
    WHERE review.loanId = ? AND review.category = ? AND review.status <> 'Canceled'
    ORDER BY review.status = 'Approved', review.rowid DESC LIMIT 1`).get(loanId, closingPackageReviewCategory) as ClosingPackageAssignment | undefined;
}

export function closingPackageEvidence(db: Store, loanId: string, reference: ClosingPackageReviewRef): ClosingPackageReviewEvidence | undefined {
  const row = db.prepare("SELECT quote, applicationRevision, feeRevision, changeReview FROM disclosure_packages WHERE loanId = ? AND version = ?")
    .get(loanId, reference.version);
  if (!row) return;
  const source: DisclosureSource = { quote: JSON.parse(String(row.quote)), applicationRevision: Number(row.applicationRevision), feeRevision: Number(row.feeRevision) };
  return { ...reference, applicationRevision: source.applicationRevision, feeRevision: source.feeRevision,
    ...changeReviewEvidence(db, loanId, row.changeReview as string | null, source) };
}

// The queue and the decision command use the same signed package and pricing basis.
export const currentSignedClosingPackageSql = `package.issuedAt IS NOT NULL AND package.reviewReason IS NULL AND package.supersededAt IS NULL
  AND package.version = (SELECT max(latest.version) FROM disclosure_packages latest WHERE latest.loanId = package.loanId)
  AND EXISTS (SELECT 1 FROM closing_disclosure_reviews confirmed WHERE confirmed.loanId = package.loanId AND confirmed.version < package.version)
  AND json_array_length(package.signers) > 0 AND NOT EXISTS (
    SELECT 1 FROM json_each(package.signers) signer
    WHERE json_extract(signer.value, '$.status') IS NOT 'Signed' OR coalesce(json_extract(signer.value, '$.receipt'), '') = ''
  ) AND EXISTS (
    SELECT 1 FROM applications application JOIN pricing_runs price ON price.id = package.runId AND price.loanId = application.loanId
    JOIN fee_worksheets fee ON fee.runId = price.id AND fee.offerId = price.selectedId
    WHERE application.loanId = package.loanId AND application.submittedAt IS NOT NULL AND application.reviewedAt IS NOT NULL
      AND coalesce(application.correctionNote, '') = '' AND application.revision = package.applicationRevision
      AND price.applicationRevision = application.revision AND price.mode = 'mock' AND price.selectedId = package.offerId
      AND fee.revision = package.feeRevision
      AND price.id = (SELECT latest.id FROM pricing_runs latest WHERE latest.loanId = package.loanId AND latest.selectedId IS NOT NULL
        ORDER BY latest.selectedAt DESC, latest.rowid DESC LIMIT 1)
      AND EXISTS (SELECT 1 FROM json_each(price.offers) offer WHERE json_extract(offer.value, '$.id') = package.offerId)
      AND (price.incomeReviewRevision IS NULL OR EXISTS (${approvedIncomeSql("package.loanId", "price.incomeReviewRevision")}))
  )`;

export function currentClosingPackage(db: Store, loanId: string): ClosingPackageReviewRef | undefined {
  if (!activeDisclosureLoan(db, loanId)) return;
  const row = db.prepare(`SELECT package.version, package.revision FROM disclosure_packages package
    WHERE package.loanId = ? AND ${currentSignedClosingPackageSql}`).get(loanId) as ClosingPackageReviewRef | undefined;
  if (row) return { version: row.version, revision: row.revision };
}

export function hasClosingConfirmation(db: Store, loanId: string, { version, revision }: ClosingPackageReviewRef) {
  return !!db.prepare("SELECT 1 FROM closing_disclosure_reviews WHERE loanId = ? AND version = ? AND revision = ?")
    .get(loanId, version, revision);
}

export function closingPackageAuthor(db: Store, loanId: string, version: number) {
  const row = db.prepare(`SELECT package.preparedByEmail, package.changeReview, loan.officerEmail FROM disclosure_packages package JOIN loans loan ON loan.id = package.loanId
    WHERE package.loanId = ? AND package.version = ?`).get(loanId, version);
  const change: DisclosurePackage["changeReview"] = row?.changeReview ? JSON.parse(String(row.changeReview)) : null;
  return { email: (row?.preparedByEmail ?? row?.officerEmail ?? null) as string | null,
    name: change?.actor ?? null, legacyName: row?.preparedByEmail ? null : change?.actor ?? null };
}

export function isIndependentClosingReviewer(author: ReturnType<typeof closingPackageAuthor>, reviewer: { email: string; name: string }) {
  return reviewer.email !== author.email && reviewer.name !== author.legacyName;
}

export function readChangedClosingApproval(db: Store, loanId: string, policy = currentClosingGatePolicy(db)): ChangedClosingApproval | undefined {
  if (!policy.rules.changedPackageReview || !activeDisclosureLoan(db, loanId)) return;
  const [item] = packageRows(db, loanId, 1);
  if (!item) return;
  const baseline = db.prepare(`SELECT package.runId, package.offerId, package.applicationRevision, package.feeRevision
    FROM closing_disclosure_reviews review JOIN disclosure_packages package ON package.loanId = review.loanId AND package.version = review.version
    JOIN loans loan ON loan.id = review.loanId
    WHERE review.loanId = ? AND review.version < ? AND (
      review.version = (SELECT min(first.version) FROM closing_disclosure_reviews first WHERE first.loanId = review.loanId)
      OR EXISTS (
        SELECT 1 FROM loan_reviews team JOIN loan_review_events event ON event.reviewId = team.id AND event.action = 'Approved'
        JOIN loan_review_closing_packages basis ON basis.eventId = event.id
        WHERE team.loanId = review.loanId AND team.category = ? AND team.status = 'Approved'
          AND basis.version = review.version AND basis.revision = review.revision
          AND event.actorEmail IS NOT coalesce(package.preparedByEmail, loan.officerEmail)
          AND (package.preparedByEmail IS NOT NULL OR event.actorName IS NOT json_extract(package.changeReview, '$.actor'))
      )
    ) ORDER BY review.version DESC LIMIT 1`).get(loanId, item.version, closingPackageReviewCategory);
  const { source } = disclosureSource(db, loanId);
  const outdated = !!item.reviewReason || !source || !matchesSource(item, source);
  if (!baseline && !(outdated && db.prepare("SELECT 1 FROM closing_disclosure_reviews WHERE loanId = ? LIMIT 1").get(loanId))) return;
  const changedBasis = baseline && (baseline.runId !== item.runId || baseline.offerId !== item.offerId ||
    baseline.applicationRevision !== item.applicationRevision || baseline.feeRevision !== item.feeRevision);
  if (!item.changeReview && !outdated && !changedBasis) return;

  const { version, revision } = item;
  const assignment = readClosingPackageAssignment(db, loanId);
  const assigned = assignment && assignment.status !== "Approved" ? { reviewId: assignment.id, reviewerName: assignment.reviewerName } : {};
  if (assignment?.status === "Changes requested") return { status: "Returned for corrections", version, ...assigned };
  const current = currentClosingPackage(db, loanId);
  if (!current) return { status: "Needs signed replacement", version, ...assigned };
  const author = closingPackageAuthor(db, loanId, version);
  const decision = db.prepare(`SELECT review.id, event.actorName, event.at FROM loan_reviews review
    JOIN loan_review_events event ON event.reviewId = review.id AND event.action = 'Approved'
    JOIN loan_review_closing_packages basis ON basis.eventId = event.id
    WHERE review.loanId = ? AND review.category = ? AND review.status = 'Approved' AND basis.version = ? AND basis.revision = ?
      AND event.actorEmail IS NOT ? AND event.actorName IS NOT ?
    ORDER BY event.sequence DESC LIMIT 1`).get(loanId, closingPackageReviewCategory, version, revision, author.email, author.legacyName);
  if (decision) return { status: "Approved", version, reviewId: String(decision.id), reviewerName: String(decision.actorName), approvedAt: String(decision.at) };
  if (assignment?.status === "Requested") {
    const independent = isIndependentClosingReviewer(author, { email: assignment.reviewerEmail, name: assignment.reviewerName });
    return { status: !independent ? "Needs reviewer" : sameClosingPackage(assignment, current) ? "Awaiting approval" : "Needs resubmission",
      version, ...assigned };
  }
  const blocked = policy.rules.changedPackageReviewer && db.prepare(`SELECT reason FROM closing_review_routing_blocks
    WHERE loanId = ? AND version = ? AND revision = ?`).get(loanId, version, revision);
  return { status: "Needs reviewer", version, ...(blocked ? { routingReason: String(blocked.reason) } : {}) };
}

export function updateAssignedClosingTask(db: Store, loanId: string, reference: ClosingPackageReviewRef, at: string, waiting: boolean) {
  const item = { loanId, version: reference.version };
  if (waiting) completeTask(db, disclosureClosingReviewPrefix, item, at);
  else if (sameClosingPackage(reference, currentClosingPackage(db, loanId)) && !hasClosingConfirmation(db, loanId, reference)) {
    createTask(db, disclosureClosingReviewPrefix, item, "Confirm revised sample package for closing", at);
    db.prepare("UPDATE tasks SET completedAt = NULL, dueAt = ? WHERE id = ?").run(at, taskId(disclosureClosingReviewPrefix, item));
  }
}

export function backfillRevisedDisclosureTasks(db: Store) {
  const candidates = db.prepare(`SELECT p.* FROM disclosure_packages p JOIN loans l ON l.id=p.loanId
    WHERE l.disposition='Active' AND l.stage NOT IN ('Funded','Closed')
      AND p.supersededAt IS NULL AND p.reviewReason IS NULL
      AND p.version=(SELECT max(version) FROM disclosure_packages WHERE loanId=p.loanId)
      AND EXISTS (SELECT 1 FROM closing_disclosure_reviews WHERE loanId=p.loanId AND version<p.version)
      AND NOT EXISTS (SELECT 1 FROM closing_disclosure_reviews WHERE loanId=p.loanId AND version=p.version AND revision=p.revision)`)
    .all() as unknown as PackageRow[];
  for (const item of candidates) {
    const source = disclosureSource(db, item.loanId).source;
    if (!source || !matchesSource(item, source)) continue;
    if (!item.issuedAt) {
      createTask(db, disclosureIssuePrefix, item, "Issue revised sample disclosure package", item.preparedAt);
      continue;
    }
    const signers: DisclosureSigner[] = JSON.parse(item.signers);
    if (signers.length && signers.every(signer => signer.status === "Signed" && signer.receipt)) {
      const assignment = readClosingPackageAssignment(db, item.loanId);
      if (assignment && assignment.status !== "Approved") continue;
      const signedAt = signers.reduce((latest, signer) => signer.actedAt && signer.actedAt > latest ? signer.actedAt : latest, item.issuedAt);
      createTask(db, disclosureClosingReviewPrefix, item, "Confirm revised sample package for closing", signedAt);
    }
  }
}

export function flagDisclosureReview(db: Store, loanId: string, reason: string, now: string, feeSource?: { runId: string; offerId: string; feeRevision: number }) {
  const [item] = packageRows(db, loanId, 1);
  if (!item || item.reviewReason || (feeSource && (item.runId !== feeSource.runId || item.offerId !== feeSource.offerId ||
    item.feeRevision === feeSource.feeRevision))) return;
  db.prepare("UPDATE disclosure_packages SET reviewReason = ?, revision = revision + 1 WHERE loanId = ? AND version = ?")
    .run(reason, loanId, item.version);
  completeTask(db, disclosureSigningPrefix, item, now);
  completeTask(db, disclosureIssuePrefix, item, now);
  completeTask(db, disclosureClosingReviewPrefix, item, now);
  createTask(db, disclosureReviewPrefix, item, reason === "Fees changed" ? "Review disclosure package · Fees changed" : "Review disclosure package", now);
  addApplicationActivity(db, loanId, `Sample disclosure package v${item.version} needs review · ${reason}.`, now);
}

function matchesSource(item: PackageRow, source: DisclosureSource) {
  return item.applicationRevision === source.applicationRevision && item.feeRevision === source.feeRevision &&
    item.runId === source.quote.runId && item.offerId === source.quote.offerId;
}

function disclosureNames(application: ApplicationDraft): DisclosureSigner[] {
  const primary: DisclosureSigner = { role: "Borrower", name: application.borrowerName, status: "Pending", actedAt: null, receipt: null };
  const joint = application.urla.additional[0]?.identity.fields.name?.trim();
  return joint ? [primary, { ...primary, role: "Co-borrower", name: joint }] : [primary];
}

function activeDisclosureLoan(db: Store, loanId: string) {
  const loan = db.prepare("SELECT disposition, stage FROM loans WHERE id = ?").get(loanId);
  return loan?.disposition === "Active" && loan.stage !== "Funded" && loan.stage !== "Closed";
}

export function recordClosingDisclosureReview(db: Store, staff: WorkspaceStaff | null, loanId: string, version: number, revision: number, now: string) {
  if (!canUseSampleDisclosures(staff) || !activeDisclosureLoan(db, loanId)) {
    return { error: "Open an active fictional loan to review its sample package for closing." } as const;
  }
  const [item] = packageRows(db, loanId, 1);
  const { source } = disclosureSource(db, loanId);
  if (!item?.issuedAt || item.version !== version || item.revision !== revision || item.reviewReason || item.supersededAt ||
    !source || !matchesSource(item, source)) {
    return { error: "Open the current issued sample package before confirming its evidence for closing." } as const;
  }
  const signers: DisclosureSigner[] = JSON.parse(item.signers);
  if (!signers.length || signers.some(({ status, receipt }) => status !== "Signed" || !receipt)) {
    return { error: "Record each mock signature before confirming the sample package for closing." } as const;
  }
  const approval = readChangedClosingApproval(db, loanId);
  if (approval && approval.status !== "Approved") return { error: changedClosingApprovalRequired } as const;
  if (hasClosingConfirmation(db, loanId, item)) return { message: "This sample package is already confirmed for the closing handoff." } as const;
  const assignment = readClosingPackageAssignment(db, loanId);
  if (assignment && assignment.status !== "Approved") {
    return { error: "Finish the assigned closing package review before confirming the closing handoff." } as const;
  }
  db.prepare("INSERT INTO closing_disclosure_reviews (loanId, version, revision, reviewedAt, actor) VALUES (?, ?, ?, ?, ?)")
    .run(loanId, version, revision, now, staff?.name ?? "Demo staff");
  completeTask(db, disclosureClosingReviewPrefix, item, now);
  addApplicationActivity(db, loanId, `Confirmed sample disclosure package v${version} for the closing handoff.`, now);
  return { message: `Sample package v${version} confirmed for the closing handoff.` } as const;
}

function applyDisclosureResponse(db: Store, item: PackageRow, signers: DisclosureSigner[], signer: DisclosureSigner,
  response: BorrowerDisclosureResponse["response"], via: NonNullable<DisclosureSigner["respondedVia"]>, now: string) {
  signer.status = response;
  signer.actedAt = now;
  signer.receipt = `Mock receipt ${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  signer.respondedVia = via;
  db.prepare("UPDATE disclosure_packages SET signers = ?, revision = revision + 1 WHERE loanId = ? AND version = ?")
    .run(JSON.stringify(signers), item.loanId, item.version);
  const signed = signers.every(({ status }) => status === "Signed");
  if (response === "Declined" || signed) completeTask(db, disclosureSigningPrefix, item, now);
  if (signed && replacesConfirmedPackage(db, item)) {
    const assignment = readClosingPackageAssignment(db, item.loanId);
    if (!assignment || assignment.status === "Approved") createTask(db, disclosureClosingReviewPrefix, item, "Confirm revised sample package for closing", now);
  }
  if (response === "Declined") createTask(db, disclosureDeclinePrefix, item, disclosureDeclineTaskTitle, now);
  addApplicationActivity(db, item.loanId, `Mock disclosure response · ${signer.role} ${response.toLowerCase()} package v${item.version} · ${via}.`, now);
}

export function readBorrowerDisclosure(db: Store, loanId: string, role: DisclosureSigner["role"]): BorrowerDisclosure | undefined {
  const item = db.prepare("SELECT * FROM disclosure_packages WHERE loanId = ? AND issuedAt IS NOT NULL ORDER BY version DESC LIMIT 1")
    .get(loanId) as PackageRow | undefined;
  if (!item?.issuedAt) return;
  const signers: DisclosureSigner[] = JSON.parse(item.signers);
  const signer = signers.find((item) => item.role === role);
  if (!signer) return;
  const source = disclosureSource(db, loanId).source;
  const { product, rate, loanAmount, estimate }: DisclosurePackage["quote"] = JSON.parse(item.quote);
  const documents: DisclosurePackage["documents"] = JSON.parse(item.documents);
  return {
    version: item.version, signBy: item.signBy, issuedAt: item.issuedAt, documents,
    state: item.reviewReason || item.supersededAt || !source || !matchesSource(item, source) ? "Awaiting revision" :
      signers.some(({ status }) => status === "Declined") || !activeDisclosureLoan(db, loanId) ? "Closed" : "Available",
    signer: { status: signer.status, actedAt: signer.actedAt, receipt: signer.receipt },
    terms: { product, rate, loanAmount },
    fees: estimate && documents.includes("Sample fee summary") ?
      { closingCosts: estimate.closingCosts, cashToClose: estimate.cashToClose, items: estimate.inputs.fees,
        ...(estimate.inputs.allocations ? { allocations: estimate.inputs.allocations } : {}) } : null,
  };
}

export function respondToBorrowerDisclosure(db: Store, loanId: string, role: DisclosureSigner["role"], input: BorrowerDisclosureResponse, now: string) {
  const unavailable = { status: 409, error: "This sample package changed. Refresh your loan status to see what is available." };
  const [item] = packageRows(db, loanId, 1);
  if (!item?.issuedAt || item.version !== input.version || item.reviewReason || item.supersededAt || !activeDisclosureLoan(db, loanId)) return unavailable;
  const source = disclosureSource(db, loanId).source;
  if (!source || !matchesSource(item, source)) return unavailable;
  const signers: DisclosureSigner[] = JSON.parse(item.signers);
  const signer = signers.find((item) => item.role === role);
  if (!signer) return unavailable;
  if (signer.status === input.response) return null;
  if (signer.status !== "Pending" || signers.some(({ status }) => status === "Declined")) return unavailable;
  applyDisclosureResponse(db, item, signers, signer, input.response, "Borrower portal", now);
  return null;
}

export function updateDisclosurePackage(db: Store, staff: WorkspaceStaff | null, data: DisclosureCommand, now: string) {
  if (!canUseSampleDisclosures(staff)) return { error: "Sample disclosure packages are available in fictional workspaces." } as const;
  if (!activeDisclosureLoan(db, data.loanId)) {
    return { error: "Open an active, unfunded loan to work on a sample disclosure package." } as const;
  }
  const [latest] = packageRows(db, data.loanId, 1);
  if (data.type === "reviewDisclosureDecline") {
    if (!latest?.issuedAt || latest.version !== data.version) return { error: "Open the current sample package." } as const;
    if (latest.declineFollowUp) {
      const followUp = JSON.parse(latest.declineFollowUp) as NonNullable<DisclosurePackage["declineFollowUp"]>;
      return followUp.note === data.note ? { message: "Decline follow-up already recorded." } as const :
        { error: "Decline follow-up was already recorded. Refresh the loan." } as const;
    }
    const signers: DisclosureSigner[] = JSON.parse(latest.signers);
    if (latest.revision !== data.revision || !signers.some(({ status }) => status === "Declined")) {
      return { error: "Refresh the current sample package before recording decline follow-up." } as const;
    }
    const followUp = { at: now, actor: staff?.name ?? "Demo staff", note: data.note };
    db.prepare("UPDATE disclosure_packages SET declineFollowUp = ?, revision = revision + 1 WHERE loanId = ? AND version = ?")
      .run(JSON.stringify(followUp), data.loanId, latest.version);
    completeTask(db, disclosureDeclinePrefix, latest, now);
    addApplicationActivity(db, data.loanId, `Recorded staff follow-up on declined sample disclosure package v${latest.version}.`, now);
    return { message: "Decline follow-up recorded." } as const;
  }
  const source = disclosureSource(db, data.loanId);
  if (!source.source) return { error: source.error } as const;
  const today = easternDate(new Date(now));
  if (data.type === "prepareDisclosurePackage") {
    if (source.manualExpiresOn && source.manualExpiresOn < today) return { error: "Choose a current manual lender quote before preparing a sample package." } as const;
    if ((latest?.version ?? null) !== data.previousVersion) return { error: "The package changed. Refresh the loan and try again." } as const;
    if (data.signBy < today) return { error: "Choose a signing target of today or later." } as const;
    let deadlineBasis: DisclosureCalendarBasis | null = null;
    if (data.deadlineCalendar) {
      const calendar = currentDisclosureCalendar(db);
      if (data.deadlineCalendar.version !== calendar.version || data.deadlineCalendar.anchorOn !== today) {
        return { error: "The signing date preview changed. Refresh the loan to use the current calendar." } as const;
      }
      const { signBy, ...basis } = disclosureSigningDeadline(calendar.rules, data.deadlineCalendar);
      if (signBy !== data.signBy) return { error: "Use the current calendar suggestion or choose a manual date." } as const;
      deadlineBasis = basis;
    }
    const { quote, applicationRevision, feeRevision } = source.source;
    if (data.applicationRevision !== applicationRevision || data.feeRevision !== feeRevision ||
      data.runId !== quote.runId || data.offerId !== quote.offerId) return { error: "The application, quote, or fee worksheet changed. Refresh the loan first." } as const;
    const draft = applicationDraft.parse(JSON.parse(source.draft));
    const template = data.template ? selectedDisclosureTemplate(db, data.template, disclosureTemplateMatch(draft)) : undefined;
    if (data.template && !template) return { error: disclosureTemplateChanged } as const;
    if (template && (template.documents.length !== data.documents.length || template.documents.some((item) => !data.documents.includes(item)))) {
      return { error: "The document selection differs from this template. Choose the template again or use manual selection." } as const;
    }
    let changeReview: DisclosurePackage["changeReview"] = null;
    if (latest && (latest.reviewReason || !matchesSource(latest, source.source))) {
      if (!data.revisionNote) return { error: "Record an internal change-review note before preparing the revised package." } as const;
      if (data.reviewedPackageRevision !== latest.revision) return { error: "The package changed. Refresh the loan and review it again." } as const;
      changeReview = { fromVersion: latest.version, reason: latest.reviewReason ?? "Application or quote changed",
        at: now, actor: staff?.name ?? "Demo staff", note: data.revisionNote,
        changes: compareDisclosureTerms({ ...latest, quote: JSON.parse(latest.quote) }, source.source) };
    }
    const version = (latest?.version ?? 0) + 1;
    if (latest) {
      db.prepare("UPDATE disclosure_packages SET supersededAt = ?, revision = revision + 1 WHERE loanId = ? AND version = ?")
        .run(now, data.loanId, latest.version);
      completeTask(db, disclosureReviewPrefix, latest, now);
      completeTask(db, disclosureSigningPrefix, latest, now);
      completeTask(db, disclosureDeclinePrefix, latest, now);
      completeTask(db, disclosureIssuePrefix, latest, now);
      completeTask(db, disclosureClosingReviewPrefix, latest, now);
    }
    db.prepare(`INSERT INTO disclosure_packages (loanId, version, runId, offerId, applicationRevision, feeRevision,
      quote, documents, signers, preparedAt, preparedByEmail, signBy, changeReview, deadlineBasis, templateBasis) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(data.loanId, version, quote.runId, quote.offerId, applicationRevision, feeRevision, JSON.stringify(quote),
        JSON.stringify(template?.documents ?? data.documents), JSON.stringify(disclosureNames(draft)), now, staff?.email ?? null, data.signBy,
        changeReview ? JSON.stringify(changeReview) : null, deadlineBasis ? JSON.stringify(deadlineBasis) : null,
        template ? JSON.stringify(template.basis) : null);
    const replacement = { loanId: data.loanId, version };
    if (replacesConfirmedPackage(db, replacement)) {
      createTask(db, disclosureIssuePrefix, replacement, "Issue revised sample disclosure package", now);
    }
    if (changeReview) addApplicationActivity(db, data.loanId, `Reviewed sample disclosure changes from v${changeReview.fromVersion} for v${version} · ${changeReview.reason}.`, now);
    addApplicationActivity(db, data.loanId, `Prepared sample disclosure package v${version} · Fee worksheet v${feeRevision} · Signing target ${data.signBy} (${deadlineBasis
      ? `calendar v${deadlineBasis.version}` : "manual"})${template ? ` · ${template.basis.title} v${template.basis.revision}` : ""}.`, now);
    return { message: `Sample disclosure package v${version} prepared.` } as const;
  }
  if (!latest || latest.version !== data.version || latest.revision !== data.revision) {
    return { error: "The package changed. Refresh the loan and try again." } as const;
  }
  if (latest.reviewReason || !matchesSource(latest, source.source)) {
    return { error: "Review the current application and fees, then prepare a revised sample package." } as const;
  }
  if (data.type === "issueDisclosurePackage") {
    if (latest.issuedAt) return { error: "This sample package was already issued." } as const;
    if (latest.signBy < today) return { error: "Prepare a package with a current signing target before issuing it." } as const;
    const basis = storedDisclosureCalendarBasis(latest.deadlineBasis);
    if (basis && changedDisclosureTarget(basis, latest.signBy, currentDisclosureCalendar(db))) {
      return { error: "The deadline calendar moved this draft’s signing target. Prepare a revised package before issuing it." } as const;
    }
    db.prepare("UPDATE disclosure_packages SET issuedAt = ?, revision = revision + 1 WHERE loanId = ? AND version = ?")
      .run(now, data.loanId, latest.version);
    completeTask(db, disclosureIssuePrefix, latest, now);
    createTask(db, disclosureSigningPrefix, latest, "Check sample disclosure signatures", easternDayStart(latest.signBy));
    addApplicationActivity(db, data.loanId, `Issued sample disclosure package v${latest.version} in mock signing.`, now);
    return { message: "Sample package issued in mock signing." } as const;
  }
  const signers: DisclosureSigner[] = JSON.parse(latest.signers);
  const signer = signers.find(({ role }) => role === data.signer);
  if (!latest.issuedAt || !signer || signer.status !== "Pending" || signers.some(({ status }) => status === "Declined")) {
    return { error: "This signer has no pending action on the current sample package." } as const;
  }
  applyDisclosureResponse(db, latest, signers, signer, data.response, "Staff simulation", now);
  return { message: `Mock response recorded for the ${signer.role.toLowerCase()}.` } as const;
}
