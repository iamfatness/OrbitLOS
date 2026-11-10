import { addApplicationActivity, getApplication } from "./applications";
import { applicationDraft, type ApplicationDraft } from "./application-model";
import { demoBrokerageId } from "./brokerage-model";
import { easternDate, easternDayStart } from "./client-retention";
import { changedDisclosureTarget, currentDisclosureCalendar } from "./disclosure-calendar";
import { disclosureSigningDeadline, storedDisclosureCalendarBasis, type DisclosureCalendarBasis } from "./disclosure-calendar-model";
import { disclosureTemplateChanged, disclosureTemplateMatch, type DisclosureTemplateBasis } from "./disclosure-template-model";
import { disclosureTemplatesForLoan, selectedDisclosureTemplate } from "./disclosure-templates";
import { disclosureDeclinePrefix, disclosureDeclineTaskTitle, disclosureReviewPrefix, disclosureSigningPrefix, type BorrowerDisclosure, type BorrowerDisclosureResponse,
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
        ...row, signers: JSON.parse(String(signers)), changeReview: changeReview ? JSON.parse(String(changeReview)) : null,
        ...(feeAllocations.length ? { feeAllocations } : {}),
        current: !!(latest && current.source && !latest.reviewReason && !latest.supersededAt &&
          row.version === latest.version && row.revision === latest.revision && matchesSource(latest, current.source)),
      };
    }) as ClosingDisclosureReview[];
  return { source: current.source ?? null, unavailable: current.error ?? null, closingReviews, suggestedDeadline, draftTargetChanged, templateOptions, packages: rows
    .map((item) => ({
      version: item.version, revision: item.revision, applicationRevision: item.applicationRevision, feeRevision: item.feeRevision,
      preparedAt: item.preparedAt, issuedAt: item.issuedAt, signBy: item.signBy, supersededAt: item.supersededAt, reviewReason: item.reviewReason,
      documents: JSON.parse(item.documents), signers: JSON.parse(item.signers), quote: JSON.parse(item.quote),
      deadlineBasis: storedDisclosureCalendarBasis(item.deadlineBasis),
      ...(item.templateBasis ? { templateBasis: JSON.parse(item.templateBasis) as DisclosureTemplateBasis } : {}),
      declineFollowUp: item.declineFollowUp ? JSON.parse(item.declineFollowUp) : null,
      changeReview: item.changeReview ? JSON.parse(item.changeReview) : null,
    })) };
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

export function flagDisclosureReview(db: Store, loanId: string, reason: string, now: string, feeSource?: { runId: string; offerId: string; feeRevision: number }) {
  const [item] = packageRows(db, loanId, 1);
  if (!item || item.reviewReason || (feeSource && (item.runId !== feeSource.runId || item.offerId !== feeSource.offerId ||
    item.feeRevision === feeSource.feeRevision))) return;
  db.prepare("UPDATE disclosure_packages SET reviewReason = ?, revision = revision + 1 WHERE loanId = ? AND version = ?")
    .run(reason, loanId, item.version);
  completeTask(db, disclosureSigningPrefix, item, now);
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
  const existing = db.prepare("SELECT 1 FROM closing_disclosure_reviews WHERE loanId = ? AND version = ? AND revision = ?")
    .get(loanId, version, revision);
  if (existing) return { message: "This sample package is already confirmed for the closing handoff." } as const;
  db.prepare("INSERT INTO closing_disclosure_reviews (loanId, version, revision, reviewedAt, actor) VALUES (?, ?, ?, ?, ?)")
    .run(loanId, version, revision, now, staff?.name ?? "Demo staff");
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
  if (response === "Declined" || signers.every(({ status }) => status === "Signed")) completeTask(db, disclosureSigningPrefix, item, now);
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
        at: now, actor: staff?.name ?? "Demo staff", note: data.revisionNote };
    }
    const version = (latest?.version ?? 0) + 1;
    if (latest) {
      db.prepare("UPDATE disclosure_packages SET supersededAt = ?, revision = revision + 1 WHERE loanId = ? AND version = ?")
        .run(now, data.loanId, latest.version);
      completeTask(db, disclosureReviewPrefix, latest, now);
      completeTask(db, disclosureSigningPrefix, latest, now);
      completeTask(db, disclosureDeclinePrefix, latest, now);
    }
    db.prepare(`INSERT INTO disclosure_packages (loanId, version, runId, offerId, applicationRevision, feeRevision,
      quote, documents, signers, preparedAt, signBy, changeReview, deadlineBasis, templateBasis) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(data.loanId, version, quote.runId, quote.offerId, applicationRevision, feeRevision, JSON.stringify(quote),
        JSON.stringify(template?.documents ?? data.documents), JSON.stringify(disclosureNames(draft)), now, data.signBy,
        changeReview ? JSON.stringify(changeReview) : null, deadlineBasis ? JSON.stringify(deadlineBasis) : null,
        template ? JSON.stringify(template.basis) : null);
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
