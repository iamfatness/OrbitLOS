import { draftQueueInput, draftQueueUnavailable, type DraftQueuePage, type DraftQueueRow } from "./communication-draft-model";
import { draftMilestoneStages } from "./communication-templates";
import { fullContactScope } from "./contact-directory";
import type { WorkspaceStaff } from "./staff-store";
import { readBrokerageTemplates, type Store } from "./store";

const pageSize = 20;
const linked = "coalesce(draft.contactId = CASE draft.audience WHEN 'Borrower' THEN loan.contactId ELSE loan.partnerId END, 0)";
const copied = "(coalesce(draft.emailCopiedAt, '') <> '' OR coalesce(draft.textCopiedAt, '') <> '')";
const current = `CASE draft.milestone
  WHEN 'Application received' THEN 1
  WHEN 'Closing complete' THEN coalesce(profile.closingDate, '') <> ''
  ${Object.entries(draftMilestoneStages).map(([milestone, stages]) =>
    `WHEN '${milestone}' THEN loan.stage IN (${stages.map((stage) => `'${stage}'`).join(", ")})`).join("\n")}
  ELSE draft.milestone = loan.stage END`;
const filters = {
  "Ready to copy": `${linked} AND coalesce(draft.supersededAt, '') = '' AND NOT ${copied} AND (${current})`,
  Copied: copied,
  "All drafts": "1",
};

export function readDraftQueue(db: Store, input: unknown, staff: WorkspaceStaff | null): DraftQueuePage | { error: string } {
  const parsed = draftQueueInput.safeParse(input);
  if (!parsed.success) return { error: draftQueueUnavailable };
  const { view, after } = parsed.data;
  const role = staff?.brokerage.role ?? "Admin";
  const owner = role === "LO" ? "loan.officerEmail = ?" : role === "Processor" ? "processing.processorEmail = ?" : "1";
  const source = role === "LO" ? "loans loan CROSS JOIN communication_drafts draft ON draft.loanId = loan.id" :
    role === "Processor" ? `loan_processing processing CROSS JOIN loans loan ON loan.id = processing.loanId
      CROSS JOIN communication_drafts draft ON draft.loanId = loan.id` :
    "communication_drafts draft JOIN loans loan ON loan.id = draft.loanId";
  const rows = db.prepare(`SELECT draft.id, draft.loanId, draft.audience, draft.milestone, draft.createdAt, draft.emailCopiedAt,
    draft.textCopiedAt, draft.supersededAt, contact.name AS recipient, borrower.name AS borrower, ${linked} AS linked, (${current}) AS current
    FROM ${source} CROSS JOIN (SELECT ? AS email) actor
    LEFT JOIN contacts contact ON contact.id = draft.contactId AND ${fullContactScope(role)}
    LEFT JOIN contacts borrower ON borrower.id = loan.contactId
    LEFT JOIN past_client_profiles profile ON profile.loanId = loan.id
    WHERE ${owner} AND ${filters[view]} ${after ? "AND (draft.createdAt, draft.id) < (?, ?)" : ""}
    ORDER BY draft.createdAt DESC, draft.id DESC LIMIT ?`).all(staff?.email ?? "",
      ...(staff && role !== "Admin" ? [staff.email] : []), ...(after ? [after.createdAt, after.id] : []), pageSize + 1);
  const page = rows.slice(0, pageSize).map((row) => ({ ...row, linked: Boolean(row.linked), current: Boolean(row.current) }) as DraftQueueRow);
  const last = page.at(-1);
  return { rows: page, next: rows.length > pageSize && last ? { id: last.id, createdAt: last.createdAt } : null,
    ...(role === "Admin" && !after ? { templates: readBrokerageTemplates(db) } : {}) };
}
