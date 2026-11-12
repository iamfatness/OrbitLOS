import type { ProcessorFeeInput, ProcessorFeePage, ProcessorFeeTerms } from "./processor-fee-model";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { accessEvent } from "./workspace-access";

export function initializeProcessorFees(db: Store) {
  db.exec(`CREATE TABLE IF NOT EXISTS processor_fee_terms (
    loanId TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE, version INTEGER NOT NULL, processorEmail TEXT NOT NULL,
    processorName TEXT NOT NULL, amountCents INTEGER NOT NULL, reference TEXT NOT NULL, assignmentRevision INTEGER NOT NULL,
    requestId TEXT NOT NULL UNIQUE, offeredAt TEXT NOT NULL, offeredBy TEXT NOT NULL, offeredByEmail TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Pending', decidedAt TEXT, endedReason TEXT,
    PRIMARY KEY (loanId, version)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS processor_fee_pending ON processor_fee_terms(loanId) WHERE endedReason IS NULL AND status = 'Pending';
  CREATE UNIQUE INDEX IF NOT EXISTS processor_fee_accepted ON processor_fee_terms(loanId) WHERE endedReason IS NULL AND status = 'Accepted';
  CREATE TRIGGER IF NOT EXISTS processor_fee_end_assignment AFTER UPDATE OF processorEmail ON loan_processing
    WHEN OLD.processorEmail IS NOT NEW.processorEmail
    BEGIN
      UPDATE processor_fee_terms SET endedReason = 'Assignment ended' WHERE loanId = NEW.loanId AND endedReason IS NULL;
    END;`);
}

const fields = "version, processorName, amountCents, reference, status, offeredAt, offeredBy, decidedAt, endedReason";
const pageSize = 8;
const denied = { error: "Processing fee terms are available to this brokerage’s admin and the assigned processor." };
const changed = { error: "The assignment or fee terms changed. Refresh before continuing." };

export function processorFeeWork(db: Store, input: ProcessorFeeInput, staff: WorkspaceStaff, now: string):
  ProcessorFeePage | { message: string } | { error: string } {
  const { loanId } = input;
  const admin = staff.brokerage.role === "Admin";
  if (!admin && staff.brokerage.role !== "Processor") return denied;
  return db.transaction(() => {
    const loan = db.prepare(`SELECT loan.stage, loan.disposition, processing.processorEmail, processing.processorName, processing.revision
      FROM loans loan LEFT JOIN loan_processing processing ON processing.loanId = loan.id WHERE loan.id = ?`).get(loanId);
    if (!loan || (!admin && loan.processorEmail !== staff.email)) return denied;
    const active = loan.disposition === "Active" && loan.stage !== "Funded" && loan.stage !== "Closed";
    const scope = admin ? "" : "AND processorEmail = ?";
    const bindings = admin ? [loanId] : [loanId, staff.email];
    const current = db.prepare(`SELECT ${fields} FROM processor_fee_terms
      WHERE loanId = ? ${scope} AND endedReason IS NULL ORDER BY version DESC LIMIT 1`).get(...bindings) as ProcessorFeeTerms | undefined;
    const latest = admin ? db.prepare("SELECT MAX(version) AS latest FROM processor_fee_terms WHERE loanId = ?").get(loanId)?.latest : null;
    const latestVersion = typeof latest === "number" ? latest : null;
    if (input.type === "readFeeTerms") {
      const rows = db.prepare(`SELECT ${fields} FROM processor_fee_terms
        WHERE loanId = ? ${scope} AND endedReason IS NOT NULL ${input.before === undefined ? "" : "AND version < ?"}
        ORDER BY version DESC LIMIT ?`).all(...bindings, ...(input.before === undefined ? [] : [input.before]), pageSize + 1) as unknown as ProcessorFeeTerms[];
      const history = rows.slice(0, pageSize);
      const agreed = db.prepare(`SELECT ${fields} FROM processor_fee_terms
        WHERE loanId = ? ${scope} AND endedReason IS NULL AND status = 'Accepted'`).get(...bindings) as ProcessorFeeTerms | undefined;
      return { kind: "processorFeeTerms", assignment: loan.processorEmail ? { name: String(loan.processorName), revision: Number(loan.revision) } : null,
        current: current ?? null, agreed: agreed ?? null, history, next: rows.length > pageSize ? history.at(-1)?.version ?? null : null,
        latestVersion, canOffer: admin && active && Boolean(loan.processorEmail), canRespond: !admin && active && current?.status === "Pending" };
    }
    if (input.type === "offerFeeTerms") {
      if (!admin) return denied;
      const prior = db.prepare(`SELECT loanId, offeredByEmail, assignmentRevision, amountCents, reference, version
        FROM processor_fee_terms WHERE requestId = ?`).get(input.requestId);
      if (prior) {
        if (prior.loanId !== loanId || prior.offeredByEmail !== staff.email || prior.assignmentRevision !== input.assignmentRevision ||
          prior.amountCents !== input.amountCents || prior.reference !== input.reference || prior.version !== (input.expectedVersion ?? 0) + 1) {
          return { error: "This save belongs to a different fee offer. Refresh before continuing." };
        }
        return { message: `Fee terms v${prior.version} saved.` };
      }
      if (!active || !loan.processorEmail || input.assignmentRevision !== loan.revision || input.expectedVersion !== latestVersion) return changed;
      const version = (latestVersion ?? 0) + 1;
      db.prepare(`UPDATE processor_fee_terms SET endedReason = 'Replaced'
        WHERE loanId = ? AND endedReason IS NULL AND status <> 'Accepted'`).run(loanId);
      db.prepare(`INSERT INTO processor_fee_terms
        (loanId, version, processorEmail, processorName, amountCents, reference, assignmentRevision, requestId, offeredAt, offeredBy, offeredByEmail)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(loanId, version, loan.processorEmail, loan.processorName,
          input.amountCents, input.reference, input.assignmentRevision, input.requestId, now, staff.name, staff.email);
      accessEvent(db, staff, "Saved processing fee terms", `${loanId} · v${version}`, now);
      return { message: `Fee terms v${version} saved.` };
    }
    if (admin) return denied;
    if (!current || current.version !== input.version) return changed;
    if (current.status === input.response) return { message: `Fee terms v${input.version} ${input.response.toLowerCase()}.` };
    if (!active || current.status !== "Pending") return changed;
    if (input.response === "Accepted") db.prepare(`UPDATE processor_fee_terms SET endedReason = 'Replaced'
      WHERE loanId = ? AND endedReason IS NULL AND status = 'Accepted'`).run(loanId);
    db.prepare("UPDATE processor_fee_terms SET status = ?, decidedAt = ? WHERE loanId = ? AND version = ?")
      .run(input.response, now, loanId, input.version);
    accessEvent(db, staff, `${input.response} processing fee terms`, `${loanId} · v${input.version}`, now);
    return { message: `Fee terms v${input.version} ${input.response.toLowerCase()}.` };
  });
}
