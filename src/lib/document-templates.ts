import { addApplicationActivity } from "./applications";
import { demoBrokerageId } from "./brokerage-model";
import { easternDate } from "./client-retention";
import { documentTemplateChanged, documentTemplateConfig, documentTemplateDueOn, documentTemplateLimit,
  documentTemplateRequest, documentTemplatesUnavailable, type applyDocumentTemplateInput, type DocumentTemplate, type DocumentTemplatePage } from "./document-template-model";
import type { WorkspaceStaff } from "./staff-store";
import type { SqlValue, Store } from "./store";
import { accessEvent, loanAccess } from "./workspace-access";
import type { z } from "zod";

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
    const rows = db.prepare(`${templateQuery} WHERE template.archived = 0 AND (template.purpose = 'Any loan purpose' OR template.purpose = ?)
      ORDER BY template.title COLLATE NOCASE, template.id LIMIT ?`).all(loan.purpose, documentTemplateLimit);
    return { templates: rows.map(templateFromRow), asOf, more: false };
  }
  if (staff && staff.brokerage.role !== "Admin") return { error: "Only brokerage admins can manage document templates." };
  return db.transaction(() => {
    if (data.type !== "manage") {
      const row = db.prepare(`${templateQuery} WHERE template.id = ?`).get(data.id);
      const current = row && templateFromRow(row);
      const at = now.toISOString();
      if (data.type === "publish") {
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
    return { templates: rows.slice(0, pageSize).map(templateFromRow), asOf, more: rows.length > pageSize };
  });
}

export function applyDocumentTemplate(db: Store, data: z.infer<typeof applyDocumentTemplateInput>, staff: WorkspaceStaff | null, now: string) {
  if (!supported(staff)) return { error: documentTemplatesUnavailable };
  const loan = readLoan(db, data.loanId, staff);
  if (!loan) return { error: "Checklists are available on active, unfunded loans you can work." };
  const row = db.prepare(`${templateQuery} WHERE template.id = ? AND template.archived = 0 AND template.revision = ?`).get(data.templateId, data.revision);
  if (!row || data.asOf !== easternDate(new Date(now))) return { error: documentTemplateChanged };
  const template = templateFromRow(row);
  if (template.purpose !== "Any loan purpose" && template.purpose !== loan.purpose) {
    return { error: "Choose a checklist for the current loan purpose." };
  }
  const existing = new Set(db.prepare("SELECT kind FROM document_requests WHERE loanId = ? AND conditionId IS NULL")
    .all(data.loanId).map(({ kind }) => kind));
  const insert = db.prepare(`INSERT INTO document_requests (id, loanId, kind, instructions, requestedAt, dueOn) VALUES (?, ?, ?, ?, ?, ?)`);
  const origin = db.prepare("INSERT INTO document_checklist_origins (requestId, templateId, revision) VALUES (?, ?, ?)");
  let added = 0;
  for (const item of template.items) {
    if (existing.has(item.kind)) continue;
    const requestId = crypto.randomUUID();
    const dueOn = documentTemplateDueOn(data.asOf, item.dueDays);
    insert.run(requestId, data.loanId, item.kind, item.instructions, now, dueOn);
    origin.run(requestId, template.id, template.revision);
    added++;
  }
  if (added) {
    addApplicationActivity(db, data.loanId, `Applied ${template.title} · Version ${template.revision} · ${added} added · ${staff?.name ?? "Demo workspace"}`, now);
    accessEvent(db, staff, "Applied document checklist", data.loanId, now);
  }
  return { message: added ? `Added ${added} document ${added === 1 ? "request" : "requests"} from ${template.title}.` :
    "Every item from this template is already on the checklist." };
}
