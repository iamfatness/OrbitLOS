import { demoBrokerageId, type AccessEvent, type BrokerageMember } from "./brokerage-model";
import type { Workspace } from "./model";
import type { StaffIdentity, WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { loanAuditSnapshot, recordLoanAudit } from "./loan-audit";
import { canClaimSharedRealtor } from "./realtor-claim-model";
import type { ManualReturnAssignment } from "./lender-export-model";
import { readManualReturnWork } from "./manual-lender-work";

export function scopeJointLinks(applications: Workspace["applications"], staff: WorkspaceStaff) {
  return staff.brokerage.role === "Processor" ? applications.map((app) => app.joint
    ? { ...app, joint: { ...app.joint, token: undefined } } : app) : applications;
}

export function scopeWorkspace(state: Workspace, staff: WorkspaceStaff | null): Workspace {
  if (!staff) return state.playbook.secondReview ? { ...state, playbook: { ...state.playbook, secondReview: null } } : state;
  if (staff.brokerage.role === "Admin") return state;
  const owned = new Set(staff.brokerage.role === "LO"
    ? state.loans.filter((loan) => loan.officerEmail === staff.email).map((loan) => loan.id) : []);
  const processing = new Set(staff.brokerage.role === "Processor"
    ? state.loanProcessing.filter((item) => item.processorEmail === staff.email).map((item) => item.loanId) : []);
  const loans = state.loans.filter((loan) => owned.has(loan.id) || processing.has(loan.id));
  const loanIds = new Set(loans.map((loan) => loan.id));
  const contacts = new Set(loans.flatMap((loan) => [loan.contactId, loan.partnerId]));
  if (staff.brokerage.role === "LO") {
    for (const contact of state.contacts) if (contact.addedBy === staff.email) contacts.add(contact.id);
  }
  const assignedFollowUpContacts = new Set<string>();
  const contactActivity = staff.brokerage.role === "LO" ? state.contactActivity.filter((item) => {
    if (item.dueAt && item.followUpOwnerEmail === staff.email) {
      assignedFollowUpContacts.add(item.contactId);
      return true;
    }
    return item.officerEmail === staff.email && contacts.has(item.contactId);
  }) : [];
  const scoped = <T extends { loanId: string }>(items: T[]) => items.filter((item) => loanIds.has(item.loanId));
  const referralLeads = state.referralLeads.filter((lead) => staff.brokerage.role === "LO" && lead.officerEmail === staff.email).map((lead) => {
    const matches = lead.matches.filter((match) => contacts.has(match.id));
    return { ...lead, matches, restrictedMatch: matches.length !== lead.matches.length };
  });
  const inboxLeads = state.inboxLeads.filter((lead) => staff.brokerage.role === "LO" &&
    (lead.officerEmail === staff.email || (!lead.officerEmail && !lead.realtorId))).map((lead) => {
    const matches = lead.matches.filter((match) => contacts.has(match.id));
    return { ...lead, matches, restrictedMatch: matches.length !== lead.matches.length };
  });
  const inboxIds = new Set(inboxLeads.map((lead) => lead.id));
  const callCampaignMembers = staff.brokerage.role === "LO" ? state.callCampaignMembers.filter((member) =>
    inboxIds.has(member.leadId) || (member.loanId && owned.has(member.loanId))) : [];
  const campaignIds = new Set(callCampaignMembers.map((member) => member.campaignId));
  const rehearsal = state.campaignRehearsal;
  const rehearsalMember = callCampaignMembers.find((member) => member.campaignId === rehearsal?.campaignId && member.leadId === rehearsal?.leadId);
  return { ...state, loans, contacts: state.contacts.filter((contact) => contacts.has(contact.id)), realtorPortals: [],
    followUpContacts: state.contacts.filter((contact) => assignedFollowUpContacts.has(contact.id) && !contacts.has(contact.id)),
    contactActivity,
    referralLeads, inboxLeads, leadRouting: null, realtorClaimPolicy: undefined,
    sharedRealtorClaimEnabled: canClaimSharedRealtor(staff, state.realtorClaimPolicy),
    playbook: { ...state.playbook, backupEmail: null, secondReview: null }, unlinkedReferrals: [], managerReports: null, callReportFiles: null,
    crmSegments: [], campaignResponses: [], callCampaignMembers, callCampaigns: state.callCampaigns.filter((campaign) => campaignIds.has(campaign.id))
      .map((campaign) => ({ ...campaign, routing: undefined })),
    demoGuide: staff.brokerage.role === "LO" && state.demoGuide?.officerEmail === staff.email ? state.demoGuide : null,
    campaignRehearsal: rehearsal && rehearsalMember ?
      { campaignId: rehearsal.campaignId, leadId: rehearsal.leadId, importedCount: rehearsal.importedCount,
        ...(rehearsal.checkInActivityId && owned.has(rehearsalMember.loanId ?? "") ? { checkInActivityId: rehearsal.checkInActivityId } : {}) } : null,
    mismoLoans: state.mismoLoans.filter((id) => owned.has(id)),
    submissions: scoped(state.submissions), tasks: state.tasks.filter((item) => owned.has(item.loanId)),
    communicationDrafts: scoped(state.communicationDrafts), pastClients: scoped(state.pastClients),
    closingPlans: scoped(state.closingPlans), closingItems: scoped(state.closingItems), applications: scopeJointLinks(scoped(state.applications), staff),
    closingProgress: scoped(state.closingProgress),
    returningClientLoans: state.returningClientLoans.filter((item) => owned.has(item.fundedLoanId) && owned.has(item.loanId)),
    loanProcessing: scoped(state.loanProcessing),
    documentRequests: scoped(state.documentRequests), pricingRuns: scoped(state.pricingRuns), publishedQuotes: scoped(state.publishedQuotes),
    sharedQuoteHistory: scoped(state.sharedQuoteHistory),
    feeWorksheets: scoped(state.feeWorksheets),
    mockUwmRates: state.mockUwmRates.filter((item) => owned.has(item.loanId)), mockCreditAusRuns: scoped(state.mockCreditAusRuns),
    uwmAlerts: state.uwmAlerts.filter((item) => owned.has(item.loanId)),
  };
}

export function loanAccess(db: Store, staff: WorkspaceStaff, loanId: string) {
  const loan = db.prepare("SELECT officerEmail FROM loans WHERE id = ?").get(loanId);
  if (!loan) return null;
  if (staff.brokerage.role === "Admin") return "admin";
  if (staff.brokerage.role === "LO" && loan.officerEmail === staff.email) return "owner";
  if (staff.brokerage.role === "Processor" && db.prepare("SELECT 1 FROM loan_processing WHERE loanId = ? AND processorEmail = ?").get(loanId, staff.email)) {
    return "processor";
  }
  return null;
}

export function accessEvent(db: Store, staff: StaffIdentity | null, action: string, subject: string, now: string) {
  db.prepare("INSERT INTO workspace_access_history VALUES (?, ?, ?, ?, ?)").run(crypto.randomUUID(), staff?.email ?? "Demo workspace", action, subject, now);
}

export function workspaceAccessHistory(db: Store): AccessEvent[] {
  return db.prepare("SELECT * FROM workspace_access_history ORDER BY createdAt DESC LIMIT 100").all()
    .map((row) => ({ ...row, subject: row.action === "Reassigned loan" && typeof row.subject === "string" && row.subject.includes(" → ")
      ? "Legacy loan assignment" : row.subject }) as unknown as AccessEvent);
}

export function assignLoan(db: Store, staff: WorkspaceStaff, target: { loanId: string; previousEmail: string | null; member: BrokerageMember;
  manualReturn?: ManualReturnAssignment }) {
  if (staff.brokerage.role !== "Admin" || target.member.status !== "Active" || target.member.role === "Processor") {
    return { error: "Select an active loan officer or admin in this brokerage." };
  }
  return db.transaction(() => {
    const { loanId, previousEmail, member } = target;
    const loan = db.prepare("SELECT officerEmail FROM loans WHERE id = ?").get(loanId);
    if (!loan) return { error: "This loan no longer exists." };
    if (db.prepare("SELECT 1 FROM loan_processing WHERE loanId = ? AND processorEmail = ?").get(loanId, member.email)) {
      return { error: "Remove shared processing access before making this staff member the primary owner." };
    }
    if (loan.officerEmail !== member.email) {
      if (loan.officerEmail !== previousEmail) return { error: "The loan owner changed. Refresh the workspace before reassigning it." };
      if (target.manualReturn) {
        const pending = readManualReturnWork(db, loanId, false);
        if (pending?.eventId !== target.manualReturn.eventId || pending.submissionId !== target.manualReturn.submissionId) {
          return { error: "This lender return changed. Refresh File exceptions before reassigning it." };
        }
      }
      const now = new Date().toISOString();
      const before = loanAuditSnapshot(db, loanId);
      db.prepare("UPDATE loans SET officer = ?, officerEmail = ? WHERE id = ?").run(member.name.slice(0, 160), member.email, loanId);
      accessEvent(db, staff, "Reassigned loan", loanId, now);
      recordLoanAudit(db, loanId, staff, "Reassigned loan", now, before);
      db.prepare("INSERT INTO activity (id, loanId, text, createdAt) VALUES (?, ?, ?, ?)").run(crypto.randomUUID(), loanId, `Loan reassigned to ${member.name}.`, now);
    }
    return { message: "Loan reassigned. Open tasks now follow its new owner." };
  });
}

export function isDemoStaff(staff: WorkspaceStaff | null) {
  return !staff || staff.brokerage.id === demoBrokerageId;
}
