import type { z } from "zod";
import { applicationDraft } from "./application-model";
import { demoBrokerageId, portalToken } from "./brokerage-model";
import { primaryJointDraft, type jointLinkCommand, type StaffJointApplication } from "./joint-application-model";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { blankBorrower } from "./urla";
import { accessEvent } from "./workspace-access";

type JointRow = StaffJointApplication & { token: string; loanId: string; draft: string; revision: number; step: number; updatedAt: string; confirmedDemo: number };

export function jointApplication(db: Store, loanId: string) {
  return db.prepare("SELECT * FROM joint_applications WHERE loanId = ?").get(loanId) as JointRow | undefined;
}

export function activeCoBorrowerLink(db: Store, token: string, now: string) {
  return db.prepare("SELECT * FROM joint_applications WHERE token = ? AND revokedAt IS NULL AND expiresAt > ?")
    .get(token, now) as JointRow | undefined;
}

export function staffJointApplications(db: Store, loanId?: string) {
  const rows = db.prepare(`SELECT loanId, token, expiresAt, revokedAt, primarySubmittedAt, submittedAt, correctionNote
    FROM joint_applications${loanId ? " WHERE loanId = ?" : ""}`).all(...(loanId ? [loanId] : []));
  return new Map(rows.map(({ loanId, ...data }) => [String(loanId), { ...data } as unknown as StaffJointApplication]));
}

export function changeJointApplicationLink(db: Store, staff: WorkspaceStaff | null, input: z.infer<typeof jointLinkCommand>, now: string) {
  if (staff && (staff.brokerage.role === "Processor" || (!staff.brokerage.pilot && staff.brokerage.id !== demoBrokerageId))) {
    return { error: "Separate joint links are available to loan officers and admins in the fictional pilot." };
  }
  const current = jointApplication(db, input.loanId);
  if (input.type === "enableJointApplication") {
    if (current) return { message: "Separate borrower links are ready." };
    const app = db.prepare(`SELECT app.draft, app.revision FROM applications app JOIN loans loan ON loan.id = app.loanId
      WHERE app.loanId = ? AND app.submittedAt IS NULL AND app.correctionNote = '' AND app.revokedAt IS NULL AND app.expiresAt > ?
        AND loan.disposition = 'Active' AND loan.stage NOT IN ('Funded', 'Closed')
        AND NOT EXISTS (SELECT 1 FROM application_versions version WHERE version.loanId = app.loanId)`).get(input.loanId, now);
    if (!app || app.revision !== input.revision) return { error: "Open the current unsubmitted application with an active borrower link." };
    const draft = applicationDraft.parse(JSON.parse(String(app.draft)));
    if (draft.urla.additional.length || draft.coBorrowerName) {
      return { error: "This draft already has answers for an additional borrower. Review the existing draft before switching to separate links." };
    }
    const expiresAt = new Date(Date.parse(now) + 7 * 86_400_000).toISOString();
    db.prepare("INSERT INTO joint_applications (loanId, token, expiresAt, draft, updatedAt) VALUES (?, ?, ?, ?, ?)")
      .run(input.loanId, portalToken(staff?.brokerage.id), expiresAt, JSON.stringify(blankBorrower()), now);
    db.prepare("UPDATE applications SET draft = ?, revision = revision + 1, updatedAt = ? WHERE loanId = ?")
      .run(JSON.stringify(primaryJointDraft(draft)), now, input.loanId);
    accessEvent(db, staff, "Issued separate joint borrower link", input.loanId, now);
    return { message: "Separate borrower links are ready." };
  }
  if (!current || current.token !== input.token) return { error: "The co-borrower link changed. Refresh before continuing." };
  if (input.type === "revokeJointLink") {
    if (!current.revokedAt) {
      db.prepare("UPDATE joint_applications SET revokedAt = ? WHERE loanId = ?").run(now, input.loanId);
      accessEvent(db, staff, "Revoked co-borrower link", input.loanId, now);
    }
    return { message: "Co-borrower link revoked." };
  }
  if (!current.revokedAt && current.expiresAt > now) return { error: "Revoke the active co-borrower link before issuing another." };
  const expiresAt = new Date(Date.parse(now) + 7 * 86_400_000).toISOString();
  db.prepare("UPDATE joint_applications SET token = ?, expiresAt = ?, revokedAt = NULL WHERE loanId = ?")
    .run(portalToken(staff?.brokerage.id), expiresAt, input.loanId);
  accessEvent(db, staff, "Replaced co-borrower link", input.loanId, now);
  return { message: "A replacement co-borrower link is ready." };
}

export function reopenJointBorrower(db: Store, loanId: string, recipient: "Primary borrower" | "Co-borrower", note: string, now: string) {
  if (recipient === "Co-borrower") {
    db.prepare(`UPDATE joint_applications SET submittedAt = NULL, correctionNote = ?, updatedAt = ?, step = 0,
      revision = revision + 1, confirmedDemo = 0 WHERE loanId = ?`).run(note, now, loanId);
  } else {
    db.prepare("UPDATE joint_applications SET primarySubmittedAt = NULL WHERE loanId = ?").run(loanId);
  }
}
