import { demoBrokerageId } from "./brokerage-model";
import { disclosureTemplateChanged, disclosureTemplateConfig, disclosureTemplateInput, disclosureTemplateUnavailable,
  type DisclosureTemplate, type DisclosureTemplateBasis, type DisclosureTemplateMatch, type DisclosureTemplateOptions,
  type DisclosureTemplateResult } from "./disclosure-template-model";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { accessEvent } from "./workspace-access";

const activeLimit = 24;
const listLimit = 48;
type TemplateRow = { id: string; revision: number; config: string; archived: number };
const matches = `archived = 0 AND (purpose = 'Any loan purpose' OR purpose = ?)
  AND (propertyState = '' OR propertyState = ?)`;

function template(row: TemplateRow): DisclosureTemplate {
  return { ...disclosureTemplateConfig.parse(JSON.parse(row.config)), id: row.id, revision: row.revision, archived: Boolean(row.archived) };
}

const specificity = ({ propertyState, purpose }: DisclosureTemplate) => (propertyState ? 2 : 0) + Number(purpose !== "Any loan purpose");

export function disclosureTemplatesForLoan(db: Store, match: DisclosureTemplateMatch): DisclosureTemplateOptions {
  const rows = db.prepare(`SELECT id, revision, config, archived FROM brokerage_disclosure_templates WHERE ${matches}
    ORDER BY (propertyState <> '') DESC, (purpose <> 'Any loan purpose') DESC, title COLLATE NOCASE, id LIMIT ?`)
    .all(match.purpose, match.propertyState, activeLimit) as TemplateRow[];
  const templates = rows.map(template);
  const [first, next] = templates;
  const recommendedId = first && (!next || specificity(first) > specificity(next)) ? first.id : null;
  return { ...match, templates, recommendedId };
}

export function selectedDisclosureTemplate(db: Store, choice: Pick<DisclosureTemplateBasis, "id" | "revision">, match: DisclosureTemplateMatch) {
  const row = db.prepare(`SELECT id, revision, config, archived FROM brokerage_disclosure_templates
    WHERE id = ? AND revision = ? AND ${matches}`).get(choice.id, choice.revision, match.purpose, match.propertyState) as TemplateRow | undefined;
  if (!row) return;
  const { id, revision, title, purpose, propertyState, documents } = template(row);
  return { basis: { id, revision, title, purpose, propertyState }, documents };
}

function listTemplates(db: Store): DisclosureTemplateResult {
  const rows = db.prepare(`SELECT id, revision, config, archived FROM brokerage_disclosure_templates
    ORDER BY archived, title COLLATE NOCASE, id LIMIT ?`).all(listLimit + 1) as TemplateRow[];
  return { templates: rows.slice(0, listLimit).map(template), moreArchived: rows.length > listLimit };
}

function activationError(db: Store, id: string, title: string) {
  if (db.prepare("SELECT 1 FROM brokerage_disclosure_templates WHERE archived = 0 AND id <> ? AND title = ? COLLATE NOCASE").get(id, title)) {
    return "Use a different title for this active template.";
  }
  if (Number(db.prepare("SELECT count(*) AS total FROM brokerage_disclosure_templates WHERE archived = 0 AND id <> ?").get(id)?.total) >= activeLimit) {
    return `Archive a template before activating another one. The limit is ${activeLimit}.`;
  }
}

export function disclosureTemplateWork(db: Store, input: unknown, staff: WorkspaceStaff | null, brokerageId: string,
  now = new Date().toISOString()): DisclosureTemplateResult {
  if (!staff || staff.brokerage.id !== brokerageId || staff.brokerage.role !== "Admin" ||
    (!staff.brokerage.pilot && brokerageId !== demoBrokerageId)) return { error: disclosureTemplateUnavailable };
  const parsed = disclosureTemplateInput.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the sample template settings." };
  const data = parsed.data;
  if (data.type === "list") return listTemplates(db);
  return db.transaction(() => {
    const row = db.prepare("SELECT id, revision, config, archived FROM brokerage_disclosure_templates WHERE id = ?").get(data.id) as TemplateRow | undefined;
    const current = row ? template(row) : undefined;
    const revision = current?.revision ?? 0;
    if (data.type === "archive") {
      if (!current || (revision !== data.revision && !(revision === data.revision + 1 && current.archived === data.archived))) {
        return { error: disclosureTemplateChanged };
      }
      if (current.archived === data.archived) return listTemplates(db);
      const error = data.archived ? undefined : activationError(db, current.id, current.title);
      if (error) return { error };
      db.prepare("UPDATE brokerage_disclosure_templates SET archived = ?, revision = revision + 1 WHERE id = ?").run(Number(data.archived), data.id);
      accessEvent(db, staff, data.archived ? "Archived sample disclosure template" : "Restored sample disclosure template",
        `${current.title} · Version ${revision + 1}`, now);
      return listTemplates(db);
    }
    const { title, purpose, propertyState } = data.config;
    const config = JSON.stringify(data.config);
    if (row && !row.archived && row.config === config && [data.revision, data.revision + 1].includes(revision)) return listTemplates(db);
    if (current?.archived || revision !== data.revision) return { error: disclosureTemplateChanged };
    const error = activationError(db, data.id, title);
    if (error) return { error };
    db.prepare(`INSERT INTO brokerage_disclosure_templates (id, revision, title, purpose, propertyState, config)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, title = excluded.title,
      purpose = excluded.purpose, propertyState = excluded.propertyState, config = excluded.config`)
      .run(data.id, revision + 1, title, purpose, propertyState, config);
    accessEvent(db, staff, "Published sample disclosure template", `${title} · Version ${revision + 1}`, now);
    return listTemplates(db);
  });
}
