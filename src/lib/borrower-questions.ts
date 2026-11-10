import { addApplicationActivity } from "./applications";
import { borrowerQuestionLimit, needsBorrowerAnswer, type BorrowerQuestion, type BorrowerQuestionResponse,
  type StaffBorrowerQuestion, type StaffQuestionCommand } from "./borrower-question-model";
import { easternDate } from "./client-retention";
import { coBorrowerDocumentRecipient, documentRecipients, type DocumentRecipient } from "./document-model";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { isDemoStaff, loanAccess } from "./workspace-access";

const borrowerFields = "id, prompt, kind, status, dueOn, revision, answer, answeredAt, clarification";
const sort = "ORDER BY status NOT IN ('Requested', 'Answered', 'Needs clarification'), dueOn IS NULL, dueOn, requestedAt DESC, id";

export function borrowerQuestions(db: Store, loanId: string, recipient: DocumentRecipient) {
  return db.prepare(`SELECT ${borrowerFields} FROM borrower_questions WHERE loanId = ? AND recipient = ? AND status <> 'Cancelled' ${sort} LIMIT ?`)
    .all(loanId, recipient, borrowerQuestionLimit) as unknown as BorrowerQuestion[];
}

export function staffBorrowerQuestions(db: Store, loanId: string): StaffBorrowerQuestion[] {
  const records = db.prepare(`SELECT ${borrowerFields}, loanId, recipient, requestedAt, askedBy, reviewedAt, reviewedBy, batch.setTitle, batch.setRevision
    FROM borrower_questions question LEFT JOIN (SELECT id AS batchId, title AS setTitle, setRevision FROM borrower_question_set_batches) batch
      ON batch.batchId = question.setBatchId
    WHERE loanId = ? ${sort} LIMIT ?`).all(loanId, borrowerQuestionLimit) as unknown as
    (Omit<StaffBorrowerQuestion, "previousAnswers"> & { setTitle: string | null; setRevision: number | null })[];
  const history = db.prepare(`SELECT revision, answer, at FROM borrower_question_answers WHERE questionId = ?
    ORDER BY revision DESC LIMIT 5`);
  return records.map(({ setTitle, setRevision, ...item }) => ({ ...item,
    ...(setTitle && setRevision ? { setBasis: { title: setTitle, revision: setRevision } } : {}),
    previousAnswers: history.all(item.id) as StaffBorrowerQuestion["previousAnswers"] }));
}

function question(db: Store, loanId: string, questionId: string) {
  return db.prepare(`SELECT ${borrowerFields}, recipient FROM borrower_questions WHERE loanId = ? AND id = ?`)
    .get(loanId, questionId) as (BorrowerQuestion & { recipient: DocumentRecipient }) | undefined;
}

export function canWorkBorrowerQuestions(db: Store, loanId: string, staff: WorkspaceStaff | null) {
  return (isDemoStaff(staff) || staff?.brokerage.pilot) && (!staff || Boolean(loanAccess(db, staff, loanId)));
}

export function borrowerQuestionFile(db: Store, loanId: string, at: string) {
  const row = db.prepare(`SELECT app.revision, app.revokedAt IS NULL AND app.expiresAt > ? AS primaryAvailable,
      joint.submittedAt IS NOT NULL AND joint.revokedAt IS NULL AND joint.expiresAt > ? AS jointAvailable
    FROM loans loan JOIN applications app ON app.loanId = loan.id LEFT JOIN joint_applications joint ON joint.loanId = loan.id
    WHERE loan.id = ? AND loan.disposition = 'Active' AND loan.stage NOT IN ('Funded', 'Closed') AND app.submittedAt IS NOT NULL`)
    .get(at, at, loanId);
  return row ? { applicationRevision: Number(row.revision),
    recipients: documentRecipients.filter((recipient) => recipient === coBorrowerDocumentRecipient ? row.jointAvailable : row.primaryAvailable) } : null;
}

export function borrowerQuestionSlots(db: Store, loanId: string) {
  return borrowerQuestionLimit - Number(db.prepare("SELECT count(*) AS total FROM borrower_questions WHERE loanId = ?").get(loanId)?.total);
}

export function validBorrowerQuestionDueDate(dueOn: string | null, today: string) {
  return dueOn === null || (dueOn >= today && dueOn <= "2199-12-31");
}

export function insertBorrowerQuestion(db: Store, input: Omit<Extract<StaffQuestionCommand, { type: "requestBorrowerQuestion" }>, "type">,
  actor: string, at: string, setBatchId: string | null = null) {
  db.prepare(`INSERT INTO borrower_questions (id, loanId, recipient, prompt, kind, dueOn, requestedAt, askedBy, setBatchId)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(input.questionId, input.loanId, input.recipient, input.prompt, input.kind, input.dueOn, at, actor, setBatchId);
}

export function changeBorrowerQuestion(db: Store, data: StaffQuestionCommand, staff: WorkspaceStaff | null, at: string) {
  if (!canWorkBorrowerQuestions(db, data.loanId, staff)) {
    return { error: "Borrower questions are available on assigned files in fictional workspaces." } as const;
  }
  const { loanId, questionId } = data;
  const current = question(db, loanId, questionId);
  const actor = staff?.name ?? "Demo staff";
  if (data.type === "requestBorrowerQuestion") {
    const { recipient, prompt, kind, dueOn } = data;
    if (current) return current.recipient === recipient && current.prompt === prompt && current.kind === kind && current.dueOn === dueOn
      ? { message: "Borrower question already added." } : { error: "That question identifier was already used." };
    const file = borrowerQuestionFile(db, loanId, at);
    if (!file || (recipient !== coBorrowerDocumentRecipient && !file.recipients.includes(recipient))) {
      return { error: "Open an active loan with a submitted 1003 to add a borrower question." } as const;
    }
    if (!file.recipients.includes(recipient)) {
      return { error: "The co-borrower needs an active link and a submitted portion." } as const;
    }
    if (!validBorrowerQuestionDueDate(dueOn, easternDate(new Date(at)))) return { error: "Choose a due date of today or later." } as const;
    if (borrowerQuestionSlots(db, loanId) <= 0) {
      return { error: `This sample loan already has ${borrowerQuestionLimit} borrower questions.` } as const;
    }
    insertBorrowerQuestion(db, data, actor, at);
    addApplicationActivity(db, loanId, `Added a borrower question · ${recipient}`, at);
    return { message: "Borrower question added to the portal." } as const;
  }

  if (current?.revision === data.revision + 1 && current.status === data.decision && current.clarification === data.clarification) {
    return { message: "Borrower question already updated." } as const;
  }
  if (!current || current.revision !== data.revision) return { error: "This question changed. Refresh the loan before reviewing it." } as const;
  if (data.decision === "Cancelled" ? !needsBorrowerAnswer(current.status) : current.status !== "Answered") {
    return { error: "This question is unavailable for that action." } as const;
  }
  db.prepare(`UPDATE borrower_questions SET status = ?, clarification = ?, reviewedAt = ?, reviewedBy = ?,
    revision = revision + 1 WHERE id = ?`).run(data.decision, data.clarification, at, actor, questionId);
  addApplicationActivity(db, loanId, `${data.decision === "Reviewed" ? "Reviewed a borrower answer" :
    data.decision === "Cancelled" ? "Cancelled a borrower question" : "Requested a clarified borrower answer"} · ${current.recipient}`, at);
  return { message: data.decision === "Reviewed" ? "Borrower answer marked reviewed." :
    data.decision === "Cancelled" ? "Borrower question cancelled." : "Clarification added to the borrower’s action list." } as const;
}

export function recordBorrowerAnswer(db: Store, loanId: string, recipient: DocumentRecipient, data: BorrowerQuestionResponse, at: string) {
  const current = question(db, loanId, data.questionId);
  if (!current || current.recipient !== recipient || current.status === "Cancelled") return { status: 404, error: "This question is unavailable." };
  const old = db.prepare("SELECT answer FROM borrower_question_answers WHERE questionId = ? AND revision = ?").get(data.questionId, data.revision);
  if (old?.answer === data.answer) return null;
  if (current.revision !== data.revision || !needsBorrowerAnswer(current.status)) {
    return { status: 409, error: "This question changed. Refresh your status before answering." };
  }
  if (current.kind === "Yes or no" && !["Yes", "No"].includes(data.answer)) return { status: 422, error: "Choose Yes or No." };
  db.prepare("INSERT INTO borrower_question_answers (questionId, revision, answer, at) VALUES (?, ?, ?, ?)")
    .run(data.questionId, data.revision, data.answer, at);
  db.prepare(`UPDATE borrower_questions SET status = 'Answered', answer = ?, answeredAt = ?, revision = revision + 1,
    reviewedAt = NULL, reviewedBy = NULL, clarification = '' WHERE id = ?`).run(data.answer, at, data.questionId);
  addApplicationActivity(db, loanId, `Received a borrower answer · ${recipient}`, at);
  return null;
}
