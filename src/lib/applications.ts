import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { applicationDraft, applicationIssues, applicationSteps, blankApplication, manualHandoffOutcomes, splitLegacyAddress, type AddressLocation, type ApplicationDraft, type BorrowerResult, type StaffApplication } from "./application-model";
import type { Store } from "./store";
import { createApplicationFollowUps } from "./tasks";
import { createMilestoneDrafts } from "./communications";
import { lenderDetailsSchema, normalizeUrla } from "./urla";
import { needsBorrowerDocument, type BorrowerLoanStatus, type DocumentRequest } from "./document-model";
import { portalToken, portalTokenPattern } from "./brokerage-model";
import { quoteMatchesApplication, type BorrowerQuote } from "./pricing-model";
import { pdfColumns } from "./document-files-model";
import { accessEvent } from "./workspace-access";
import { loanAuditSnapshot, recordLoanAudit } from "./loan-audit";
import { zipCityState } from "./zip-city-state";
import { approvedSecondReview } from "./application-review-checkpoint";

type ApplicationRow = Omit<StaffApplication, "draft" | "lender" | "manualHandoff" | "versions" | "previousAnswers" | "secondReviewApproved"> & { draft: string; step: number };
type BorrowerStatusRow = Pick<ApplicationRow, "loanId" | "submittedAt" | "reviewedAt" | "correctionNote" | "revision">;

export function getApplication(db: Store, loanId: string) {
  return db.prepare("SELECT * FROM applications WHERE loanId = ?").get(loanId) as ApplicationRow | undefined;
}

export function staffApplications(db: Store, loanId?: string): StaffApplication[] {
  const filter = loanId ? " WHERE loanId = ?" : "";
  const args = loanId ? [loanId] : [];
  const lender = new Map(db.prepare(`SELECT * FROM application_lender_details${filter}`).all(...args).map((item) => [item.loanId, {
    details: lenderDetailsSchema.parse(JSON.parse(String(item.details))), revision: Number(item.revision),
  }]));
  const handoffs = new Map<string, NonNullable<StaffApplication["manualHandoff"]>>();
  for (const event of db.prepare(`SELECT event.loanId, event.outcome FROM application_handoff_events event
    JOIN activity ON activity.id = event.activityId
    JOIN applications app ON app.loanId = event.loanId AND app.revision = event.applicationRevision AND app.reviewedAt IS NOT NULL
    LEFT JOIN application_lender_details details ON details.loanId = event.loanId
    WHERE event.lenderRevision = coalesce(details.revision, 0)${loanId ? " AND event.loanId = ?" : ""} ORDER BY activity.rowid DESC`).all(...args)) {
    const loanId = String(event.loanId);
    const handoff = handoffs.get(loanId) ?? { exportPrepared: false, outcome: null };
    if (event.outcome === "Export prepared") handoff.exportPrepared = true;
    else handoff.outcome ??= manualHandoffOutcomes.find((outcome) => outcome === event.outcome) ?? null;
    handoffs.set(loanId, handoff);
  }
  return db.prepare(`SELECT app.*, CASE WHEN app.submittedAt IS NOT NULL THEN ${approvedSecondReview} ELSE 0 END AS secondReviewApproved
    FROM applications app${filter}`).all(...args).map((value) => {
    const row = value as ApplicationRow & { secondReviewApproved: number };
    const prior = db.prepare(`SELECT draft FROM application_versions WHERE loanId = ? AND revision < ?
      ORDER BY reviewedAt IS NOT NULL DESC, revision DESC LIMIT 1`).get(row.loanId, row.revision);
    const versions = db.prepare("SELECT revision, submittedAt, reviewedAt, uwmReceipt, uwmSentAt FROM application_versions WHERE loanId = ? ORDER BY revision DESC")
      .all(row.loanId).map((item) => ({
        revision: Number(item.revision), submittedAt: String(item.submittedAt), reviewedAt: item.reviewedAt as string | null,
        uwmReceipt: typeof item.uwmReceipt === "string" && typeof item.uwmSentAt === "string"
          ? { reference: item.uwmReceipt, sentAt: item.uwmSentAt } : null,
      }));
    return {
      loanId: row.loanId, token: row.token, expiresAt: row.expiresAt, revokedAt: row.revokedAt, updatedAt: row.updatedAt,
      submittedAt: row.submittedAt, reviewedAt: row.reviewedAt, secondReviewApproved: Boolean(row.secondReviewApproved), uwmReference: row.uwmReference,
      draft: row.submittedAt ? applicationDraft.parse(JSON.parse(row.draft)) : null,
      lender: lender.get(row.loanId) ?? null,
      manualHandoff: handoffs.get(row.loanId),
      revision: row.revision, correctionNote: row.correctionNote, versions,
      previousAnswers: prior ? applicationDraft.parse(JSON.parse(String(prior.draft))) : null,
    };
  });
}

export function saveApplicationVersion(db: Store, row: ApplicationRow) {
  if (!row.submittedAt) return;
  db.prepare(`INSERT INTO application_versions (loanId, revision, draft, submittedAt, reviewedAt) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (loanId, revision) DO UPDATE SET reviewedAt = excluded.reviewedAt`)
    .run(row.loanId, row.revision, row.draft, row.submittedAt, row.reviewedAt);
}

export function addApplicationActivity(db: Store, loanId: string, text: string, now: string) {
  db.prepare("INSERT INTO activity (id, loanId, text, createdAt) VALUES (?, ?, ?, ?)")
    .run(crypto.randomUUID(), loanId, text, now);
}

function fillPropertyLocality(location: AddressLocation): AddressLocation {
  if (location.city && location.state) return location;
  const locality = zipCityState(location.zip);
  if (!locality) return location;
  return { ...location, city: location.city || locality.city, state: location.state || locality.state };
}

export function startApplication(db: Store, loanId: string, now: string, brokerageId?: string,
  intake?: { email?: string; phone?: string; propertyZip?: string; propertyAddress?: string }) {
  const loan = db.prepare(`SELECT loans.address, loans.amount, loans.purpose, contacts.name, contacts.email, contacts.phone
    FROM loans JOIN contacts ON contacts.id = loans.contactId WHERE loans.id = ?`).get(loanId);
  if (!loan) return false;
  const existing = getApplication(db, loanId);
  if (existing && !existing.revokedAt && existing.expiresAt > now) return true;

  const token = portalToken(brokerageId);
  const expiresAt = new Date(Date.parse(now) + 7 * 86_400_000).toISOString();
  if (existing) {
    db.prepare("UPDATE applications SET token = ?, expiresAt = ?, revokedAt = NULL WHERE loanId = ?").run(token, expiresAt, loanId);
    return true;
  }
  const property = splitLegacyAddress(intake?.propertyAddress ?? String(loan.address));
  const zip = property.location.zip || intake?.propertyZip || "";
  const email = intake?.email || String(loan.email);
  const draft: ApplicationDraft = {
    ...blankApplication(), borrowerName: String(loan.name), propertyAddress: property.street,
    propertyLocation: fillPropertyLocality({ ...property.location, zip }),
    email: email.length <= 160 ? email : "", phone: intake?.phone || String(loan.phone),
    loanAmount: Number(loan.amount) > 0 ? String(loan.amount) : "",
    purpose: loan.purpose === "Refinance" ? "Refinance" : "Purchase",
  };
  db.prepare("INSERT INTO applications (loanId, token, expiresAt, draft, updatedAt) VALUES (?, ?, ?, ?, ?)")
    .run(loanId, token, expiresAt, JSON.stringify(draft), now);
  addApplicationActivity(db, loanId, "Demo 1003 link created.", now);
  return true;
}

const token = z.string().regex(portalTokenPattern);
const write = {
  token, draft: applicationDraft,
  revision: z.number().int().min(0),
  step: z.number().int().min(0).max(applicationSteps.length - 1),
};
const borrowerCommand = z.discriminatedUnion("type", [
  z.object({ type: z.literal("read"), token }),
  z.object({ type: z.literal("status"), token }),
  z.object({ type: z.literal("save"), ...write }),
  z.object({ type: z.literal("submit"), ...write }),
  z.object({ type: z.literal("attachSample"), token, requestId: z.uuid(), revision: z.number().int().nonnegative(), statusOnly: z.boolean().optional() }),
]);
const borrowerLink = "FROM applications WHERE token = ? AND expiresAt > ? AND revokedAt IS NULL";
const borrowerLinkUnavailable = { status: 404, error: "This application link is invalid or expired. Ask your loan officer for a new link." };

function readBorrowerLoanStatus(db: Store, row: BorrowerStatusRow): BorrowerLoanStatus | null {
  const loan = row.submittedAt ? db.prepare("SELECT stage, stageSince FROM loans WHERE id = ?").get(row.loanId) : null;
  const published = loan && !row.correctionNote && db.prepare(`SELECT quote.product, quote.rate, quote.principalAndInterest,
    quote.quotedAt, quote.publishedAt, quote.presentation FROM published_quotes quote
    JOIN pricing_runs run ON run.id = quote.runId AND run.loanId = quote.loanId
    WHERE quote.loanId = ? AND run.applicationRevision = ?`).get(row.loanId, row.revision);
  const presentation = published && published.presentation ? JSON.parse(String(published.presentation)) as BorrowerQuote["presentation"] : null;
  const currentAlternatives = presentation?.alternatives.every((option) => {
    const run = db.prepare("SELECT applicationRevision FROM pricing_runs WHERE id = ? AND loanId = ?").get(option.runId, row.loanId);
    return run && quoteMatchesApplication(run.applicationRevision, row);
  }) ?? true;
  return loan ? {
    stage: loan.stage as BorrowerLoanStatus["stage"], stageSince: String(loan.stageSince), reviewed: Boolean(row.reviewedAt),
    documents: db.prepare(`SELECT requests.id, kind, instructions, status, replacementNote, submittedAt, revision, dueOn, ${pdfColumns()}
      FROM document_requests requests LEFT JOIN document_files files ON files.requestId = requests.id
      WHERE loanId = ? ORDER BY requestedAt, requests.id`).all(row.loanId).map((item) => ({ ...item }) as unknown as DocumentRequest),
    quote: published && currentAlternatives ? { ...published, presentation } as unknown as BorrowerQuote : null,
  } : null;
}

function borrowerResult(db: Store, row: ApplicationRow): BorrowerResult {
  const draft = applicationDraft.parse(JSON.parse(row.draft));
  if (!row.submittedAt) draft.propertyLocation = fillPropertyLocality(draft.propertyLocation);
  return { application: {
    draft,
    step: row.step, revision: row.revision, updatedAt: row.updatedAt, submittedAt: row.submittedAt,
    loanStatus: readBorrowerLoanStatus(db, row),
    correctionNote: row.correctionNote || undefined,
  } };
}

function attachBorrowerSample(db: Store, row: BorrowerStatusRow, data: { requestId: string; revision: number }, allowSample: boolean, now: string) {
  if (!allowSample) return { status: 409, error: "Use the verified PDF upload for this checklist." };
  if (!row.submittedAt) return { status: 409, error: "Submit your application to open the document checklist." };
  const request = db.prepare("SELECT kind, status, revision FROM document_requests WHERE id = ? AND loanId = ?")
    .get(data.requestId, row.loanId);
  if (!request) return { status: 404, error: "This document request is unavailable." };
  if (db.prepare("SELECT 1 FROM document_files WHERE requestId = ? AND (objectId IS NOT NULL OR pendingUntil > ?)").get(data.requestId, Date.parse(now))) {
    return { status: 409, error: "Continue with the PDF upload for this request." };
  }
  if (request.status === "Received" && request.revision === data.revision + 1) return null;
  if (request.revision !== data.revision || !needsBorrowerDocument(request.status as DocumentRequest["status"])) {
    return { status: 409, error: "This document request changed. Refresh status before attaching a sample." };
  }
  db.prepare("UPDATE document_requests SET status = 'Received', submittedAt = ?, revision = revision + 1 WHERE id = ?")
    .run(now, data.requestId);
  addApplicationActivity(db, row.loanId, `Sample document received · ${request.kind}`, now);
  return null;
}

export function borrowerCommandResult(db: Store, input: unknown, allowSample = true, pilot = false): BorrowerResult {
  const parsed = borrowerCommand.safeParse(input);
  if (!parsed.success) return { status: 400, error: "Check the length of your answers and use valid amounts, then try again." };
  const data = parsed.data;
  const now = new Date().toISOString();
  return db.transaction(() => {
    if (data.type === "status" || (data.type === "attachSample" && data.statusOnly)) {
      const row = db.prepare(`SELECT loanId, submittedAt, reviewedAt, correctionNote, revision ${borrowerLink}`)
        .get(data.token, now) as BorrowerStatusRow | undefined;
      if (!row) return borrowerLinkUnavailable;
      if (!row.submittedAt) return { statusView: { kind: "resume" } };
      if (data.type === "attachSample") {
        const failure = attachBorrowerSample(db, row, data, allowSample, now);
        if (failure) return failure;
      }
      const loanStatus = readBorrowerLoanStatus(db, row);
      return loanStatus ? { statusView: { kind: "status", submittedAt: row.submittedAt, loanStatus } } : borrowerLinkUnavailable;
    }
    const row = db.prepare(`SELECT * ${borrowerLink}`).get(data.token, now) as ApplicationRow | undefined;
    if (!row) return borrowerLinkUnavailable;
    if (data.type === "read") return borrowerResult(db, row);
    if (data.type === "attachSample") {
      return attachBorrowerSample(db, row, data, allowSample, now) ?? borrowerResult(db, row);
    }
    const submitted = data.type === "submit";
    const alreadySubmitted = { status: 409, error: "This application has been submitted. Reopen the link to see your loan status." };
    if (row.submittedAt && (!submitted || row.revision !== data.revision + 1 || row.step !== data.step)) return alreadySubmitted;
    if (!row.submittedAt && row.revision !== data.revision) {
      return { status: 409, error: "This application was updated in another tab. Reopen the link to continue from the latest saved draft." };
    }

    const normalized = normalizeUrla(data.draft.urla, false);
    if (normalized.issues.length) return { status: 422, error: "Use a fictional tax ID in the format 000-00-1234 and only four digits for account references." };
    const draft = { ...data.draft, urla: normalized.details };
    const work = draft.urla.primary.work;
    if (work.fields.hasJobs || work.fields.hasIncome) {
      const jobs = work.fields.hasJobs === "Yes" ? work.groups.jobs ?? [] : [];
      const current = jobs.filter((job) => job.status === "Current");
      const incomeKeys = ["base", "overtime", "bonus", "commission", "military", "other", "business"];
      const other = work.fields.hasIncome === "Yes" ? work.groups.income ?? [] : [];
      const amounts = [...current.flatMap((job) => incomeKeys.map((key) => job[key])), ...other.map((item) => item.monthly)];
      const monthlyIncome = amounts.reduce((total, item) => total + (Number(item) || 0), 0);
      draft.employer = current[0]?.employer?.slice(0, 160) ?? "";
      draft.monthlyIncome = Math.min(1_000_000_000, Math.max(0, monthlyIncome)).toFixed(2);
    }
    const serializedDraft = JSON.stringify(draft);
    if (row.submittedAt) {
      return isDeepStrictEqual(JSON.parse(serializedDraft), JSON.parse(row.draft)) ? borrowerResult(db, row) : alreadySubmitted;
    }
    if (submitted) {
      const issues = applicationIssues(draft);
      if (issues.length) return { status: 422, error: `Complete these items before submitting: ${issues.join("; ")}.` };
    }
    const auditBefore = submitted ? loanAuditSnapshot(db, row.loanId) : null;
    const next: ApplicationRow = {
      ...row, draft: serializedDraft, step: data.step, revision: row.revision + 1,
      updatedAt: now, submittedAt: submitted ? now : null, correctionNote: submitted ? "" : row.correctionNote,
    };
    db.prepare("UPDATE applications SET draft = ?, step = ?, revision = ?, updatedAt = ?, submittedAt = ?, correctionNote = ? WHERE loanId = ?")
      .run(next.draft, next.step, next.revision, next.updatedAt, next.submittedAt, next.correctionNote, next.loanId);
    if (submitted) {
      saveApplicationVersion(db, next);
      const { unit, city, state, zip } = draft.propertyLocation;
      const propertyPending = draft.purpose === "Purchase" && draft.urla.property.fields.propertyPending === "Yes";
      const locality = `${city}, ${state.toUpperCase()} ${zip}`;
      const street = [draft.propertyAddress, unit].filter(Boolean).join(", ");
      const address = propertyPending ? "" : `${street.slice(0, 238 - locality.length).trimEnd()}, ${locality}`;
      db.prepare(`UPDATE loans SET
        stage = CASE WHEN disposition = 'Active' AND stage IN ('Lead', 'Pre-qual') THEN 'Application' ELSE stage END,
        stageSince = CASE WHEN disposition = 'Active' AND stage IN ('Lead', 'Pre-qual') THEN ? ELSE stageSince END,
        address = CASE WHEN trim(address) = '' THEN ? ELSE address END,
        amount = CASE WHEN amount = 0 THEN ? ELSE amount END
        WHERE id = ?`).run(now, address, Math.round(Number(draft.loanAmount)), row.loanId);
      createApplicationFollowUps(db, row.loanId);
      if (row.correctionNote) {
        db.prepare(`INSERT INTO tasks (id, loanId, title, dueAt) VALUES (?, ?, 'Review corrected 1003', ?)
          ON CONFLICT(id) DO NOTHING`).run(`application-correction:${row.loanId}:${next.revision}`, row.loanId, new Date(Date.parse(now) + 86_400_000).toISOString());
      }
      createMilestoneDrafts(db, row.loanId, "Application received", now);
      addApplicationActivity(db, row.loanId, row.correctionNote ? "Corrected 1003 received." : "Demo 1003 received. Follow-up task created for the loan officer.", now);
      recordLoanAudit(db, row.loanId, "Borrower", "Submitted 1003", now, auditBefore);
      if (pilot) accessEvent(db, { name: "Borrower", email: "Borrower" }, "Pilot 1003 submitted", row.loanId, now);
    }
    return borrowerResult(db, next);
  });
}
