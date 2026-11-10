import { addApplicationActivity, getApplication } from "./applications";
import { applicationDraft } from "./application-model";
import { demoBrokerageId } from "./brokerage-model";
import { easternDate, easternDayStart } from "./client-retention";
import { disclosureReviewPrefix, disclosureSigningPrefix, type BorrowerDisclosure, type BorrowerDisclosureResponse,
  type DisclosureCommand, type DisclosurePackage, type DisclosureSigner,
  type DisclosureSource, type DisclosureWork } from "./disclosure-model";
import { quoteFeeWorksheet, quoteSnapshot } from "./quote-worksheet-store";
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
  return { source, draft: app.draft } as const;
}

type PackageRow = Omit<DisclosurePackage, "documents" | "signers" | "quote"> & {
  loanId: string; runId: string; offerId: string; documents: string; signers: string; quote: string;
};

function packageRows(db: Store, loanId: string, limit: number) {
  return db.prepare("SELECT * FROM disclosure_packages WHERE loanId = ? ORDER BY version DESC LIMIT ?")
    .all(loanId, limit) as unknown as PackageRow[];
}

export function readDisclosureWork(db: Store, loanId: string): DisclosureWork {
  const current = disclosureSource(db, loanId);
  return { source: current.source ?? null, unavailable: current.error ?? null, packages: packageRows(db, loanId, 6)
    .map((item) => ({
      version: item.version, revision: item.revision, applicationRevision: item.applicationRevision, feeRevision: item.feeRevision,
      preparedAt: item.preparedAt, issuedAt: item.issuedAt, signBy: item.signBy, supersededAt: item.supersededAt, reviewReason: item.reviewReason,
      documents: JSON.parse(item.documents), signers: JSON.parse(item.signers), quote: JSON.parse(item.quote),
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

function disclosureNames(draft: string): DisclosureSigner[] {
  const application = applicationDraft.parse(JSON.parse(draft));
  const primary: DisclosureSigner = { role: "Borrower", name: application.borrowerName, status: "Pending", actedAt: null, receipt: null };
  const joint = application.urla.additional[0]?.identity.fields.name?.trim();
  return joint ? [primary, { ...primary, role: "Co-borrower", name: joint }] : [primary];
}

function activeDisclosureLoan(db: Store, loanId: string) {
  const loan = db.prepare("SELECT disposition, stage FROM loans WHERE id = ?").get(loanId);
  return loan?.disposition === "Active" && loan.stage !== "Funded" && loan.stage !== "Closed";
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
      { closingCosts: estimate.closingCosts, cashToClose: estimate.cashToClose, items: estimate.inputs.fees } : null,
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
  const source = disclosureSource(db, data.loanId);
  if (!source.source) return { error: source.error } as const;
  const today = easternDate(new Date(now));
  if (data.type === "prepareDisclosurePackage") {
    if ((latest?.version ?? null) !== data.previousVersion) return { error: "The package changed. Refresh the loan and try again." } as const;
    if (data.signBy < today) return { error: "Choose a signing target of today or later." } as const;
    const { quote, applicationRevision, feeRevision } = source.source;
    if (data.applicationRevision !== applicationRevision || data.feeRevision !== feeRevision ||
      data.runId !== quote.runId || data.offerId !== quote.offerId) return { error: "The application, quote, or fee worksheet changed. Refresh the loan first." } as const;
    const version = (latest?.version ?? 0) + 1;
    if (latest) {
      db.prepare("UPDATE disclosure_packages SET supersededAt = ?, revision = revision + 1 WHERE loanId = ? AND version = ?")
        .run(now, data.loanId, latest.version);
      completeTask(db, disclosureReviewPrefix, latest, now);
      completeTask(db, disclosureSigningPrefix, latest, now);
    }
    db.prepare(`INSERT INTO disclosure_packages (loanId, version, runId, offerId, applicationRevision, feeRevision,
      quote, documents, signers, preparedAt, signBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(data.loanId, version, quote.runId, quote.offerId, applicationRevision, feeRevision, JSON.stringify(quote),
        JSON.stringify(data.documents), JSON.stringify(disclosureNames(source.draft)), now, data.signBy);
    addApplicationActivity(db, data.loanId, `Prepared sample disclosure package v${version} · Fee worksheet v${feeRevision}.`, now);
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
