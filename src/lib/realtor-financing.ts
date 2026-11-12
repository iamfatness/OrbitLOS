import { createHash } from "node:crypto";
import { easternDate } from "./client-retention";
import { approvedIncomeSql } from "./income-review-freshness";
import { activePreapprovalLoan } from "./preapproval-sharing";
import { borrowerRealtorFinancingInput, realtorFinancingTerms, realtorFinancingUnavailable, staffRealtorFinancingInput,
  type BorrowerRealtorFinancingView, type FinancingParticipant, type FinancingPermission, type RealtorFinancingRequest,
  type RealtorFinancingTerms, type SharedRealtorFinancing, type StaffRealtorFinancingView } from "./realtor-financing-model";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { accessEvent, loanAccess } from "./workspace-access";

type Candidate = {
  realtorId: string; realtorName: string; realtorTokenHash: string; terms: RealtorFinancingTerms; basis: string;
  participants: Array<{ participant: FinancingParticipant; tokenHash: string }>;
};
type RequestRow = Omit<RealtorFinancingRequest, "terms" | "permissions"> & { terms: string; loanId: string; basis: string; realtorId: string };
const unavailable = { error: realtorFinancingUnavailable, status: 404 } as const;
const changed = { error: "The financing summary changed. Refresh the current quote and permissions.", status: 409 } as const;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export const realtorFinancingReadyCandidateSql = `request.publishedAt IS NULL AND request.endedAt IS NULL
  AND EXISTS (SELECT 1 FROM realtor_financing_participants party WHERE party.requestId = request.id)
  AND NOT EXISTS (SELECT 1 FROM realtor_financing_participants party WHERE party.requestId = request.id
    AND NOT EXISTS (SELECT 1 FROM realtor_financing_decisions consent
      WHERE consent.requestId = party.requestId AND consent.participant = party.participant AND consent.decision = 'Approve'))`;

export const realtorFinancingSource = `JOIN applications app ON app.loanId = loan.id
  JOIN published_quotes quote ON quote.loanId = loan.id
  JOIN pricing_runs run ON run.id = quote.runId AND run.loanId = loan.id
  JOIN contacts partner ON partner.id = loan.partnerId AND partner.role = 'Realtor'
  JOIN realtor_portals portal ON portal.realtorId = partner.id
  LEFT JOIN joint_applications joint ON joint.loanId = loan.id
  LEFT JOIN past_client_profiles past ON past.loanId = loan.id LEFT JOIN closing_progress closing ON closing.loanId = loan.id`;
export const currentRealtorFinancingSql = `loan.purpose = 'Purchase' AND ${activePreapprovalLoan}
  AND app.submittedAt IS NOT NULL AND app.reviewedAt IS NOT NULL AND coalesce(app.correctionNote, '') = ''
  AND app.revokedAt IS NULL AND app.expiresAt > ? AND portal.expiresAt > ?
  AND (joint.loanId IS NULL OR (joint.revokedAt IS NULL AND joint.submittedAt IS NOT NULL AND joint.confirmedDemo = 1 AND joint.expiresAt > ?))
  AND json_extract(app.draft, '$.confirmedDemo') = 1 AND run.mode = 'mock'
  AND run.applicationRevision = app.revision AND quote.expiresOn >= ? AND quote.reviewReason IS NULL AND json_valid(quote.presentation)
  AND (run.incomeReviewRevision IS NULL OR EXISTS (${approvedIncomeSql("run.loanId", "run.incomeReviewRevision")}))`;
export const realtorFinancingDates = (now: string) => [now, now, now, easternDate(new Date(now))];

function currentCandidate(db: Store, loanId: string, now: string): Candidate | null {
  const row = db.prepare(`SELECT loan.contactId, loan.officerEmail, app.token AS borrowerToken, app.revision AS applicationRevision,
    joint.token AS jointToken, partner.id AS realtorId, partner.name AS realtorName, portal.token AS realtorToken,
    quote.runId, quote.offerId, quote.publishedAt, quote.presentation, quote.expiresOn, quote.reviewRevision,
    coalesce(json_extract(run.scenario, '$.nonAgency.program'), 'Conventional') AS program
    FROM loans loan ${realtorFinancingSource} WHERE loan.id = ? AND ${currentRealtorFinancingSql}`)
    .get(loanId, ...realtorFinancingDates(now));
  if (!row || typeof row.presentation !== "string") return null;
  const primary = JSON.parse(row.presentation)?.primary;
  if (!primary || primary.purpose !== "Purchase" || primary.runId !== row.runId || primary.offerId !== row.offerId ||
    typeof primary.loanAmount !== "number") return null;
  const terms = realtorFinancingTerms.safeParse({ program: row.program, termYears: primary.years,
    amountCents: Math.round(primary.loanAmount * 100), quoteExpiresOn: row.expiresOn });
  if (!terms.success) return null;
  const realtorTokenHash = hash(String(row.realtorToken));
  const participants: Candidate["participants"] = [{ participant: "Borrower", tokenHash: hash(String(row.borrowerToken)) }];
  if (row.jointToken) participants.push({ participant: "Co-borrower", tokenHash: hash(String(row.jointToken)) });
  const basis = hash(JSON.stringify([loanId, row.contactId, row.officerEmail, row.realtorId, row.realtorName, realtorTokenHash, participants,
    row.applicationRevision, row.runId, row.offerId, row.publishedAt, row.presentation, row.reviewRevision, terms.data]));
  return { realtorId: String(row.realtorId), realtorName: String(row.realtorName), realtorTokenHash, terms: terms.data, basis, participants };
}

function latestRequest(db: Store, loanId: string) {
  return db.prepare("SELECT * FROM realtor_financing_requests WHERE loanId = ? ORDER BY rowid DESC LIMIT 1").get(loanId) as RequestRow | undefined;
}

function requestPermissions(db: Store, requestId: string): RealtorFinancingRequest["permissions"] {
  return db.prepare(`SELECT participant.participant, decision.decision, decision.decidedAt
    FROM realtor_financing_participants participant
    LEFT JOIN realtor_financing_decisions decision ON decision.id = (
      SELECT id FROM realtor_financing_decisions WHERE requestId = participant.requestId AND participant = participant.participant
      ORDER BY rowid DESC LIMIT 1)
    WHERE participant.requestId = ? ORDER BY participant.participant`).all(requestId).map(row => ({
    participant: row.participant as FinancingParticipant,
    status: (row.decision ? { Approve: "Approved", Decline: "Declined", Revoke: "Revoked" }[String(row.decision)] : "Pending") as FinancingPermission,
    decidedAt: row.decidedAt === null ? null : String(row.decidedAt),
  }));
}

function closeRequest(db: Store, id: string, now: string, reason: string) {
  db.prepare("UPDATE realtor_financing_requests SET endedAt = ?, endReason = ? WHERE id = ? AND endedAt IS NULL").run(now, reason, id);
}

function everyBorrowerApproved(db: Store, requestId: string, candidate: Candidate) {
  const permissions = requestPermissions(db, requestId);
  return permissions.length === candidate.participants.length && permissions.every(party => party.status === "Approved");
}

export function readyRealtorFinancingId(db: Store, loanId: string, now: string) {
  const request = db.prepare(`SELECT request.id, request.basis FROM realtor_financing_requests request
    WHERE request.loanId = ? AND ${realtorFinancingReadyCandidateSql}`).get(loanId);
  if (!request) return null;
  const candidate = currentCandidate(db, loanId, now);
  const id = String(request.id);
  return candidate && candidate.basis === request.basis && everyBorrowerApproved(db, id, candidate) ? id : null;
}

function logAction(db: Store, staff: { name: string; email: string }, loanId: string, action: string, now: string) {
  accessEvent(db, staff, action, loanId, now);
  db.prepare("INSERT INTO activity (id, loanId, text, createdAt) VALUES (?, ?, ?, ?)")
    .run(crypto.randomUUID(), loanId, action, now);
}

export function workOnRealtorFinancing(db: Store, input: unknown, staff: WorkspaceStaff | null, brokerageId: string, clock = new Date()):
  { value: StaffRealtorFinancingView } | { error: string; status: number } {
  if (!staff?.brokerage.pilot || staff.brokerage.id !== brokerageId || staff.brokerage.role === "Processor") return unavailable;
  const parsed = staffRealtorFinancingInput.safeParse(input);
  if (!parsed.success) return { error: "Choose a valid financing summary action.", status: 400 };
  const data = parsed.data;
  const now = clock.toISOString();
  return db.transaction(() => {
    if (!loanAccess(db, staff, data.loanId)) return unavailable;
    const candidate = currentCandidate(db, data.loanId, now);
    const current = latestRequest(db, data.loanId);
    const view = (request: RequestRow | undefined, message?: string): { value: StaffRealtorFinancingView } => ({
      value: { preview: candidate ? { realtorName: candidate.realtorName, terms: candidate.terms, basis: candidate.basis } : null,
        blocked: candidate ? null : "Use an active fictional purchase loan with a reviewed 1003, active portal links, and a current dated sample quote.",
        request: request ? { id: request.id, realtorName: request.realtorName, terms: realtorFinancingTerms.parse(JSON.parse(request.terms)),
          requestedAt: request.requestedAt, requestedBy: request.requestedBy, publishedAt: request.publishedAt,
          publishedBy: request.publishedBy, endedAt: request.endedAt, endReason: request.endReason, permissions: requestPermissions(db, request.id) } : null,
        current: Boolean(candidate && request && !request.endedAt && request.basis === candidate.basis), ...(message ? { message } : {}) },
    });
    if (data.type === "read") return view(current);
    if (data.type === "request") {
      const previous = db.prepare("SELECT * FROM realtor_financing_requests WHERE id = ?").get(data.requestId) as RequestRow | undefined;
      if (previous) return previous.loanId === data.loanId && previous.basis === data.basis && previous.requestedBy === staff.email
        ? view(current, "Borrower permission request recorded.") : changed;
      if (!candidate || candidate.basis !== data.basis) return changed;
      if (current && !current.endedAt) {
        if (current.basis === candidate.basis) return { error: "A permission request is already open for this summary.", status: 409 };
        closeRequest(db, current.id, now, "Quote or portal access changed");
      }
      db.prepare(`INSERT INTO realtor_financing_requests (id, loanId, basis, realtorId, realtorName, terms, requestedAt, requestedBy)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(data.requestId, data.loanId, candidate.basis, candidate.realtorId,
        candidate.realtorName, JSON.stringify(candidate.terms), now, staff.email);
      const add = db.prepare("INSERT INTO realtor_financing_participants (requestId, participant, tokenHash) VALUES (?, ?, ?)");
      for (const party of candidate.participants) add.run(data.requestId, party.participant, party.tokenHash);
      logAction(db, staff, data.loanId, "Requested permission to share a sample financing summary", now);
      return view(latestRequest(db, data.loanId), "Borrower permission requested in the portal.");
    }
    if (!current || current.id !== data.requestId) return changed;
    if (data.type === "withdraw") {
      if (!current.endedAt) {
        closeRequest(db, current.id, now, "Withdrawn by loan team");
        logAction(db, staff, data.loanId, "Withdrew sample financing summary access", now);
      }
      return view(latestRequest(db, data.loanId), "Realtor access withdrawn.");
    }
    if (!candidate || current.basis !== data.basis || candidate.basis !== data.basis || current.endedAt) return changed;
    if (!everyBorrowerApproved(db, current.id, candidate)) {
      return { error: "Each borrower must approve this summary in their own portal before you can publish it.", status: 409 };
    }
    if (!current.publishedAt) {
      db.prepare("UPDATE realtor_financing_requests SET publishedAt = ?, publishedBy = ? WHERE id = ?").run(now, staff.email, current.id);
      logAction(db, staff, data.loanId, "Published approved sample financing summary to the realtor portal", now);
    }
    return view(latestRequest(db, data.loanId), "Sample financing summary published.");
  });
}

export function borrowerRealtorFinancing(db: Store, input: unknown, clock = new Date()):
  { value: BorrowerRealtorFinancingView } | { error: string; status: number } {
  const parsed = borrowerRealtorFinancingInput.safeParse(input);
  if (!parsed.success) return unavailable;
  const data = parsed.data;
  const now = clock.toISOString();
  return db.transaction(() => {
    const identity = db.prepare(`SELECT loanId, 'Borrower' AS participant FROM applications WHERE token = ? AND expiresAt > ? AND revokedAt IS NULL
      UNION ALL SELECT loanId, 'Co-borrower' AS participant FROM joint_applications WHERE token = ? AND expiresAt > ? AND revokedAt IS NULL`)
      .get(data.token, now, data.token, now);
    if (!identity) return unavailable;
    const loanId = String(identity.loanId);
    const participant = identity.participant as FinancingParticipant;
    const tokenHash = hash(data.token);
    const current = latestRequest(db, loanId);
    const view = () => ({ value: { request: readBorrowerFinancingRequest(db, loanId, participant, data.token, now) } });
    if (data.type === "read") return view();
    const prior = db.prepare(`SELECT decision.requestId, decision.participant, decision.decision, request.loanId, party.tokenHash
      FROM realtor_financing_decisions decision JOIN realtor_financing_requests request ON request.id = decision.requestId
      JOIN realtor_financing_participants party ON party.requestId = decision.requestId AND party.participant = decision.participant
      WHERE decision.id = ?`).get(data.operationId);
    if (prior) return prior.loanId === loanId && prior.requestId === data.requestId && prior.participant === participant &&
      prior.decision === data.decision && prior.tokenHash === tokenHash ? view() : unavailable;
    const selected = view().value.request;
    if (!selected || current?.id !== data.requestId || selected.id !== data.requestId) return changed;
    if (data.decision === "Revoke" ? selected.permission !== "Approved" : selected.permission !== "Pending") return changed;
    db.prepare("INSERT INTO realtor_financing_decisions (id, requestId, participant, decision, decidedAt) VALUES (?, ?, ?, ?, ?)")
      .run(data.operationId, data.requestId, participant, data.decision, now);
    const action = { Approve: "approved", Decline: "declined", Revoke: "revoked" }[data.decision];
    if (data.decision !== "Approve") closeRequest(db, data.requestId, now, `${participant} ${action} permission`);
    logAction(db, { name: participant, email: participant }, loanId, `${participant} ${action} sample financing summary permission`, now);
    return view();
  });
}

export function readBorrowerFinancingRequest(db: Store, loanId: string, participant: FinancingParticipant, token: string, now: string):
  BorrowerRealtorFinancingView["request"] {
  const request = latestRequest(db, loanId);
  if (!request || request.endedAt || !db.prepare(`SELECT 1 FROM realtor_financing_participants
    WHERE requestId = ? AND participant = ? AND tokenHash = ?`).get(request.id, participant, hash(token))) return null;
  const candidate = currentCandidate(db, loanId, now);
  if (!candidate || request.basis !== candidate.basis) return null;
  const permission = requestPermissions(db, request.id).find(party => party.participant === participant);
  return permission ? { id: request.id, realtorName: request.realtorName, terms: candidate.terms,
    publishedAt: request.publishedAt, permission: permission.status } : null;
}

export function readSharedRealtorFinancing(db: Store, loanIds: string[], realtorId: string, token: string, now: string) {
  const summaries = new Map<string, SharedRealtorFinancing>();
  if (!loanIds.length) return summaries;
  const tokenHash = hash(token);
  const requests = db.prepare(`SELECT id, loanId, basis, publishedAt FROM realtor_financing_requests
    WHERE realtorId = ? AND loanId IN (SELECT value FROM json_each(?)) AND publishedAt IS NOT NULL AND endedAt IS NULL`)
    .all(realtorId, JSON.stringify(loanIds));
  for (const request of requests) {
    const loanId = String(request.loanId);
    const candidate = currentCandidate(db, loanId, now);
    if (!candidate || candidate.basis !== request.basis || candidate.realtorTokenHash !== tokenHash) continue;
    if (everyBorrowerApproved(db, String(request.id), candidate)) {
      summaries.set(loanId, { ...candidate.terms, publishedAt: String(request.publishedAt) });
    }
  }
  return summaries;
}
