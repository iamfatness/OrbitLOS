import { demoBrokerageId, type AccessEvent, type BrokerageMember } from "./brokerage-model";
import type { Workspace } from "./model";
import type { StaffIdentity, WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";

export function scopeWorkspace(state: Workspace, staff: WorkspaceStaff | null): Workspace {
  if (staff?.brokerage.role !== "LO") return state;
  const loans = state.loans.filter((loan) => loan.officerEmail === staff.email);
  const loanIds = new Set(loans.map((loan) => loan.id));
  const contacts = new Set(loans.flatMap((loan) => [loan.contactId, loan.partnerId]));
  const scoped = <T extends { loanId: string }>(items: T[]) => items.filter((item) => loanIds.has(item.loanId));
  return { ...state, loans, contacts: state.contacts.filter((contact) => contacts.has(contact.id)), realtorPortals: [],
    submissions: scoped(state.submissions), activity: scoped(state.activity), tasks: scoped(state.tasks),
    communicationDrafts: scoped(state.communicationDrafts), pastClients: scoped(state.pastClients),
    closingPlans: scoped(state.closingPlans), closingItems: scoped(state.closingItems), applications: scoped(state.applications),
    documentRequests: scoped(state.documentRequests), pricingRuns: scoped(state.pricingRuns), publishedQuotes: scoped(state.publishedQuotes),
    mockUwmRates: scoped(state.mockUwmRates),
  };
}

export function accessEvent(db: Store, staff: StaffIdentity | null, action: string, subject: string, now: string) {
  db.prepare("INSERT INTO workspace_access_history VALUES (?, ?, ?, ?, ?)").run(crypto.randomUUID(), staff?.email ?? "Demo workspace", action, subject, now);
}

export function workspaceAccessHistory(db: Store): AccessEvent[] {
  return db.prepare("SELECT * FROM workspace_access_history ORDER BY createdAt DESC LIMIT 100").all().map((row) => ({ ...row }) as unknown as AccessEvent);
}

export function assignLoan(db: Store, staff: WorkspaceStaff, target: { loanId: string; previousEmail: string | null; member: BrokerageMember }) {
  if (staff.brokerage.role !== "Admin" || target.member.status !== "Active") return { error: "Select an active staff member in this brokerage." };
  return db.transaction(() => {
    const { loanId, previousEmail, member } = target;
    const loan = db.prepare("SELECT loans.officerEmail, contacts.name FROM loans JOIN contacts ON contacts.id = loans.contactId WHERE loans.id = ?").get(loanId);
    if (!loan) return { error: "This loan no longer exists." };
    if (loan.officerEmail !== member.email) {
      if (loan.officerEmail !== previousEmail) return { error: "The loan owner changed. Refresh the workspace before reassigning it." };
      const now = new Date().toISOString();
      db.prepare("UPDATE loans SET officer = ?, officerEmail = ? WHERE id = ?").run(member.name.slice(0, 160), member.email, loanId);
      accessEvent(db, staff, "Reassigned loan", `${loan.name} · ${loan.officerEmail ?? "Unassigned"} → ${member.email}`, now);
      db.prepare("INSERT INTO activity (id, loanId, text, createdAt) VALUES (?, ?, ?, ?)").run(crypto.randomUUID(), loanId, `Loan reassigned to ${member.name}.`, now);
    }
    return { message: "Loan reassigned. Open tasks now follow its new owner." };
  });
}

export function isDemoStaff(staff: WorkspaceStaff | null) {
  return !staff || staff.brokerage.id === demoBrokerageId;
}
