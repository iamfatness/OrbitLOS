import { preapprovalTemplateConfig,
  type PreapprovalTemplate, type PreapprovalTemplateRequest, type PreapprovalTemplateResult, type PreapprovalTemplateSnapshot } from "./preapproval-template-model";
import type { WorkspaceStaff } from "./staff-store";
import type { SqlValue, Store } from "./store";
import { accessEvent } from "./workspace-access";
import { pdfText } from "./pdf-document";

const activeLimit = 20;
const latest = `SELECT head.id, head.revision, version.config, version.archived
  FROM sample_preapproval_templates head JOIN sample_preapproval_template_versions version
  ON version.templateId = head.id AND version.revision = head.revision`;

function template(row: Record<string, SqlValue>): PreapprovalTemplate {
  return { ...preapprovalTemplateConfig.parse(JSON.parse(String(row.config))), id: String(row.id),
    revision: Number(row.revision), archived: Boolean(row.archived) };
}

export function availablePreapprovalTemplates(db: Store) {
  return db.prepare(`${latest} WHERE version.archived = 0 ORDER BY head.title COLLATE NOCASE, head.id LIMIT ?`)
    .all(activeLimit).map(template).map(({ id, title, revision }) => ({ id, title, revision }));
}

export function resolvePreapprovalTemplate(db: Store, reference: Pick<PreapprovalTemplateSnapshot, "id" | "revision">) {
  const row = db.prepare(`${latest} WHERE head.id = ? AND head.revision = ? AND version.archived = 0`)
    .get(reference.id, reference.revision);
  if (!row) return;
  const { id, revision, title, note } = template(row);
  return { id, revision, title, note };
}

export function workOnPreapprovalTemplates(db: Store, data: PreapprovalTemplateRequest, staff: WorkspaceStaff, at: string):
  PreapprovalTemplateResult | { error: string } {
  if (staff.brokerage.role !== "Admin") return { error: "Only brokerage admins can manage sample preapproval templates." };
  if (data.type === "templateHistory") {
    const rows = db.prepare(`SELECT templateId AS id, revision, config, archived, publishedAt
      FROM sample_preapproval_template_versions WHERE templateId = ? AND revision < ?
      ORDER BY revision DESC LIMIT 9`).all(data.id, data.beforeRevision ?? Number.MAX_SAFE_INTEGER);
    if (!rows.length && !data.beforeRevision) return { error: "This sample template is unavailable." };
    const history = rows.slice(0, 8).map((row) => ({ ...template(row), publishedAt: String(row.publishedAt) }));
    return { history, beforeRevision: rows.length > history.length ? history.at(-1)!.revision : null };
  }
  if (data.type !== "templateList") {
    const row = db.prepare(`${latest} WHERE head.id = ?`).get(data.id);
    const prior = row ? template(row) : undefined;
    const archived = data.type === "templateArchive" && data.archived;
    const config = data.type === "templatePublish" ? data.config : prior && { title: prior.title, note: prior.note };
    const stale = "The sample template changed. Refresh templates before saving again.";
    if (!config || (data.type === "templatePublish" && prior?.archived)) return { error: stale };
    if (data.type === "templatePublish") {
      try { pdfText(config.note.replace(/\s+/g, " ")); }
      catch { return { error: "Use Latin-script text in the sample letter note so it can render in the PDF." }; }
    }
    const encoded = JSON.stringify(config);
    const revision = prior?.revision ?? 0;
    const same = prior?.archived === archived && row?.config === encoded;
    if (revision !== data.revision && !(same && revision === data.revision + 1)) return { error: stale };
    if (!same) {
      if (!archived && db.prepare(`${latest} WHERE version.archived = 0 AND head.title = ? COLLATE NOCASE AND head.id <> ?`)
        .get(config.title, data.id)) return { error: "Choose a different name for this active sample template." };
      if (!archived && (!prior || prior.archived) && availablePreapprovalTemplates(db).length >= activeLimit) {
        return { error: `Archive a template before adding another. The active limit is ${activeLimit}.` };
      }
      db.prepare(`INSERT INTO sample_preapproval_templates (id, revision, title) VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, title = excluded.title`).run(data.id, revision + 1, config.title);
      db.prepare(`INSERT INTO sample_preapproval_template_versions (templateId, revision, config, archived, publishedAt)
        VALUES (?, ?, ?, ?, ?)`).run(data.id, revision + 1, encoded, Number(archived), at);
      accessEvent(db, staff, archived ? "Archived sample preapproval template" : "Published sample preapproval template",
        `${config.title} · v${revision + 1}`, at);
    }
  }
  const search = data.type === "templateList" ? data.search : "";
  const rows = db.prepare(`${latest} WHERE instr(lower(head.title), lower(?)) > 0
    ORDER BY version.archived, head.title COLLATE NOCASE, head.id LIMIT 31`).all(search);
  return { templates: rows.slice(0, 30).map(template), more: rows.length > 30 };
}
