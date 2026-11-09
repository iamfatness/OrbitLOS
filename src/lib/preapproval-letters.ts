import { applicationDraft, applicationIssues, type ApplicationDraft } from "./application-model";
import { handoffCheckpointError } from "./application-review-checkpoint";
import { demoBrokerageId } from "./brokerage-model";
import { easternDate } from "./client-retention";
import { preapprovalLetterPdf } from "./preapproval-letter-pdf";
import { preapprovalRequest, preapprovalUnavailable, type PreapprovalLetter, type PreapprovalPage, type PreapprovalResult } from "./preapproval-model";
import { shiftReportDate } from "./report-date-range";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { accessEvent, loanAccess } from "./workspace-access";

const pageSize = 5;
type File = { purpose: string; active: number; draft: string | null; revision: number | null;
  submittedAt: string | null; reviewedAt: string | null; correctionNote: string | null };
type IssueTerms = Exclude<PreapprovalPage["issue"], { blocked: string }> & { draft: ApplicationDraft };

function issueTerms(db: Store, loanId: string, file: File, today: string): IssueTerms | { blocked: string } {
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
  return { draft, property, applicationRevision: file.revision, amountCents: Math.round(Number(draft.loanAmount) * 100),
    earliestExpiry: shiftReportDate(today, 1), latestExpiry: shiftReportDate(today, 60), suggestedExpiry: shiftReportDate(today, 30) };
}

export function workOnPreapprovalLetters(db: Store, input: unknown, staff: WorkspaceStaff | null, brokerageId: string,
  clock = new Date()): PreapprovalResult {
  if (!staff || staff.brokerage.id !== brokerageId || staff.brokerage.role === "Processor" ||
    (!staff.brokerage.pilot && brokerageId !== demoBrokerageId)) return { error: preapprovalUnavailable };
  const parsed = preapprovalRequest.safeParse(input);
  if (!parsed.success) return { error: "Check the sample amount, expiry date, and fictional-use confirmation." };
  const data = parsed.data;
  const { loanId } = data;
  const today = easternDate(clock);
  return db.transaction(() => {
    if (!loanAccess(db, staff, loanId)) return { error: preapprovalUnavailable };
    if (data.type === "download") {
      const row = db.prepare("SELECT pdf FROM sample_preapproval_letters WHERE loanId = ? AND version = ?").get(loanId, data.version);
      return row ? { pdf: String(row.pdf), filename: `orbit-fictional-preapproval-v${data.version}.pdf` } : { error: preapprovalUnavailable };
    }
    const file = db.prepare(`SELECT loan.purpose, app.draft, app.revision, app.submittedAt, app.reviewedAt, app.correctionNote,
        (loan.disposition = 'Active' AND loan.stage NOT IN ('Funded', 'Closed') AND past.closingDate IS NULL AND closing.fundingDate IS NULL) AS active
      FROM loans loan LEFT JOIN applications app ON app.loanId = loan.id
      LEFT JOIN past_client_profiles past ON past.loanId = loan.id LEFT JOIN closing_progress closing ON closing.loanId = loan.id
      WHERE loan.id = ?`).get(loanId) as File;
    let latestVersion = Number(db.prepare("SELECT max(version) AS version FROM sample_preapproval_letters WHERE loanId = ?").get(loanId)?.version ?? 0);
    const terms = issueTerms(db, loanId, file, today);
    function readPage(beforeVersion?: number): PreapprovalPage {
      const records = db.prepare(`SELECT version, applicationRevision, issuedAt, expiresOn, issuer, amountCents, scope
        FROM sample_preapproval_letters WHERE loanId = ?${beforeVersion ? " AND version < ?" : ""}
        ORDER BY version DESC LIMIT ?`).all(loanId, ...(beforeVersion ? [beforeVersion] : []), pageSize + 1) as Omit<PreapprovalLetter, "status">[];
      const letters = records.slice(0, pageSize).map((record): PreapprovalLetter => ({ ...record,
        status: record.version !== latestVersion ? "Superseded" : record.expiresOn < today ? "Expired" :
          record.applicationRevision !== file.revision || !file.submittedAt || !file.reviewedAt || !!file.correctionNote ? "1003 changed" :
          file.purpose !== "Purchase" || !file.active ? "Loan inactive" : "Current",
      }));
      const issue = "blocked" in terms ? terms : { applicationRevision: terms.applicationRevision, amountCents: terms.amountCents,
        property: terms.property, earliestExpiry: terms.earliestExpiry, latestExpiry: terms.latestExpiry, suggestedExpiry: terms.suggestedExpiry };
      return { letters, issue, latestVersion, beforeVersion: records.length > pageSize ? letters.at(-1)!.version : null };
    }
    if (data.type === "read") return { page: readPage(data.beforeVersion) };

    const earlier = db.prepare(`SELECT loanId, version, applicationRevision, issuerEmail, amountCents, scope, expiresOn
      FROM sample_preapproval_letters WHERE requestId = ?`).get(data.requestId);
    if (earlier) {
      return earlier.loanId === loanId && earlier.version === data.previousVersion + 1 && earlier.issuerEmail === staff.email &&
        earlier.applicationRevision === data.applicationRevision && earlier.amountCents === data.amountCents &&
        earlier.scope === data.scope && earlier.expiresOn === data.expiresOn ?
        { page: readPage(), issuedVersion: Number(earlier.version) } : { error: "Start a new sample letter entry." };
    }
    if (latestVersion !== data.previousVersion) return { error: "A newer sample letter exists. Refresh letters before issuing another version." };
    if ("blocked" in terms) return { error: terms.blocked };
    if (terms.applicationRevision !== data.applicationRevision) return { error: "The 1003 changed. Refresh letters and review the current application." };
    if (data.amountCents > terms.amountCents) return { error: "Choose a sample amount at or below the reviewed 1003 loan amount." };
    if (data.expiresOn < terms.earliestExpiry || data.expiresOn > terms.latestExpiry) return { error: "Choose an expiry date 1 to 60 days from today." };
    if (data.scope === "Subject property" && !terms.property) return { error: "Use property search or review a 1003 with a subject property." };

    const names = [terms.draft.borrowerName, ...terms.draft.urla.additional.map((person) => person.identity.fields.name)];
    const version = latestVersion + 1;
    let pdf: string;
    try {
      pdf = preapprovalLetterPdf({ names, property: data.scope === "Subject property" ? terms.property : null, version,
        issuedOn: today, expiresOn: data.expiresOn, issuer: staff.name, brokerage: staff.brokerage.name, amountCents: data.amountCents });
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Orbit could not prepare the sample PDF." };
    }
    const issuedAt = clock.toISOString();
    db.prepare(`INSERT INTO sample_preapproval_letters
      (loanId, version, requestId, applicationRevision, issuedAt, expiresOn, issuer, issuerEmail, amountCents, scope, pdf)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(loanId, version, data.requestId, data.applicationRevision,
      issuedAt, data.expiresOn, staff.name, staff.email, data.amountCents, data.scope, pdf);
    db.prepare("INSERT INTO activity (id, loanId, text, createdAt) VALUES (?, ?, ?, ?)").run(crypto.randomUUID(), loanId,
      `Issued fictional preapproval letter v${version} · 1003 revision ${data.applicationRevision} · ${staff.name} · Expires ${data.expiresOn}`, issuedAt);
    accessEvent(db, staff, `Issued sample preapproval v${version}`, loanId, issuedAt);
    latestVersion = version;
    return { page: readPage(), issuedVersion: version };
  });
}
