import { z } from "zod";
import { dispositionRequest, initializeRetentionDisposition, retentionDispositionWork, type DispositionQueue } from "./retention-disposition";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";

export const loanRetentionUnavailable = "Loan retention is available to current pilot owners.";
const loanId = z.string().min(1).max(200);
const note = z.string().trim().min(4).max(240);
const request = z.discriminatedUnion("type", [
  ...dispositionRequest.options,
  z.object({ type: z.literal("list"), heldOnly: z.boolean(), search: z.string().trim().max(100), offset: z.number().int().min(0).max(10000) }),
  z.object({ type: z.literal("history"), loanId }),
  z.object({ type: z.literal("hold"), id: z.uuid(), loanId, reference: note }),
  z.object({ type: z.literal("release"), id: z.uuid(), loanId, holdId: z.uuid(), reference: note }),
]);

export const retainedObject = `EXISTS (SELECT 1 FROM loan_retention_objects retained
  JOIN loan_retention_holds hold ON hold.id = retained.holdId
  WHERE retained.objectId = document_file_cleanup.objectId AND hold.releasedAt IS NULL)`;

export function initializeLoanRetention(db: Store) {
  initializeRetentionDisposition(db);
  db.exec(`CREATE TABLE IF NOT EXISTS loan_retention_holds (
    id TEXT PRIMARY KEY, loanId TEXT NOT NULL, reference TEXT NOT NULL, placedAt TEXT NOT NULL, placedBy TEXT NOT NULL, placedByEmail TEXT NOT NULL,
    releaseId TEXT UNIQUE, releaseReference TEXT, releasedAt TEXT, releasedBy TEXT, releasedByEmail TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS active_loan_retention_hold ON loan_retention_holds(loanId) WHERE releasedAt IS NULL;
  CREATE INDEX IF NOT EXISTS loan_retention_history ON loan_retention_holds(loanId, placedAt DESC, id);
  CREATE TABLE IF NOT EXISTS loan_retention_objects (
    holdId TEXT NOT NULL REFERENCES loan_retention_holds(id), requestId TEXT NOT NULL, objectId TEXT NOT NULL,
    PRIMARY KEY (holdId, requestId, objectId)
  );
  CREATE INDEX IF NOT EXISTS loan_retention_by_object ON loan_retention_objects(objectId, holdId);
  CREATE VIEW IF NOT EXISTS loan_retention_pdf_references AS
    SELECT request.loanId, request.id AS requestId, files.objectId FROM document_requests request
      JOIN document_files files ON files.requestId = request.id WHERE files.objectId IS NOT NULL
    UNION ALL SELECT request.loanId, request.id, files.objectId FROM document_requests request
      JOIN document_accepted_files files ON files.requestId = request.id
    UNION ALL SELECT request.loanId, request.id, files.objectId FROM document_requests request
      JOIN condition_document_sources files ON files.requestId = request.id WHERE files.objectId IS NOT NULL;
  CREATE TRIGGER IF NOT EXISTS block_held_loan_delete BEFORE DELETE ON loans
    WHEN EXISTS (SELECT 1 FROM loan_retention_holds WHERE loanId=OLD.id AND releasedAt IS NULL)
    BEGIN SELECT RAISE(ABORT, 'Release the loan retention hold before removing this file.'); END;
  CREATE TRIGGER IF NOT EXISTS block_held_checklist_delete BEFORE DELETE ON document_requests
    WHEN EXISTS (SELECT 1 FROM loan_retention_holds WHERE loanId=OLD.loanId AND releasedAt IS NULL)
    BEGIN SELECT RAISE(ABORT, 'This loan has an active retention hold.'); END;`);
  for (const table of ["document_files", "document_accepted_files", "condition_document_sources"]) {
    for (const operation of ["INSERT", "UPDATE OF objectId, requestId"]) {
      const suffix = operation === "INSERT" ? "insert" : "update";
      db.exec(`CREATE TRIGGER IF NOT EXISTS retain_${table}_${suffix} AFTER ${operation} ON ${table}
        WHEN NEW.objectId IS NOT NULL BEGIN
          INSERT OR IGNORE INTO loan_retention_objects
          SELECT hold.id, request.id, NEW.objectId FROM document_requests request
          JOIN loan_retention_holds hold ON hold.loanId=request.loanId AND hold.releasedAt IS NULL
          WHERE request.id=NEW.requestId;
        END;`);
    }
  }
}

type Hold = { id: string; reference: string; placedAt: string; placedBy: string; releaseReference: string | null;
  releasedAt: string | null; releasedBy: string | null };
type LoanRow = { id: string; borrower: string; stage: string; requests: number; pdfs: number; holdId: string | null };
type Work = { kind: "list"; loans: LoanRow[]; total: number; held: number; next: number | null } |
  { kind: "history"; holds: Hold[] } | { kind: "saved"; message: string } | DispositionQueue | { error: string };
export type LoanRetentionResult = Work;

export function loanRetentionWork(db: Store, input: unknown, staff: WorkspaceStaff, workspaceId: string, now = new Date().toISOString()): Work {
  if (staff.brokerage.id !== workspaceId || !staff.brokerage.pilot || staff.brokerage.role !== "Admin")
    return { error: loanRetentionUnavailable };
  const parsed = request.safeParse(input);
  if (!parsed.success) return { error: "Check the required retention fields and try again." };
  const data = parsed.data;
  return db.transaction(() => {
    if (data.type === "dispositionQueue" || data.type === "saveDispositionPolicy" || data.type === "saveDispositionReview")
      return retentionDispositionWork(db,data,staff,now);
    if (data.type === "list") {
      const source = `FROM loans loan JOIN contacts contact ON contact.id=loan.contactId
        LEFT JOIN loan_retention_holds hold ON hold.loanId=loan.id AND hold.releasedAt IS NULL
        WHERE (? = 0 OR hold.id IS NOT NULL) AND instr(lower(contact.name), lower(?)) > 0`;
      const args = [Number(data.heldOnly), data.search];
      const count = db.prepare(`SELECT count(*) AS n ${source}`).get(...args)?.n;
      const loans = db.prepare(`SELECT loan.id,contact.name AS borrower,loan.stage,hold.id AS holdId,
        (SELECT count(*) FROM document_requests request WHERE request.loanId=loan.id) AS requests,
        (SELECT count(*) FROM (
          SELECT objectId FROM loan_retention_pdf_references WHERE loanId=loan.id
          UNION SELECT objectId FROM loan_retention_objects WHERE holdId=hold.id
        )) AS pdfs
        ${source} ORDER BY contact.name COLLATE NOCASE,loan.id LIMIT 16 OFFSET ?`).all(...args, data.offset) as LoanRow[];
      const held = Number(db.prepare("SELECT count(*) AS n FROM loan_retention_holds WHERE releasedAt IS NULL").get()?.n ?? 0);
      return { kind: "list", loans: loans.slice(0, 15), total: Number(count), held, next: loans.length > 15 ? data.offset + 15 : null };
    }
    if (!db.prepare("SELECT 1 FROM loans WHERE id=?").get(data.loanId)) return { error: "This loan is unavailable." };
    if (data.type === "history") {
      const holds = db.prepare(`SELECT id,reference,placedAt,placedBy,releaseReference,releasedAt,releasedBy
        FROM loan_retention_holds WHERE loanId=? ORDER BY placedAt DESC,rowid DESC LIMIT 20`).all(data.loanId) as Hold[];
      return { kind: "history", holds };
    }
    const prior = db.prepare("SELECT * FROM loan_retention_holds WHERE id=? OR releaseId=?").get(data.id, data.id);
    if (prior) {
      const matches = prior.loanId === data.loanId && (data.type === "hold" ?
        prior.id === data.id && prior.reference === data.reference && prior.placedByEmail === staff.email :
        prior.releaseId === data.id && prior.id === data.holdId && prior.releaseReference === data.reference && prior.releasedByEmail === staff.email);
      if (!matches) return { error: "This request belongs to a different hold review." };
      if (data.type === "hold" && prior.releasedAt) return { error: "This hold was released. Refresh the inventory." };
      return { kind: "saved", message: data.type === "hold" ? "Retention hold placed." : "Retention hold released." };
    }
    const active = db.prepare("SELECT id FROM loan_retention_holds WHERE loanId=? AND releasedAt IS NULL").get(data.loanId)?.id;
    if (data.type === "hold") {
      if (active) return { error: "A hold is already active. Refresh the inventory to review it." };
      db.prepare("INSERT INTO loan_retention_holds (id,loanId,reference,placedAt,placedBy,placedByEmail) VALUES (?,?,?,?,?,?)")
        .run(data.id, data.loanId, data.reference, now, staff.name, staff.email);
      db.prepare(`INSERT OR IGNORE INTO loan_retention_objects
        SELECT ?,requestId,objectId FROM loan_retention_pdf_references WHERE loanId=?`).run(data.id, data.loanId);
      return { kind: "saved", message: "Retention hold placed." };
    }
    if (active !== data.holdId) return { error: "The active hold changed. Refresh the inventory before releasing it." };
    db.prepare("UPDATE loan_retention_holds SET releaseId=?,releaseReference=?,releasedAt=?,releasedBy=?,releasedByEmail=? WHERE id=?")
      .run(data.id, data.reference, now, staff.name, staff.email, data.holdId);
    return { kind: "saved", message: "Retention hold released." };
  });
}
