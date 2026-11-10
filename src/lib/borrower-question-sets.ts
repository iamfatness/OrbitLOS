import { addApplicationActivity } from "./applications";
import { demoBrokerageId } from "./brokerage-model";
import { questionSetChanged, questionSetConfig, questionSetInput, questionSetsUnavailable, type ApplyBorrowerQuestionSet,
  type QuestionSet, type QuestionSetResult } from "./borrower-question-set-model";
import { borrowerQuestionFile, borrowerQuestionSlots, canWorkBorrowerQuestions, insertBorrowerQuestion,
  validBorrowerQuestionDueDate } from "./borrower-questions";
import { easternDate } from "./client-retention";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { accessEvent } from "./workspace-access";

const activeLimit = 20;
const listLimit = 40;
type SetRow = { id: string; revision: number; config: string; archived: number };
function questionSet(row: SetRow): QuestionSet {
  return { ...questionSetConfig.parse(JSON.parse(row.config)), id: row.id, revision: row.revision, archived: Boolean(row.archived) };
}

function settings(db: Store): QuestionSetResult {
  const rows = db.prepare(`SELECT id, revision, config, archived FROM borrower_question_sets
    ORDER BY archived, title COLLATE NOCASE, id LIMIT ?`).all(listLimit + 1) as SetRow[];
  return { kind: "settings", sets: rows.slice(0, listLimit).map(questionSet), moreArchived: rows.length > listLimit };
}

function activationError(db: Store, id: string, title: string) {
  if (db.prepare("SELECT 1 FROM borrower_question_sets WHERE archived = 0 AND id <> ? AND title = ? COLLATE NOCASE").get(id, title)) {
    return "Use a different title for this active question set.";
  }
  if (Number(db.prepare("SELECT count(*) AS total FROM borrower_question_sets WHERE archived = 0 AND id <> ?").get(id)?.total) >= activeLimit) {
    return `Archive a set before activating another one. The limit is ${activeLimit}.`;
  }
}

export function borrowerQuestionSetWork(db: Store, input: unknown, staff: WorkspaceStaff | null, brokerageId: string,
  at = new Date().toISOString()): QuestionSetResult {
  if (!staff || staff.brokerage.id !== brokerageId || (!staff.brokerage.pilot && brokerageId !== demoBrokerageId)) {
    return { error: questionSetsUnavailable };
  }
  const parsed = questionSetInput.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the borrower question set." };
  const data = parsed.data;
  if (data.type === "preview") {
    if (!canWorkBorrowerQuestions(db, data.loanId, staff)) return { error: questionSetsUnavailable };
    const file = borrowerQuestionFile(db, data.loanId, at);
    if (!file?.recipients.length) return { error: "Open an active loan with a submitted 1003 and an available borrower link." };
    const sets = db.prepare(`SELECT id, revision, config, archived FROM borrower_question_sets WHERE archived = 0
      ORDER BY title COLLATE NOCASE, id LIMIT ?`).all(activeLimit) as SetRow[];
    return { kind: "preview", sets: sets.map(questionSet), asOf: easternDate(new Date(at)), ...file,
      remaining: Math.max(0, borrowerQuestionSlots(db, data.loanId)) };
  }
  if (staff.brokerage.role !== "Admin") return { error: questionSetsUnavailable };
  if (data.type === "settings") return settings(db);
  return db.transaction(() => {
    const row = db.prepare("SELECT id, revision, config, archived FROM borrower_question_sets WHERE id = ?").get(data.id) as SetRow | undefined;
    const current = row ? questionSet(row) : undefined;
    const revision = current?.revision ?? 0;
    if (data.type === "archive") {
      if (!current || (revision !== data.revision && !(revision === data.revision + 1 && current.archived === data.archived))) {
        return { error: questionSetChanged };
      }
      if (current.archived === data.archived) return settings(db);
      const error = data.archived ? undefined : activationError(db, current.id, current.title);
      if (error) return { error };
      db.prepare("UPDATE borrower_question_sets SET archived = ?, revision = revision + 1 WHERE id = ?").run(Number(data.archived), data.id);
      accessEvent(db, staff, data.archived ? "Archived borrower question set" : "Restored borrower question set", current.title, at);
      return settings(db);
    }
    const config = JSON.stringify(data.config);
    if (row && !row.archived && row.config === config && [data.revision, data.revision + 1].includes(revision)) return settings(db);
    if (current?.archived || revision !== data.revision) return { error: questionSetChanged };
    const error = activationError(db, data.id, data.config.title);
    if (error) return { error };
    db.prepare(`INSERT INTO borrower_question_sets (id, revision, title, config) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, title = excluded.title, config = excluded.config`)
      .run(data.id, revision + 1, data.config.title, config);
    accessEvent(db, staff, "Published borrower question set", `${data.config.title} · Version ${revision + 1}`, at);
    return settings(db);
  });
}

export function applyBorrowerQuestionSet(db: Store, data: ApplyBorrowerQuestionSet, staff: WorkspaceStaff | null, at: string) {
  if (!canWorkBorrowerQuestions(db, data.loanId, staff)) return { error: questionSetsUnavailable };
  const items = data.items.toSorted((a, b) => a.position - b.position);
  const selection = JSON.stringify({ ...data, items });
  const prior = db.prepare("SELECT selection FROM borrower_question_set_batches WHERE id = ? AND loanId = ?").get(data.batchId, data.loanId);
  if (prior) return prior.selection === selection ? { message: "This question set was already added to the portal." } :
    { error: "This send attempt was already used. Preview the questions again." };
  if (db.prepare("SELECT 1 FROM borrower_question_set_batches WHERE id = ?").get(data.batchId)) return { error: questionSetsUnavailable };
  const file = borrowerQuestionFile(db, data.loanId, at);
  if (!file || file.applicationRevision !== data.applicationRevision) return { error: "The 1003 changed. Refresh the question set preview." };
  const today = easternDate(new Date(at));
  const row = db.prepare("SELECT id, revision, config, archived FROM borrower_question_sets WHERE id = ? AND revision = ? AND archived = 0")
    .get(data.setId, data.revision) as SetRow | undefined;
  if (!row || data.asOf !== today) return { error: questionSetChanged };
  const set = questionSet(row);
  const duplicate = db.prepare(`SELECT 1 FROM borrower_questions WHERE loanId = ? AND recipient = ?
    AND prompt = ? COLLATE NOCASE AND status IN ('Requested', 'Answered', 'Needs clarification') LIMIT 1`);
  if (items.length > borrowerQuestionSlots(db, data.loanId)) return { error: "Choose fewer questions. This loan is at its sample question limit." };
  for (const item of items) {
    const question = set.items[item.position];
    if (!question) return { error: questionSetChanged };
    if (!file.recipients.includes(item.recipient)) return { error: `${item.recipient} needs an active link and submitted 1003 portion.` };
    if (!validBorrowerQuestionDueDate(item.dueOn, today)) return { error: "Choose due dates of today or later." };
    if (duplicate.get(data.loanId, item.recipient, question.prompt)) {
      return { error: `Question ${item.position + 1} is already open for the ${item.recipient.toLowerCase()}. Review it or leave it out.` };
    }
  }

  db.prepare(`INSERT INTO borrower_question_set_batches (id, loanId, setId, setRevision, title, applicationRevision, selection, appliedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(data.batchId, data.loanId, set.id, set.revision, set.title, data.applicationRevision, selection, at);
  for (const { position, recipient, dueOn } of items) {
    const { prompt, kind } = set.items[position];
    insertBorrowerQuestion(db, { questionId: crypto.randomUUID(), loanId: data.loanId, recipient, dueOn, prompt, kind },
      staff?.name ?? "Demo staff", at, data.batchId);
  }
  addApplicationActivity(db, data.loanId, `Applied borrower question set · ${set.title} v${set.revision} · ${items.length} added`, at);
  return { message: `${items.length} borrower ${items.length === 1 ? "question added" : "questions added"} to the portal.` };
}
