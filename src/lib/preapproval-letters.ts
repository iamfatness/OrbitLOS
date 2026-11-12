import { createHash } from "node:crypto";
import { applicationDraft, applicationIssues, type ApplicationDraft } from "./application-model";
import { handoffCheckpointError } from "./application-review-checkpoint";
import { demoBrokerageId } from "./brokerage-model";
import { easternDate } from "./client-retention";
import { preapprovalLetterPdf } from "./preapproval-letter-pdf";
import { preapprovalAmount, preapprovalRequest, preapprovalUnavailable, type PreapprovalLetter, type PreapprovalPage, type PreapprovalResult } from "./preapproval-model";
import { activePreapprovalLoan, changePreapprovalShare, preapprovalShareStates } from "./preapproval-sharing";
import { shiftReportDate } from "./report-date-range";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { accessEvent, loanAccess } from "./workspace-access";
import { preapprovalTemplateChanged, preapprovalTemplateSnapshot } from "./preapproval-template-model";
import { availablePreapprovalTemplates, resolvePreapprovalTemplate, workOnPreapprovalTemplates } from "./preapproval-templates";
import { decidePreapprovalReview, preapprovalReviewReceipt, readPreapprovalPolicy, workOnPreapprovalPolicy } from "./preapproval-policy";

const pageSize = 5;
type File = { purpose: string; active: number; draft: string | null; revision: number | null;
  submittedAt: string | null; reviewedAt: string | null; correctionNote: string | null };
type IssueTerms = Exclude<PreapprovalPage["issue"], { blocked: string }> & { draft: ApplicationDraft };

function issueTerms(db: Store, loanId: string, file: File, today: string, maxAmountCents: number | null, maxExpiryDays: number): IssueTerms | { blocked: string } {
  if (file.purpose !== "Purchase") return { blocked: "Sample preapproval letters are available on purchase loans." };
  if (!file.active) return { blocked: "Open an active purchase loan to issue a sample letter." };
  if (!file.draft || file.revision === null || !file.submittedAt || !file.reviewedAt || file.correctionNote) {
    return { blocked: "Review the current submitted 1003 to issue a sample letter." };
  }
  const parsed = applicationDraft.safeParse(JSON.parse(file.draft));
  if (!parsed.success || parsed.data.purpose !== "Purchase" || applicationIssues(parsed.data).length > 0) {
    return { blocked: "Complete and review the fictional purchase 1003 before issuing a sample letter." };
  }
  const blocker = handoffCheckpointError(db, loanId);
  if (blocker) return { blocked: blocker };
  const draft = parsed.data;
  const { city, state, zip, unit } = draft.propertyLocation;
  const property = draft.urla.property.fields.propertyPending === "Yes" ? null :
    [draft.propertyAddress, unit ? `Unit ${unit}` : "", city, `${state} ${zip}`].filter(Boolean).join(", ");
  const amountCents = Math.min(Math.round(Number(draft.loanAmount) * 100), maxAmountCents ?? Infinity);
  return { draft, property, applicationRevision: file.revision, amountCents,
    earliestExpiry: shiftReportDate(today, 1), latestExpiry: shiftReportDate(today, maxExpiryDays),
    suggestedExpiry: shiftReportDate(today, Math.min(30, maxExpiryDays)) };
}

export function workOnPreapprovalLetters(db: Store, input: unknown, staff: WorkspaceStaff | null, brokerageId: string,
  clock = new Date()): PreapprovalResult {
  if (!staff || staff.brokerage.id !== brokerageId || staff.brokerage.role === "Processor" ||
    (!staff.brokerage.pilot && brokerageId !== demoBrokerageId)) return { error: preapprovalUnavailable };
  const parsed = preapprovalRequest.safeParse(input);
  if (!parsed.success) return { error: "Check the sample amount, expiry date, and fictional-use confirmation." };
  const data = parsed.data;
  const today = easternDate(clock);
  const now = clock.toISOString();
  return db.transaction(() => {
    if (data.type === "policyRead" || data.type === "policySave") return workOnPreapprovalPolicy(db, data, staff, today, now);
    if (!("loanId" in data)) return workOnPreapprovalTemplates(db, data, staff, now);
    const { loanId } = data;
    if (!loanAccess(db, staff, loanId)) return { error: preapprovalUnavailable };
    if (data.type === "download") {
      const row = db.prepare("SELECT pdf FROM sample_preapproval_letters WHERE loanId = ? AND version = ?").get(loanId, data.version);
      return row ? { pdf: String(row.pdf), filename: `orbit-fictional-preapproval-v${data.version}.pdf` } : { error: preapprovalUnavailable };
    }
    const file = db.prepare(`SELECT loan.purpose, app.draft, app.revision, app.submittedAt, app.reviewedAt, app.correctionNote,
        (${activePreapprovalLoan}) AS active
      FROM loans loan LEFT JOIN applications app ON app.loanId = loan.id
      LEFT JOIN past_client_profiles past ON past.loanId = loan.id LEFT JOIN closing_progress closing ON closing.loanId = loan.id
      WHERE loan.id = ?`).get(loanId) as File;
    let latestVersion = Number(db.prepare("SELECT max(version) AS version FROM sample_preapproval_letters WHERE loanId = ?").get(loanId)?.version ?? 0);
    const policy = readPreapprovalPolicy(db);
    const terms = issueTerms(db, loanId, file, today, policy.maxAmountCents, policy.maxExpiryDays);
    function shareableLetter(version: number) {
      if (version !== latestVersion || "blocked" in terms) return;
      return db.prepare(`SELECT issuerEmail FROM sample_preapproval_letters
        WHERE loanId = ? AND version = ? AND applicationRevision = ? AND expiresOn >= ?`).get(loanId, version, terms.applicationRevision, today);
    }
    function reviewFor(version: number, issuerEmail: string) {
      const receipt = preapprovalReviewReceipt(db, loanId, version, policy.revision);
      if (!policy.requireApproval && receipt?.decision !== "Changes requested") return;
      return { revision: policy.revision, receipt,
        canDecide: staff?.brokerage.role === "Admin" && staff.email !== issuerEmail && !receipt };
    }
    function shareBlocker(version: number) {
      const row = shareableLetter(version);
      if (!row) return "Only a current sample letter can be shared.";
      const review = reviewFor(version, String(row.issuerEmail));
      if (!review || review.receipt?.decision === "Approved") return null;
      return review.receipt?.decision === "Changes requested" ?
        "Prepare a replacement before sharing this sample letter." : "An independent brokerage admin must approve this sample letter before sharing.";
    }
    function readPage(beforeVersion?: number): PreapprovalPage {
      const records = db.prepare(`SELECT version, applicationRevision, issuedAt, expiresOn, issuer, amountCents, scope, templateSnapshot
        FROM sample_preapproval_letters WHERE loanId = ?${beforeVersion ? " AND version < ?" : ""}
        ORDER BY version DESC LIMIT ?`).all(loanId, ...(beforeVersion ? [beforeVersion] : []), pageSize + 1) as
        (Omit<PreapprovalLetter, "status" | "template"> & { templateSnapshot: string | null })[];
      const letters = records.slice(0, pageSize).map(({ templateSnapshot, ...record }): PreapprovalLetter => {
        const template = templateSnapshot && preapprovalTemplateSnapshot.parse(JSON.parse(templateSnapshot));
        return { ...record, ...(template ? { template: { title: template.title, revision: template.revision } } : {}),
        status: record.version !== latestVersion ? "Superseded" : record.expiresOn < today ? "Expired" :
          record.applicationRevision !== file.revision || !file.submittedAt || !file.reviewedAt || !!file.correctionNote ? "1003 changed" :
          file.purpose !== "Purchase" || !file.active ? "Loan inactive" : "Current",
        };
      });
      const issue = "blocked" in terms ? terms : { applicationRevision: terms.applicationRevision, amountCents: terms.amountCents,
        property: terms.property, earliestExpiry: terms.earliestExpiry, latestExpiry: terms.latestExpiry, suggestedExpiry: terms.suggestedExpiry };
      const currentLetter = !beforeVersion && latestVersion ? shareableLetter(latestVersion) : undefined;
      const review = currentLetter && reviewFor(latestVersion, String(currentLetter.issuerEmail));
      const sharing = !beforeVersion && latestVersion ? { version: latestVersion,
        canPublish: !!currentLetter && (!review || review.receipt?.decision === "Approved"),
        audiences: preapprovalShareStates(db, loanId, latestVersion, !!currentLetter, now), ...(review ? { review } : {}) } : null;
      const templates = !beforeVersion && !("blocked" in terms) ? availablePreapprovalTemplates(db) : [];
      return { letters, issue, sharing, latestVersion, beforeVersion: records.length > pageSize ? letters.at(-1)!.version : null,
        ...(templates.length ? { templates } : {}) };
    }
    if (data.type === "read") return { page: readPage(data.beforeVersion) };
    if (data.type === "reviewLetter") {
      const row = shareableLetter(data.version);
      if (!row) return { error: "Only a current sample letter can be reviewed. Refresh letters." };
      const decision = decidePreapprovalReview(db, data, staff, policy, String(row.issuerEmail), now);
      return "error" in decision ? decision : { page: readPage(), shareMessage: decision.message };
    }
    if (data.type === "publish" || data.type === "withdraw") {
      const change = changePreapprovalShare(db, data, staff, data.type === "publish" ? shareBlocker(data.version) : null, now);
      return "error" in change ? { error: change.error } : { page: readPage(), shareMessage: change.message };
    }

    const earlier = data.type === "issue" && db.prepare(`SELECT loanId, version, applicationRevision, issuerEmail, amountCents, scope,
      expiresOn, templateSnapshot, previewStamp FROM sample_preapproval_letters WHERE requestId = ?`).get(data.requestId);
    if (earlier) {
      const template = earlier.templateSnapshot && preapprovalTemplateSnapshot.parse(JSON.parse(String(earlier.templateSnapshot)));
      return earlier.loanId === loanId && earlier.version === data.previousVersion + 1 && earlier.issuerEmail === staff.email &&
        earlier.applicationRevision === data.applicationRevision && earlier.amountCents === data.amountCents &&
        earlier.scope === data.scope && earlier.expiresOn === data.expiresOn && earlier.previewStamp === (data.previewStamp ?? null) &&
        (template ? template.id === data.template?.id && template.revision === data.template.revision : !data.template) ?
        { page: readPage(), issuedVersion: Number(earlier.version) } : { error: "Start a new sample letter entry." };
    }
    if (latestVersion !== data.previousVersion) return { error: "A newer sample letter exists. Refresh letters before issuing another version." };
    if ("blocked" in terms) return { error: terms.blocked };
    if (terms.applicationRevision !== data.applicationRevision) return { error: "The 1003 changed. Refresh letters and review the current application." };
    if (data.amountCents > terms.amountCents) return { error: policy.maxAmountCents === terms.amountCents ?
      `Choose a sample amount at or below the brokerage limit of ${preapprovalAmount(terms.amountCents)}.` :
      "Choose a sample amount at or below the reviewed 1003 loan amount." };
    if (data.expiresOn < terms.earliestExpiry || data.expiresOn > terms.latestExpiry) return { error: policy.maxExpiryDays === 1 ?
      "Choose tomorrow as the expiry date." : `Choose an expiry date 1 to ${policy.maxExpiryDays} days from today.` };
    if (data.scope === "Subject property" && !terms.property) return { error: "Use property search or review a 1003 with a subject property." };

    const template = data.template ? resolvePreapprovalTemplate(db, data.template) : undefined;
    if (data.template && !template) return { error: preapprovalTemplateChanged };
    const names = [terms.draft.borrowerName, ...terms.draft.urla.additional.map((person) => person.identity.fields.name)];
    const version = latestVersion + 1;
    const letter = { names, property: data.scope === "Subject property" ? terms.property : null, version, issuedOn: today,
      expiresOn: data.expiresOn, issuer: staff.name, brokerage: staff.brokerage.name, amountCents: data.amountCents };
    let pdf: string;
    try {
      pdf = preapprovalLetterPdf({ ...letter, note: template?.note });
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Orbit could not prepare the sample PDF." };
    }
    const stampParts = [loanId, data.applicationRevision, data.scope, staff.email, template, pdf];
    if (policy.revision) stampParts.push(String(policy.revision));
    const stamp = createHash("sha256").update(JSON.stringify(stampParts)).digest("hex");
    if (data.type === "preview") return { preview: { ...letter, stamp, ...(template ? { template } : {}),
      ...(policy.requireApproval ? { requiresApproval: true } : {}) } };
    if ((template || data.previewStamp || policy.revision) && data.previewStamp !== stamp) {
      return { error: "The sample letter details changed. Preview the letter again before issuing it." };
    }
    db.prepare("UPDATE sample_preapproval_shares SET revokedAt = ? WHERE loanId = ? AND revokedAt IS NULL").run(now, loanId);
    db.prepare(`INSERT INTO sample_preapproval_letters
      (loanId, version, requestId, applicationRevision, issuedAt, expiresOn, issuer, issuerEmail, amountCents, scope, pdf, templateSnapshot, previewStamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(loanId, version, data.requestId, data.applicationRevision,
      now, data.expiresOn, staff.name, staff.email, data.amountCents, data.scope, pdf, template ? JSON.stringify(template) : null, data.previewStamp ?? null);
    db.prepare("INSERT INTO activity (id, loanId, text, createdAt) VALUES (?, ?, ?, ?)").run(crypto.randomUUID(), loanId,
      `Issued fictional preapproval letter v${version} · 1003 revision ${data.applicationRevision} · ${staff.name} · Expires ${data.expiresOn}`, now);
    accessEvent(db, staff, `Issued sample preapproval v${version}`, loanId, now);
    latestVersion = version;
    return { page: readPage(), issuedVersion: version };
  });
}
