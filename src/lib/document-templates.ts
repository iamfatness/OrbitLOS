import { addApplicationActivity } from "./applications";
import { demoBrokerageId } from "./brokerage-model";
import { easternDate } from "./client-retention";
import { documentAnswerKey, documentTemplateApplicationChanged, documentTemplateChanged, documentTemplateConfig, documentTemplateDueOn, documentTemplateLimit,
  documentTemplateRequest, documentTemplatesUnavailable, type applyDocumentTemplateInput, type DocumentAnswerChoice, type DocumentTemplate, type DocumentTemplatePage } from "./document-template-model";
import type { WorkspaceStaff } from "./staff-store";
import type { SqlValue, Store } from "./store";
import { accessEvent, loanAccess } from "./workspace-access";
import type { z } from "zod";
import { documentRecipientAvailable } from "./borrower-documents";
import { primaryDocumentRecipient } from "./document-model";
import { documentRuleDecision, reviewedDocumentFacts } from "./document-template-rules";
import { currentQuoteForm } from "./quote-intake";
import { quotePurpose } from "./quote-intake-model";

function supported(staff: WorkspaceStaff | null) {
  return !staff || staff.brokerage.id === demoBrokerageId || !!staff.brokerage.pilot;
}

function readLoan(db: Store, loanId: string, staff: WorkspaceStaff | null) {
  if (staff && !loanAccess(db, staff, loanId)) return;
  return db.prepare("SELECT purpose FROM loans WHERE id = ? AND disposition = 'Active' AND stage NOT IN ('Funded', 'Closed')").get(loanId);
}

const templateQuery = `SELECT template.id, template.revision, template.archived, version.config
  FROM document_checklist_templates template JOIN document_checklist_versions version
  ON version.templateId = template.id AND version.revision = template.revision`;

function templateFromRow(row: Record<string, SqlValue>): DocumentTemplate {
  return { ...documentTemplateConfig.parse(JSON.parse(String(row.config))),
    id: String(row.id), revision: Number(row.revision), archived: Boolean(row.archived) };
}

function availableSlots(db: Store) {
  return Number(db.prepare("SELECT count(*) AS total FROM document_checklist_templates WHERE archived = 0").get()?.total) < documentTemplateLimit;
}

function titleAvailable(db: Store, title: string, id: string) {
  return !db.prepare(`SELECT 1 FROM document_checklist_templates
    WHERE archived = 0 AND title = ? COLLATE NOCASE AND id <> ?`).get(title, id);
}

function documentAnswerChoices(db: Store) {
  const forms = [currentQuoteForm(db), ...quotePurpose.options.map((purpose) => currentQuoteForm(db, purpose))];
  const choices = new Map<string, DocumentAnswerChoice>();
  for (const { profile, config } of forms) {
    for (const question of config.applicationQuestions ?? []) {
      if (question.kind !== "Yes or no") continue;
      const choice = { profile, questionId: question.id, prompt: question.prompt };
      choices.set(documentAnswerKey(choice), choice);
    }
  }
  return [...choices.values()];
}

export function documentTemplateWork(db: Store, input: unknown, staff: WorkspaceStaff | null, brokerageId: string,
  now = new Date()): DocumentTemplatePage | { error: string } {
  if (!supported(staff) || (staff ? staff.brokerage.id !== brokerageId : brokerageId !== demoBrokerageId)) {
    return { error: documentTemplatesUnavailable };
  }
  const parsed = documentTemplateRequest.safeParse(input);
  if (!parsed.success) return { error: "Check the checklist title, document types, instructions and deadline days." };
  const data = parsed.data;
  const asOf = easternDate(now);
  if (data.type === "loan") {
    const loan = readLoan(db, data.loanId, staff);
    if (!loan) return { error: "Checklists are available on active, unfunded loans you can work." };
    const recipient = data.recipient ?? primaryDocumentRecipient;
    if (!documentRecipientAvailable(db, data.loanId, recipient)) return { error: "Set up a separate co-borrower link before previewing their checklist." };
    const rows = db.prepare(`${templateQuery} WHERE template.archived = 0 AND (template.purpose = 'Any loan purpose' OR template.purpose = ?)
      ORDER BY template.title COLLATE NOCASE, template.id LIMIT ?`).all(loan.purpose, documentTemplateLimit);
    const templates = rows.map(templateFromRow);
    const conditional = templates.filter((template) => template.items.some((item) => item.when));
    const answerRules = conditional.some((template) => template.items.some((item) => item.when?.answer));
    const facts = conditional.length ? reviewedDocumentFacts(db, data.loanId, recipient, answerRules) : null;
    const matches: NonNullable<DocumentTemplatePage["preview"]>["matches"] = {};
    const answerEvidence: NonNullable<DocumentTemplatePage["preview"]>["answerEvidence"] = {};
    for (const template of conditional) {
      matches[template.id] = {};
      for (const item of template.items) {
        if (!item.when) continue;
        const { match, basis } = documentRuleDecision(item.when, facts);
        matches[template.id][item.kind] = match;
        if (basis) (answerEvidence[template.id] ??= {})[item.kind] = basis;
      }
    }
    return { templates, asOf, more: false, preview: { recipient, reviewedRevision: facts?.revision ?? null, matches,
      ...(answerRules ? { answerEvidence } : {}) } };
  }
  if (staff && staff.brokerage.role !== "Admin") return { error: "Only brokerage admins can manage document templates." };
  return db.transaction(() => {
    const answerChoices = documentAnswerChoices(db);
    if (data.type !== "manage") {
      const row = db.prepare(`${templateQuery} WHERE template.id = ?`).get(data.id);
      const current = row && templateFromRow(row);
      const at = now.toISOString();
      if ("config" in data) {
        if (data.type !== "publishAnswerRules" && (data.config.items.some((item) => item.when?.answer) || current?.items.some((item) => item.when?.answer))) {
          return { error: "Reload Orbit to edit a checklist with brokerage answer rules." };
        }
        if (data.type === "publish" && (data.config.items.some((item) => item.when) || current?.items.some((item) => item.when))) {
          return { error: "Reload Orbit to edit a checklist with reviewed 1003 rules." };
        }
        for (const item of data.config.items) {
          if (!item.when?.answer) continue;
          const key = documentAnswerKey(item.when.answer);
          const prior = current?.items.find(({ kind }) => kind === item.kind)?.when?.answer;
          if (!answerChoices.some((choice) => documentAnswerKey(choice) === key) && (!prior || documentAnswerKey(prior) !== key)) {
            return { error: "Choose a published yes-or-no application question for each new answer rule." };
          }
        }
        const config = JSON.stringify(data.config);
        if (!current || (current.revision === data.revision && row?.config !== config)) {
          if ((current?.revision ?? 0) !== data.revision || current?.archived) return { error: documentTemplateChanged };
          if (!current && !availableSlots(db)) return { error: `Archive an active template before publishing another. The limit is ${documentTemplateLimit}.` };
          if (!titleAvailable(db, data.config.title, data.id)) return { error: "Choose a different title for this active checklist." };
          const version = data.revision + 1;
          db.prepare(`INSERT INTO document_checklist_templates (id, title, purpose, revision) VALUES (?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET title = excluded.title, purpose = excluded.purpose, revision = excluded.revision`)
            .run(data.id, data.config.title, data.config.purpose, version);
          db.prepare("INSERT INTO document_checklist_versions (templateId, revision, config, publishedAt, publishedBy) VALUES (?, ?, ?, ?, ?)")
            .run(data.id, version, config, at, staff?.email ?? "Demo workspace");
          accessEvent(db, staff, "Published document checklist", `${data.config.title} · Version ${version}`, at);
        } else if (current.archived || row?.config !== config || ![data.revision, data.revision + 1].includes(current.revision)) {
          return { error: documentTemplateChanged };
        }
      } else {
        if (!current || (current.revision !== data.revision &&
          !(current.revision === data.revision + 1 && current.archived === data.archived))) return { error: documentTemplateChanged };
        if (current.archived !== data.archived) {
          if (!data.archived && (!availableSlots(db) || !titleAvailable(db, current.title, current.id))) {
            return { error: "Free an active template slot and make its title available before restoring this checklist." };
          }
          // Advance the version even if the fields did not change so an old preview cannot apply after a restore.
          const version = current.revision + 1;
          db.prepare("UPDATE document_checklist_templates SET archived = ?, revision = ? WHERE id = ?")
            .run(Number(data.archived), version, data.id);
          db.prepare(`INSERT INTO document_checklist_versions (templateId, revision, config, publishedAt, publishedBy)
            SELECT templateId, ?, config, ?, ? FROM document_checklist_versions WHERE templateId = ? AND revision = ?`)
            .run(version, at, staff?.email ?? "Demo workspace", data.id, current.revision);
          accessEvent(db, staff, data.archived ? "Archived document checklist" : "Restored document checklist", current.title, at);
        }
      }
    }
    const search = data.type === "manage" ? data.search : "";
    const pageSize = 30;
    const rows = db.prepare(`${templateQuery} WHERE instr(lower(template.title), lower(?)) > 0
      ORDER BY template.archived, template.title COLLATE NOCASE, template.id LIMIT ?`).all(search, pageSize + 1);
    return { templates: rows.slice(0, pageSize).map(templateFromRow), asOf, more: rows.length > pageSize, answerChoices };
  });
}

export function applyDocumentTemplate(db: Store, data: z.infer<typeof applyDocumentTemplateInput>, staff: WorkspaceStaff | null, now: string) {
  if (!supported(staff)) return { error: documentTemplatesUnavailable };
  const loan = readLoan(db, data.loanId, staff);
  if (!loan) return { error: "Checklists are available on active, unfunded loans you can work." };
  const recipient = data.recipient ?? primaryDocumentRecipient;
  if (!documentRecipientAvailable(db, data.loanId, recipient)) return { error: "Set up a separate co-borrower link before assigning documents to them." };
  const row = db.prepare(`${templateQuery} WHERE template.id = ? AND template.archived = 0 AND template.revision = ?`).get(data.templateId, data.revision);
  if (!row || data.asOf !== easternDate(new Date(now))) return { error: documentTemplateChanged };
  const template = templateFromRow(row);
  if (template.purpose !== "Any loan purpose" && template.purpose !== loan.purpose) {
    return { error: "Choose a checklist for the current loan purpose." };
  }
  const conditional = template.items.some((item) => item.when);
  const answerRules = template.items.some((item) => item.when?.answer);
  if (answerRules && !data.selectedKinds) return { error: "Reload Orbit and select the document requests to add." };
  const facts = conditional ? reviewedDocumentFacts(db, data.loanId, recipient, answerRules) : null;
  if (conditional && data.reviewedRevision !== (facts?.revision ?? null)) return { error: documentTemplateApplicationChanged };
  const matching = template.items.flatMap((item) => {
    if (data.selectedKinds && !data.selectedKinds.includes(item.kind)) return [];
    const { match, basis } = documentRuleDecision(item.when, facts);
    return match === "Matches" ? [{ ...item, basis }] : [];
  });
  if (data.selectedKinds && matching.length !== data.selectedKinds.length) {
    return { error: "A selected request no longer matches this applicant. Reload templates and review the requests again." };
  }
  const existing = new Set(db.prepare("SELECT kind FROM document_requests WHERE loanId = ? AND recipient = ? AND conditionId IS NULL")
    .all(data.loanId, recipient).map(({ kind }) => kind));
  const insert = db.prepare(`INSERT INTO document_requests (id, loanId, kind, instructions, requestedAt, dueOn, recipient) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const origin = db.prepare("INSERT INTO document_checklist_origins (requestId, templateId, revision, applicationRevision, answerBasis) VALUES (?, ?, ?, ?, ?)");
  let added = 0;
  for (const item of matching) {
    if (existing.has(item.kind)) continue;
    const requestId = crypto.randomUUID();
    const dueOn = documentTemplateDueOn(data.asOf, item.dueDays);
    insert.run(requestId, data.loanId, item.kind, item.instructions, now, dueOn, recipient);
    origin.run(requestId, template.id, template.revision, item.when ? facts?.revision ?? null : null, item.basis ? JSON.stringify(item.basis) : null);
    added++;
  }
  if (added) {
    addApplicationActivity(db, data.loanId, `Applied ${template.title} · Version ${template.revision} · ${added} added · ${recipient} · ${staff?.name ?? "Demo workspace"}`, now);
    accessEvent(db, staff, "Applied document checklist", data.loanId, now);
  }
  return { message: added ? `Added ${added} document ${added === 1 ? "request" : "requests"} from ${template.title}.` :
    !conditional ? "Every item from this template is already on the checklist." :
      matching.length ? "The matching items are already on the checklist." : "No checklist items match the currently reviewed answers." };
}
