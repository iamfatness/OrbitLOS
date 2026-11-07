import { z } from "zod";
import { applicationDraft, applicationIssues, applicationSteps, blankApplication, splitLegacyAddress, type ApplicationDraft, type BorrowerResult, type StaffApplication } from "./application-model";
import type { Store } from "./store";
import { createApplicationFollowUps } from "./tasks";
import { createMilestoneDrafts } from "./communications";
import { lenderDetailsSchema, normalizeUrla } from "./urla";

type ApplicationRow = Omit<StaffApplication, "draft" | "lender"> & { draft: string; step: number; revision: number };

export function getApplication(db: Store, loanId: string) {
  return db.prepare("SELECT * FROM applications WHERE loanId = ?").get(loanId) as ApplicationRow | undefined;
}

export function staffApplications(db: Store): StaffApplication[] {
  const lender = new Map(db.prepare("SELECT * FROM application_lender_details").all().map((item) => [item.loanId, {
    details: lenderDetailsSchema.parse(JSON.parse(String(item.details))), revision: Number(item.revision),
  }]));
  return db.prepare("SELECT * FROM applications").all().map((value) => {
    const row = value as ApplicationRow;
    return {
      loanId: row.loanId, token: row.token, expiresAt: row.expiresAt, updatedAt: row.updatedAt,
      submittedAt: row.submittedAt, reviewedAt: row.reviewedAt, uwmReference: row.uwmReference,
      draft: row.submittedAt ? applicationDraft.parse(JSON.parse(row.draft)) : null,
      lender: lender.get(row.loanId) ?? null,
    };
  });
}

export function addApplicationActivity(db: Store, loanId: string, text: string, now: string) {
  db.prepare("INSERT INTO activity (id, loanId, text, createdAt) VALUES (?, ?, ?, ?)")
    .run(crypto.randomUUID(), loanId, text, now);
}

export function startApplication(db: Store, loanId: string, now: string) {
  const loan = db.prepare("SELECT loans.address, loans.amount, loans.purpose, contacts.name FROM loans JOIN contacts ON contacts.id = loans.contactId WHERE loans.id = ?").get(loanId);
  if (!loan) return false;
  const existing = getApplication(db, loanId);
  if (existing && existing.expiresAt > now) return true;

  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const expiresAt = new Date(Date.parse(now) + 7 * 86_400_000).toISOString();
  if (existing) {
    db.prepare("UPDATE applications SET token = ?, expiresAt = ? WHERE loanId = ?").run(token, expiresAt, loanId);
    return true;
  }
  const property = splitLegacyAddress(String(loan.address));
  const draft: ApplicationDraft = {
    ...blankApplication(), borrowerName: String(loan.name), propertyAddress: property.street, propertyLocation: property.location,
    loanAmount: Number(loan.amount) > 0 ? String(loan.amount) : "",
    purpose: loan.purpose === "Refinance" ? "Refinance" : "Purchase",
  };
  db.prepare("INSERT INTO applications (loanId, token, expiresAt, draft, updatedAt) VALUES (?, ?, ?, ?, ?)")
    .run(loanId, token, expiresAt, JSON.stringify(draft), now);
  addApplicationActivity(db, loanId, "Demo 1003 link created.", now);
  return true;
}

const token = z.string().regex(/^[a-f0-9]{64}$/);
const write = {
  token, draft: applicationDraft,
  revision: z.number().int().min(0),
  step: z.number().int().min(0).max(applicationSteps.length - 1),
};
const borrowerCommand = z.discriminatedUnion("type", [
  z.object({ type: z.literal("read"), token }),
  z.object({ type: z.literal("save"), ...write }),
  z.object({ type: z.literal("submit"), ...write }),
]);

function borrowerResult(row: ApplicationRow): BorrowerResult {
  return { application: {
    draft: applicationDraft.parse(JSON.parse(row.draft)),
    step: row.step, revision: row.revision, updatedAt: row.updatedAt, submittedAt: row.submittedAt,
  } };
}

export function borrowerCommandResult(db: Store, input: unknown): BorrowerResult {
  const parsed = borrowerCommand.safeParse(input);
  if (!parsed.success) return { status: 400, error: "Check the length of your answers and use valid amounts, then try again." };
  const data = parsed.data;
  const now = new Date().toISOString();
  return db.transaction(() => {
    const row = db.prepare("SELECT * FROM applications WHERE token = ? AND expiresAt > ?")
      .get(data.token, now) as ApplicationRow | undefined;
    if (!row) return { status: 404, error: "This application link is invalid or expired. Ask your loan officer for a new link." };
    if (data.type === "read" || (data.type === "submit" && row.submittedAt)) return borrowerResult(row);
    if (row.submittedAt) return { status: 409, error: "This application has been submitted. Reopen the link to see your receipt." };
    if (row.revision !== data.revision) {
      return { status: 409, error: "This application was updated in another tab. Reopen the link to continue from the latest saved draft." };
    }

    const submitted = data.type === "submit";
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
    if (submitted) {
      const issues = applicationIssues(draft);
      if (issues.length) return { status: 422, error: `Complete these items before submitting: ${issues.join("; ")}.` };
    }
    const next: ApplicationRow = {
      ...row, draft: JSON.stringify(draft), step: data.step, revision: row.revision + 1,
      updatedAt: now, submittedAt: submitted ? now : null,
    };
    db.prepare("UPDATE applications SET draft = ?, step = ?, revision = ?, updatedAt = ?, submittedAt = ? WHERE loanId = ?")
      .run(next.draft, next.step, next.revision, next.updatedAt, next.submittedAt, next.loanId);
    if (submitted) {
      db.prepare("UPDATE loans SET stage = 'Application', stageSince = ? WHERE id = ? AND stage IN ('Lead', 'Pre-qual')")
        .run(now, row.loanId);
      createApplicationFollowUps(db, row.loanId);
      createMilestoneDrafts(db, row.loanId, "Application received", now);
      addApplicationActivity(db, row.loanId, "Demo 1003 received. Follow-up task created for the loan officer.", now);
    }
    return borrowerResult(next);
  });
}
