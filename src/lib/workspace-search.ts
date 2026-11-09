import type { BrokerageRole } from "./brokerage-model";
import { currentConversationContact, relationshipConversationAccess } from "./conversations";
import { assignedContactScope, fullContactScope, loanScope, readContactRecord } from "./contact-directory";
import type { WorkspaceStaff } from "./staff-store";
import { leadWorkRecord, type Store } from "./store";
import { refreshSearchIndex } from "./workspace-search-index";
import { searchKinds, searchRecordUnavailable, searchUnavailable, workspaceSearchInput, type SearchQuery,
  type SearchRecord, type SearchResult } from "./workspace-search-model";

const pageSize = 20;
const processorLoanLimit = 32;
const processorCandidateLimit = 256;
const filters = {
  "All records": null,
  Loans: ["loan", "submission", "loan"], Leads: ["lead", "lead"], Contacts: ["contact", "contact"],
  "Realtor partners": ["contact", "partner"], Tasks: ["task", "task"], Documents: ["document", "document"],
  Conversations: ["conversation", "leadConversation", "contactConversation", "conversation"],
} as const;

function leadScope(role: BrokerageRole) {
  if (role === "Admin") return "1";
  return role === "LO" ? "(lead.officerEmail = actor.email OR (lead.officerEmail IS NULL AND lead.realtorId IS NULL))" : "0";
}

function prefixQuery(query: string) {
  const digits = query.replace(/[^0-9]/g, "");
  const terms = query.normalize("NFC").match(/[\p{L}\p{N}\p{M}]+/gu) ?? [];
  if (!terms.some((term) => /[\p{L}\p{N}]/u.test(term)) || terms.join("").length < 2 || terms.length > 8) return null;
  const prefix = terms.map((term) => `"${term}"*`).join(" AND ");
  return terms.length > 1 && /^[0-9+().\s-]+$/.test(query) && digits.length >= 5 ? `(${prefix}) OR "${digits}"*` : prefix;
}

function openSearchRecord(db: Store, staff: WorkspaceStaff, kind: "lead" | "contact" | "partner", id: string): SearchResult {
  const role = staff.brokerage.role;
  if (kind === "lead") {
    return db.transaction(() => {
      const allowed = db.prepare(`SELECT lead.id FROM referral_leads lead CROSS JOIN (SELECT ? AS email) actor
        WHERE lead.id = ? AND lead.resolvedAt IS NULL AND ${leadScope(role)}`).get(staff.email, id);
      const work = allowed && leadWorkRecord(db, id, role === "LO" ? staff.email : undefined);
      return work ? { kind: "lead", ...work } : { error: searchRecordUnavailable };
    });
  }
  return readContactRecord(db, staff, id, { kind }) ?? { error: searchRecordUnavailable };
}

export function readWorkspaceSearch(db: Store, input: unknown, staff: WorkspaceStaff | null, brokerageId: string): SearchResult {
  if (!staff || staff.brokerage.id !== brokerageId) return { error: searchUnavailable };
  const parsed = workspaceSearchInput.safeParse(input);
  if (!parsed.success) return { error: "Enter a search of up to 100 characters and choose a valid filter." };
  const query = parsed.data;
  if (query.type === "open") return openSearchRecord(db, staff, query.kind, query.id);
  const terms = prefixQuery(query.query);
  if (!terms) return { error: "Enter at least two letters or digits and use up to eight words." };
  const indexing = refreshSearchIndex(db);
  return searchMatches(db, staff, query, terms, indexing);
}

function processorSearchCandidates(db: Store, email: string) {
  const assignments = db.prepare("SELECT loanId FROM loan_processing WHERE processorEmail = ? LIMIT ?").all(email, processorLoanLimit + 1);
  if (assignments.length > processorLoanLimit) return null;
  if (!assignments.length) return [];
  // These are the only source kinds available to processors. Leave all record
  // checks in the result query, including the current conversation participant.
  // Borrower and partner share one branch to stay within Workerd's UNION limit.
  const rows = db.prepare(`WITH assigned AS MATERIALIZED (
    SELECT loan.id, loan.contactId, loan.partnerId FROM json_each(?) selected
    CROSS JOIN loans loan ON loan.id = selected.value
  ), sources(kind, recordId) AS (
    SELECT 'loan', id FROM assigned
    UNION ALL SELECT 'contact', contact.id FROM assigned CROSS JOIN contacts contact ON contact.id IN (assigned.contactId, assigned.partnerId)
    UNION ALL SELECT 'submission', submission.id FROM assigned CROSS JOIN submissions submission ON submission.loanId = assigned.id
    UNION ALL SELECT 'document', document.id FROM assigned CROSS JOIN document_requests document ON document.loanId = assigned.id
    UNION ALL SELECT 'conversation', thread.id FROM assigned CROSS JOIN loan_conversations thread ON thread.loanId = assigned.id
    LIMIT ?
  )
  SELECT catalog.id FROM sources LEFT JOIN workspace_search_catalog catalog ON catalog.kind = sources.kind AND catalog.recordId = sources.recordId`)
    .all(JSON.stringify(assignments.map(({ loanId }) => loanId)), processorCandidateLimit + 1);
  if (rows.length > processorCandidateLimit) return null;
  return [...new Set(rows.flatMap(({ id }) => typeof id === "number" ? [id] : []))];
}

function searchMatches(db: Store, staff: WorkspaceStaff, { filter, after }: SearchQuery, terms: string, indexing: boolean): SearchResult {
  const role = staff.brokerage.role;
  const scopedIds = role === "Processor" ? processorSearchCandidates(db, staff.email) : null;
  if (scopedIds?.length === 0) return { kind: "results", rows: [], indexing, next: null };
  const candidateIds = scopedIds ? JSON.stringify(scopedIds) : null;
  // Keep one FTS pass. A direct rowid IN lets SQLite rerun MATCH for each ID.
  const candidateFilter = candidateIds ? "AND CAST(workspace_search_fts.rowid AS INTEGER) IN (SELECT value FROM json_each(?))" : "";
  const order = `CASE kind ${searchKinds.map((type, index) => `WHEN '${type}' THEN ${index}`).join(" ")} END`;
  const address = `CASE WHEN loan.address <> '' THEN ' · ' || loan.address ELSE ' · Property pending' END`;
  const readMatches = (category: (typeof filters)[keyof typeof filters], distinct: boolean) => {
    const kind = category?.at(-1);
    const match = category ? `kind : (${category.slice(0, -1).join(" OR ")}) AND body : (${terms})` : `body : (${terms})`;
    return db.prepare(`WITH actor(email) AS (VALUES (?)), matched AS (
    SELECT catalog.kind, catalog.recordId FROM workspace_search_fts
    JOIN workspace_search_catalog catalog ON catalog.id = workspace_search_fts.rowid
    WHERE workspace_search_fts MATCH ? ${candidateFilter}
      AND NOT EXISTS (SELECT 1 FROM workspace_search_dirty dirty
      WHERE dirty.kind = catalog.kind AND dirty.recordId = catalog.recordId)
  ), visible AS (
    SELECT ${distinct ? "DISTINCT" : ""}
      CASE WHEN matched.kind = 'submission' THEN 'loan'
        WHEN matched.kind IN ('leadConversation', 'contactConversation') THEN 'conversation'
        WHEN matched.kind = 'contact' AND contact.role = 'Realtor' THEN 'partner' ELSE matched.kind END AS kind,
      CASE WHEN matched.kind = 'submission' THEN loan.id ELSE matched.recordId END AS id,
      loan.id AS loanId,
      CASE matched.kind WHEN 'contact' THEN contact.name WHEN 'lead' THEN lead.name WHEN 'task' THEN task.title
        WHEN 'document' THEN document.kind WHEN 'conversation' THEN participant.name
        WHEN 'leadConversation' THEN lead.name WHEN 'contactConversation' THEN relationship.name ELSE borrower.name END AS title,
      CASE matched.kind
        WHEN 'contact' THEN contact.role || CASE WHEN contact.email <> '' THEN ' · ' || contact.email WHEN contact.phone <> '' THEN ' · ' || contact.phone ELSE '' END
        WHEN 'lead' THEN lead.purpose || ' · ' || CASE WHEN lead.heldAt IS NOT NULL THEN 'On hold' WHEN lead.realtorId IS NOT NULL THEN 'Realtor referral' ELSE 'Open lead' END
          || CASE WHEN lead.email <> '' THEN ' · ' || lead.email WHEN lead.phone <> '' THEN ' · ' || lead.phone ELSE '' END
        WHEN 'task' THEN borrower.name || ${address} || CASE WHEN task.completedAt IS NULL THEN ' · Open' ELSE ' · Completed' END
        WHEN 'document' THEN borrower.name || ${address} || ' · ' || document.status
        WHEN 'conversation' THEN thread.audience || ' · ' || borrower.name || ${address} || ' · ' || thread.status
        WHEN 'leadConversation' THEN 'Lead conversation · ' || lead.purpose || ' · ' || leadThread.status
        WHEN 'contactConversation' THEN 'Contact conversation · ' || relationship.role || ' · ' || contactThread.status
        ELSE loan.purpose || ' · ' || CASE WHEN loan.disposition = 'Active' THEN loan.stage ELSE loan.disposition END || ${address} END AS detail
    FROM matched CROSS JOIN actor
    LEFT JOIN contacts contact ON matched.kind = 'contact' AND contact.id = matched.recordId
    LEFT JOIN lead_conversations leadThread ON matched.kind = 'leadConversation' AND leadThread.id = matched.recordId
    LEFT JOIN referral_leads lead ON lead.id = CASE matched.kind WHEN 'lead' THEN matched.recordId WHEN 'leadConversation' THEN leadThread.leadId END
    LEFT JOIN contact_conversations contactThread ON matched.kind = 'contactConversation' AND contactThread.id = matched.recordId
    LEFT JOIN contacts relationship ON relationship.id = contactThread.contactId
    LEFT JOIN submissions submission ON matched.kind = 'submission' AND submission.id = matched.recordId
    LEFT JOIN tasks task ON matched.kind = 'task' AND task.id = matched.recordId
    LEFT JOIN document_requests document ON matched.kind = 'document' AND document.id = matched.recordId
    LEFT JOIN loan_conversations thread ON matched.kind = 'conversation' AND thread.id = matched.recordId
    LEFT JOIN loans loan ON loan.id = CASE matched.kind WHEN 'loan' THEN matched.recordId WHEN 'submission' THEN submission.loanId
      WHEN 'task' THEN task.loanId WHEN 'document' THEN document.loanId WHEN 'conversation' THEN thread.loanId END
    LEFT JOIN contacts borrower ON borrower.id = loan.contactId
    LEFT JOIN contacts participant ON participant.id = thread.contactId
    WHERE (contact.id IS NOT NULL AND (${fullContactScope(role)} OR ${assignedContactScope(role)}))
      OR (lead.id IS NOT NULL AND lead.resolvedAt IS NULL AND (
        (matched.kind = 'lead' AND ${leadScope(role)}) OR
        (matched.kind = 'leadConversation' AND ${relationshipConversationAccess(role, "lead.officerEmail", "actor.email")})
      ))
      OR (relationship.id IS NOT NULL AND ${relationshipConversationAccess(role, "contactThread.ownerEmail", "actor.email")})
      OR (loan.id IS NOT NULL AND ${loanScope(role, "loan")} AND (matched.kind <> 'task' OR ${Number(role !== "Processor")})
        AND (matched.kind <> 'conversation' OR (${currentConversationContact} AND participant.id IS NOT NULL)))
  )
  SELECT * FROM visible WHERE 1 = 1 ${kind ? "AND kind = ?" : ""}
    ${after ? `AND (${order}, title COLLATE NOCASE, id) > (?, ?, ?)` : ""}
    ORDER BY ${order}, title COLLATE NOCASE, id LIMIT ${pageSize + 1}`).all(staff.email, match, ...(candidateIds ? [candidateIds] : []),
    ...(kind ? [kind] : []), ...(after ? [searchKinds.indexOf(after.kind), after.title, after.id] : [])) as unknown as SearchRecord[];
  };
  function orderedMatches(category: (typeof filters)[keyof typeof filters]) {
    // Matching lender references can repeat a loan. A full candidate window
    // with duplicates needs a distinct query to get the correct lookahead.
    const candidates = readMatches(category, false);
    const unique = [...new Map(candidates.map((row) => [JSON.stringify(row), row])).values()];
    return candidates.length > pageSize && unique.length !== candidates.length ? readMatches(category, true) : unique;
  }
  // Loans sort before all other kinds. For a broad prefix, skip the other
  // kinds only when the authorized loans fill this page and its lookahead.
  const tryLoansFirst = filter === "All records" && role !== "Processor" && (!after || after.kind === "loan") && /^"[^"\s]+"\*$/.test(terms);
  const loans = tryLoansFirst ? orderedMatches(filters.Loans) : [];
  const rows = loans.length > pageSize ? loans : orderedMatches(filters[filter]);
  const page = rows.slice(0, pageSize).map((row) => ({ ...row }));
  const last = page.at(-1);
  return { kind: "results", rows: page, indexing, next: rows.length > pageSize && last ? { kind: last.kind, title: last.title, id: last.id } : null };
}
