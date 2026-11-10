import { createHash } from "node:crypto";
import type { z } from "zod";
import { linkedChannelLeadIds, readBorrowerHours, readContactChannelBlocks, setBorrowerHours, setContactChannelBlocks } from "./borrower-channels";
import { reconcileBorrowerSequences } from "./borrower-sequences";
import { contactMatchFields, contactMergeInput, contactMergeUnavailable, type ContactMergeCursor, type ContactMergeHistory,
  type ContactMergeHistoryRow, type ContactMergePreview, type ContactMergeResult, type ContactUndoPreview } from "./contact-merge-model";
import type { Contact } from "./model";
import { blockedOutreachKeys, closeSuppressedOutreach, outreachSuppressed, retainContactOptOut } from "./outreach-preferences";
import { referralPhone } from "./referral-matches";
import type { WorkspaceStaff } from "./staff-store";
import { insertContact, type Store, type SqlValue } from "./store";
import { accessEvent } from "./workspace-access";
import { readDuplicateGroups, readDuplicateHistory, readDuplicateMembers, writeDuplicateDecision } from "./contact-duplicate-queue";

const linkLimit = 250;
const links = [
  ["loans", "contactId", "id", "Borrower loans"],
  ["loans", "partnerId", "id", "Realtor loan links"],
  ["referral_leads", "importedContactId", "id", "Linked leads"],
  ["referral_leads", "realtorId", "id", "Realtor referrals"],
  ["contact_activity", "contactId", "id", "Contact activity and follow-ups"],
  ["loan_conversations", "contactId", "id", "Loan conversations"],
  ["contact_conversations", "contactId", "id", "Contact conversations"],
  ["communication_drafts", "contactId", "id", "Communication drafts"],
  ["realtor_portals", "realtorId", "realtorId", "Realtor portal links"],
] as const;
const revises = new Set(["loan_conversations", "contact_conversations", "realtor_portals", "contact_activity"]);
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

type MergeSnapshot = {
  source: Contact; target: Contact; affected: { label: string; ids: string[] }[];
  imports: { origin: SqlValue; recordKey: SqlValue }[];
  undo?: { digest: string; aliases: string[] } | { blocker: string };
};

function archiveLinks(snapshot: Pick<MergeSnapshot, "affected" | "imports">) {
  return [...snapshot.affected.map(({ label, ids }) => ({ label, count: ids.length })),
    { label: "Import source links", count: snapshot.imports.length }].filter(({ count }) => count);
}

function undoBaseline(db: Store, targetId: string, mergeId: string) {
  const digest = createHash("sha256");
  // An interactive undo reviews a bounded amount of linked work. Read-only indexes are excluded.
  let remaining = 750;
  function read(table: string, column: string, values: string[], clause = "") {
    if (remaining < 0 || !values.length) return [];
    const rows = db.prepare(`SELECT * FROM ${table} WHERE ${column} IN (SELECT value FROM json_each(?))
      ${clause} ORDER BY rowid LIMIT ?`).all(JSON.stringify(values), remaining + 1);
    remaining -= rows.length;
    if (table === "lead_follow_up") for (const row of rows) {
      if (row.baseNextAt === null) delete row.baseNextAt;
    }
    digest.update(JSON.stringify([table, column, rows]));
    return rows;
  }
  const ids = (rows: Record<string, SqlValue>[], key = "id") => [...new Set(rows.map((row) => String(row[key])))];
  const target = [targetId];
  read("contacts", "id", target);
  const channelBlocks = readContactChannelBlocks(db, targetId);
  if (channelBlocks) digest.update(JSON.stringify(["borrower_contact_channels", channelBlocks]));
  const hours = readBorrowerHours(db, targetId);
  if (hours) digest.update(JSON.stringify(["borrower_contact_hours", hours]));
  const direct = links.map(([table, column]) => read(table, column, target));
  const loanIds = ids([...direct[0], ...direct[1]]);
  const leadIds = ids([...direct[2], ...direct[3]]);
  const activityIds = ids(direct[4]);
  const loanThreadIds = ids(direct[5]);
  const contactThreadIds = ids(direct[6]);
  const leadThreadIds = ids(read("lead_conversations", "leadId", leadIds));

  const requestIds = ids(read("document_requests", "loanId", loanIds));
  for (const table of ["uwm_document_deliveries", "uwm_document_delivery_history", "mock_delivery_failures", "document_files"]) {
    read(table, "requestId", requestIds);
  }
  for (const table of ["activity", "loan_audit", "applications", "joint_applications", "application_versions", "application_lender_details",
    "loan_processing", "submissions", "tasks", "closing_plans", "closing_items", "closing_progress",
    "loan_appointments", "loan_reviews", "past_client_profiles", "funding_check_ins", "loan_financials", "loan_financial_entries",
    "pricing_runs", "published_quotes", "mock_uwm_rates", "mock_credit_aus_runs", "returning_client_loans"]) {
    read(table, "loanId", loanIds);
  }
  read("returning_client_loans", "fundedLoanId", loanIds);
  for (const table of ["lead_events", "lead_follow_up", "lead_import_tasks", "call_campaign_members", "campaign_follow_up_runs",
    "campaign_assignment_history", "realtor_referral_claims"]) read(table, "leadId", leadIds);
  read("contact_follow_up_completions", "activityId", activityIds);
  read("contact_callback_reschedules", "activityId", activityIds);
  read("conversation_events", "conversationId", loanThreadIds);
  read("contact_conversation_events", "conversationId", contactThreadIds);
  read("lead_conversation_events", "conversationId", leadThreadIds);
  read("inbound_replies", "conversationId", loanThreadIds);
  read("inbound_replies", "contactConversationId", contactThreadIds);
  read("inbound_replies", "leadConversationId", leadThreadIds);
  read("migration_records", "targetId", target, "AND recordKey LIKE 'Contact:%'");
  read("pilot_sample_contacts", "contactId", target);
  read("pilot_scenario", "realtorId", target);
  // Include the alias graph, not the snapshot containing this digest.
  const aliases = db.prepare(`SELECT operationId, sourceId, targetId FROM contact_merges
    WHERE canonicalId = ? AND operationId <> ? ORDER BY operationId LIMIT ?`).all(targetId, mergeId, linkLimit + 1);
  digest.update(JSON.stringify(aliases));
  return remaining < 0 || aliases.length > linkLimit ? null : digest.digest("hex");
}

function mergeHistory(db: Store, after?: ContactMergeCursor): ContactMergeHistory {
  const size = 20;
  const rows = db.prepare(`WITH history AS (
    SELECT operationId AS mergeId, actor, at, snapshot, NULL AS undoneAt, NULL AS undoneBy FROM contact_merges
    UNION ALL SELECT mergeId, actor, at, snapshot, undoneAt, undoneBy FROM contact_merge_undos
  ) SELECT mergeId, actor, at, undoneAt, undoneBy, json_extract(snapshot, '$.source.name') AS sourceName,
    json_extract(snapshot, '$.target.name') AS targetName FROM history ${after ? "WHERE (at, mergeId) < (?, ?)" : ""}
    ORDER BY at DESC, mergeId DESC LIMIT ?`).all(...(after ? [after.at, after.mergeId] : []), size + 1) as unknown as ContactMergeHistoryRow[];
  const page = rows.slice(0, size);
  const last = page.at(-1);
  return { kind: "history", rows: page, next: rows.length > size && last ? { at: last.at, mergeId: last.mergeId } : null };
}

function undoContactMerge(db: Store, request: Extract<z.infer<typeof contactMergeInput>, { type: "undo" | "previewUndo" }>,
  staff: WorkspaceStaff, now: string): ContactMergeResult {
  if (request.type === "undo") {
    const prior = db.prepare("SELECT mergeId, sourceId, fingerprint, undoneBy FROM contact_merge_undos WHERE operationId = ?").get(request.operationId);
    if (prior) return prior.mergeId === request.mergeId && prior.fingerprint === request.fingerprint && prior.undoneBy === staff.email ?
      { kind: "undone", contactId: String(prior.sourceId) } : { error: "This undo request was already used." };
  }
  const receipt = db.prepare("SELECT * FROM contact_merges WHERE operationId = ?").get(request.mergeId);
  if (!receipt) return { error: "This merge is no longer available to undo. Refresh merge history." };
  const snapshot = JSON.parse(String(receipt.snapshot)) as MergeSnapshot;
  const { source, target, undo } = snapshot;
  const current = contact(db, target.id);
  let blocker: string | null = null;
  if (!undo) blocker = "This merge predates undo. Its audit entry is available.";
  else if ("blocker" in undo) blocker = undo.blocker;
  else if (receipt.canonicalId !== target.id) blocker = "The primary contact was merged again.";
  else if (contact(db, source.id)) blocker = "The original contact ID is already in use.";
  else if (!current) blocker = "The primary contact is no longer available.";
  else {
    const identities = [source, target, current].filter((row) => row.role !== "Realtor")
      .map((row) => ({ ...row, contactId: row.id }));
    const blocked = blockedOutreachKeys(db, identities);
    if (identities.some((row) => outreachSuppressed(blocked, row))) blocker = "Undo is blocked to preserve an outreach opt-out.";
    else if (undoBaseline(db, target.id, request.mergeId) !== undo.digest) blocker = "The primary contact or its linked work changed after the merge.";
  }
  const fingerprint = !blocker && undo && "digest" in undo ? undo.digest : null;
  if (request.type === "previewUndo") {
    return { kind: "undoPreview", mergeId: request.mergeId, sourceName: source.name, targetName: target.name,
      fingerprint, blocker, links: archiveLinks(snapshot) } satisfies ContactUndoPreview;
  }
  if (blocker || !undo || "blocker" in undo) return { error: blocker ?? "Undo is unavailable for this merge." };
  if (fingerprint !== request.fingerprint) return { error: "Review a fresh undo preview before restoring these contacts." };

  insertContact(db, source);
  db.prepare("UPDATE contacts SET email = ?, phone = ? WHERE id = ?").run(target.email, target.phone, target.id);
  if (source.outreachChannelBlocks || target.outreachChannelBlocks) {
    setContactChannelBlocks(db, source.id, source.outreachChannelBlocks ?? 0);
    setContactChannelBlocks(db, target.id, target.outreachChannelBlocks ?? 0);
  }
  const hadHours = source.outreachHours || target.outreachHours;
  if (hadHours) {
    setBorrowerHours(db, source.id, source.outreachHours ?? null);
    setBorrowerHours(db, target.id, target.outreachHours ?? null);
  }
  for (const [table, column, key, label] of links) {
    const original = snapshot.affected.find((link) => link.label === label)?.ids;
    if (!original?.length) continue;
    const revision = revises.has(table) ? ", revision = revision + 1" : "";
    const currentIds = key === column ? [target.id] : original;
    db.prepare(`UPDATE ${table} SET ${column} = ?${revision}
      WHERE ${column} = ? AND ${key} IN (SELECT value FROM json_each(?))`).run(source.id, target.id, JSON.stringify(currentIds));
  }
  if (hadHours) reconcileBorrowerSequences(db, [...linkedChannelLeadIds(db, source.id), ...linkedChannelLeadIds(db, target.id)], now);
  if (snapshot.imports.length) db.prepare(`UPDATE migration_records SET targetId = ? WHERE targetId = ? AND EXISTS (
    SELECT 1 FROM json_each(?) link WHERE json_extract(link.value, '$.origin') = migration_records.origin
      AND json_extract(link.value, '$.recordKey') = migration_records.recordKey
  )`).run(source.id, target.id, JSON.stringify(snapshot.imports));
  if (undo.aliases.length) db.prepare(`UPDATE contact_merges SET canonicalId = ? WHERE canonicalId = ?
    AND operationId IN (SELECT value FROM json_each(?))`).run(source.id, target.id, JSON.stringify(undo.aliases));
  db.prepare(`INSERT INTO contact_merge_undos (mergeId, operationId, sourceId, actor, at, fingerprint, undoneBy, undoneAt, snapshot)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(request.mergeId, request.operationId, source.id, receipt.actor, receipt.at, request.fingerprint, staff.email, now, receipt.snapshot);
  db.prepare("DELETE FROM contact_merges WHERE operationId = ?").run(request.mergeId);
  accessEvent(db, staff, "Undid contact merge", source.id, now);
  return { kind: "undone", contactId: source.id };
}

function contact(db: Store, id: string) {
  const row = db.prepare("SELECT id, name, email, phone, role, addedBy FROM contacts WHERE id = ?").get(id) as Contact | undefined;
  if (!row || row.role === "Realtor") return row;
  const blocked = readContactChannelBlocks(db, id);
  const hours = readBorrowerHours(db, id);
  return { ...row, ...(blocked ? { outreachChannelBlocks: blocked } : {}), ...(hours ? { outreachHours: hours } : {}) };
}

function mergePreview(db: Store, sourceId: string, targetId: string) {
  const source = contact(db, sourceId);
  const target = contact(db, targetId);
  if (!source || !target || source.id === target.id) return null;
  const matches = contactMatchFields(source, target);
  const blockers: string[] = [];
  if (!matches.email && !matches.phone) blockers.push("The contacts no longer share an email address or phone number.");
  if (source.role !== target.role) blockers.push("These records have different contact roles.");
  if (source.email.trim() && target.email.trim() && !matches.email) blockers.push("The email addresses conflict.");
  if (referralPhone(source.phone) && referralPhone(target.phone) && !matches.phone) blockers.push("The phone numbers conflict.");
  if (source.addedBy && source.addedBy !== target.addedBy) {
    blockers.push("Keeping this primary would remove the other record’s creator access. Choose the primary that preserves that access.");
  }
  if (db.prepare("SELECT 1 FROM pilot_sample_contacts WHERE contactId IN (?, ?)").get(sourceId, targetId) ||
    db.prepare("SELECT 1 FROM pilot_scenario WHERE realtorId IN (?, ?)").get(sourceId, targetId)) {
    blockers.push("A contact belongs to a resettable pilot scenario.");
  }
  const affected = links.map(([table, column, key, label]) => ({
    label, ids: db.prepare(`SELECT ${key} AS id FROM ${table} WHERE ${column} = ? ORDER BY ${key} LIMIT ?`)
      .all(sourceId, linkLimit + 1).map((row) => String(row.id)),
  }));
  const imports = db.prepare(`SELECT origin, recordKey FROM migration_records WHERE targetId = ?
    AND recordKey LIKE 'Contact:%' ORDER BY origin, recordKey LIMIT ?`).all(sourceId, linkLimit + 1)
    .map(({ origin, recordKey }) => ({ origin, recordKey }));
  if (affected.reduce((sum, row) => sum + row.ids.length, imports.length) > linkLimit) {
    blockers.push("This contact has too many linked records for an interactive merge.");
  }
  const collision = (table: string, column: string, join = "1") => db.prepare(`SELECT 1 FROM ${table} former
    JOIN ${table} kept ON kept.${column} = ? AND ${join} WHERE former.${column} = ? LIMIT 1`).get(targetId, sourceId);
  if (collision("contact_conversations", "contactId")) blockers.push("Both contacts have standalone conversations.");
  if (collision("loan_conversations", "contactId", "kept.loanId = former.loanId AND kept.audience = former.audience") ||
    db.prepare(`SELECT 1 FROM loan_conversations thread JOIN loans loan ON loan.id = thread.loanId
      WHERE thread.contactId = ? AND CASE thread.audience WHEN 'Borrower' THEN loan.contactId ELSE loan.partnerId END = ? LIMIT 1`)
      .get(sourceId, targetId)) blockers.push("A loan has separate conversation history for these contacts.");
  if (collision("communication_drafts", "contactId", `kept.loanId = former.loanId AND kept.audience = former.audience
    AND kept.milestone = former.milestone AND kept.eventKey = former.eventKey`)) blockers.push("Both contacts have drafts for the same loan milestone.");
  if (collision("realtor_portals", "realtorId")) blockers.push("Both realtor records have portal links.");
  if (collision("referral_leads", "realtorId", "kept.requestId = former.requestId")) blockers.push("These realtor records have conflicting referral receipt IDs.");

  const identities = [source, target].map((row) => ({ ...row, contactId: row.id }));
  const blocked = source.role !== "Realtor" || target.role !== "Realtor" ? blockedOutreachKeys(db, identities) : new Set<string>();
  const optedOut = identities.some((row) => row.role !== "Realtor" && outreachSuppressed(blocked, row));
  const kept = { name: target.name, role: target.role, email: target.email.trim() ? target.email : source.email,
    phone: target.phone.trim() ? target.phone : source.phone };
  const snapshot = { source, target, affected, imports };
  const fingerprint = hash({ ...snapshot, kept, optedOut, blockers });
  const preview: ContactMergePreview = {
    kind: "preview", source, target, kept, fingerprint, matches: [matches.email ? "Email" : "", matches.phone ? "Phone" : ""].filter(Boolean),
    links: archiveLinks(snapshot),
    blockers, optedOut,
  };
  return { preview, snapshot };
}

export function contactMergeWork(db: Store, input: unknown, staff: WorkspaceStaff | null, brokerageId: string,
  now = new Date().toISOString()): ContactMergeResult {
  if (!staff || staff.brokerage.id !== brokerageId || staff.brokerage.role !== "Admin") return { error: contactMergeUnavailable };
  const parsed = contactMergeInput.safeParse(input);
  if (!parsed.success) return { error: "Choose a valid contact merge or history page." };
  const request = parsed.data;
  if (request.type === "duplicateGroups") return db.transaction(() => readDuplicateGroups(db, request.after));
  if (request.type === "duplicateMembers") return db.transaction(() => readDuplicateMembers(db, request.key, request.after));
  if (request.type === "duplicateHistory") return db.transaction(() => readDuplicateHistory(db, request.after));
  if (request.type === "keepDuplicatesSeparate" || request.type === "reopenDuplicates") {
    return db.transaction(() => writeDuplicateDecision(db, request, staff, now));
  }
  if (request.type === "history") return mergeHistory(db, request.after);
  if (request.type === "previewUndo" || request.type === "undo") {
    return db.transaction(() => undoContactMerge(db, request, staff, now));
  }
  const { sourceId, targetId } = request;
  return db.transaction(() => {
    if (request.type === "merge") {
      if (db.prepare("SELECT 1 FROM contact_merge_undos WHERE mergeId = ?").get(request.operationId)) {
        return { error: "This merge was undone. Review the current contacts to start a new merge." };
      }
      const prior = db.prepare("SELECT sourceId, targetId, canonicalId, fingerprint, actor FROM contact_merges WHERE operationId = ?").get(request.operationId);
      if (prior) return prior.sourceId === sourceId && prior.targetId === targetId && prior.fingerprint === request.fingerprint && prior.actor === staff.email ?
        { kind: "merged", contactId: String(prior.canonicalId) } : { error: "This merge request was already used." };
    }
    const plan = mergePreview(db, sourceId, targetId);
    if (!plan) return { error: "One of these contacts is no longer available. Refresh Contacts before reviewing again." };
    if (request.type === "preview") return plan.preview;
    if (plan.preview.fingerprint !== request.fingerprint) return { error: "The contact records or their links changed. Review a fresh preview before merging." };
    if (plan.preview.blockers.length) return { error: "Resolve the conflicts shown in the preview before merging these contacts." };

    const { source, kept, optedOut } = plan.preview;
    const aliases = db.prepare("SELECT operationId FROM contact_merges WHERE canonicalId = ? ORDER BY operationId LIMIT ?")
      .all(sourceId, linkLimit + 1).map(({ operationId }) => String(operationId));
    db.prepare("UPDATE contacts SET email = ?, phone = ? WHERE id = ?").run(kept.email, kept.phone, targetId);
    if (optedOut) retainContactOptOut(db, targetId, { ...source, contactId: sourceId });
    for (const [table, column] of links) {
      const revision = revises.has(table) ? ", revision = revision + 1" : "";
      db.prepare(`UPDATE ${table} SET ${column} = ?${revision} WHERE ${column} = ?`).run(targetId, sourceId);
    }
    db.prepare("UPDATE migration_records SET targetId = ? WHERE targetId = ? AND recordKey LIKE 'Contact:%'").run(targetId, sourceId);
    db.prepare("UPDATE contact_merges SET canonicalId = ? WHERE canonicalId = ?").run(targetId, sourceId);
    db.prepare("DELETE FROM contacts WHERE id = ?").run(sourceId);
    if (optedOut) closeSuppressedOutreach(db, now);
    const channelBlocks = (source.outreachChannelBlocks ?? 0) | (plan.snapshot.target.outreachChannelBlocks ?? 0);
    if (channelBlocks) setContactChannelBlocks(db, targetId, channelBlocks);
    const hours = plan.snapshot.target.outreachHours ?? source.outreachHours;
    if (hours) setBorrowerHours(db, targetId, hours);
    if (channelBlocks || hours) reconcileBorrowerSequences(db, linkedChannelLeadIds(db, targetId), now);
    const digest = !optedOut && aliases.length <= linkLimit ? undoBaseline(db, targetId, request.operationId) : null;
    const undo: MergeSnapshot["undo"] = digest ? { digest, aliases } : {
      blocker: optedOut ? "Undo is blocked to preserve an outreach opt-out." : "This merge has too much linked work for an interactive undo.",
    };
    db.prepare(`INSERT INTO contact_merges (sourceId, targetId, canonicalId, operationId, fingerprint, actor, at, snapshot)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(sourceId, targetId, targetId, request.operationId, request.fingerprint, staff.email, now,
      JSON.stringify({ ...plan.snapshot, undo }));
    accessEvent(db, staff, "Merged duplicate contact", targetId, now);
    return { kind: "merged", contactId: targetId };
  });
}
