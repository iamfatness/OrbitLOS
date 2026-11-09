import { createHash } from "node:crypto";
import type { Store } from "./store";
import type { StaffIdentity, WorkspaceStaff } from "./staff-store";
import type { Contact } from "./model";
import { contactDuplicate } from "./contact-csv";
import { assignableCampaignLead, campaignOrigin, rehearsalBuyerKey, rehearsalReserveKey } from "./call-campaign-model";
import { linkCampaignLead } from "./call-campaigns";
import { leadContactFields } from "./lead-inbox-model";
import { accessEvent } from "./workspace-access";
import { firstContactDue, leadRouting } from "./lead-inbox";
import { migrationKey, migrationTypes, type MigrationInput, type MigrationReport, type MigrationRow } from "./pipeline-migration-model";
import { optOutContact, optOutLead, outreachSuppressed, outreachSuppressionKeys } from "./outreach-preferences";
import { distributeCampaignLeads, readCampaignRouting } from "./campaign-routing";
import { recordMigrationReceipt } from "./migration-recovery";
import { campaignRehearsalBuyer, type CampaignRehearsalMember } from "./campaign-rehearsal";
import { restoreCallbackImport, reviewCallbackImport } from "./campaign-callback-migration";

const toInstant = (value: string) => new Date(value.length === 10 ? `${value}T12:00:00-05:00` : value).toISOString();
const isPlanned = (id: string) => id.startsWith("planned:");
type Result = MigrationReport["rows"][number];
type CampaignLeadMatch = Pick<Contact, "id" | "name" | "email" | "phone" | "role"> & { campaignName: string | null; heldAt: string | null };
const recordLabel = (row: MigrationRow) => "name" in row ? row.name : row.text;

function addCampaignEnrollmentDetails(db: Store, campaignId: string, rows: Result[]) {
  const enrolled = rows.filter(({ status }) => status === "Create");
  if (!enrolled.length) return;
  const actual = db.prepare(`SELECT lead.id, lead.dueAt, lead.importedContactId,
    CASE WHEN lead.officerEmail IS NOT NULL THEN coalesce(nullif(lead.officer, ''), lead.officerEmail) END AS owner
    FROM referral_leads lead JOIN call_campaign_members member ON member.leadId = lead.id
    WHERE lead.id IN (SELECT value FROM json_each(?)) AND member.campaignId = ?`)
    .all(JSON.stringify(enrolled.map(({ targetId }) => targetId)), campaignId);
  const byId = new Map(actual.map((lead) => [lead.id, lead]));
  for (const row of enrolled) {
    const lead = byId.get(row.targetId ?? null);
    if (typeof lead?.dueAt !== "string") throw new Error("The newly enrolled campaign lead is missing its first-contact deadline.");
    const owner = typeof lead.owner === "string" ? lead.owner : null;
    row.campaignEnrollment = { owner, firstContactDueAt: lead.dueAt };
    row.detail = `${owner ? `Owner ${owner}` : "Shared inbox"}${lead.importedContactId ? " · Existing contact matched" : ""}`;
  }
}

function restoreFollowUpHistory(db: Store, id: string, history: NonNullable<Extract<MigrationRow, { type: "Task" }>["followUpHistory"]>) {
  if (history.postFundingCheckIn) {
    // A CRM snapshot has no loan file to link to. Retain the check-in as contact history.
    db.prepare("INSERT INTO funding_check_ins (activityId, loanId, fundingRevision) VALUES (?, NULL, 0)").run(id);
  }
  if (history.completions.length) {
    const insert = db.prepare(`INSERT INTO contact_follow_up_completions (activityId, revision, completedAt, actor, actorEmail, outcome, note)
      VALUES (?, ?, ?, ?, ?, ?, ?)`);
    for (const event of history.completions) {
      insert.run(id, event.revision, toInstant(event.completedAt), event.actor, event.actorEmail, event.outcome, event.note);
    }
  }
  if (history.reschedules.length) {
    const insert = db.prepare(`INSERT INTO contact_callback_reschedules (activityId, revision, changedAt, actor, actorEmail, previousDueAt, dueAt, reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const event of history.reschedules) {
      insert.run(id, event.revision, toInstant(event.changedAt), event.actor, event.actorEmail, toInstant(event.previousDueAt), toInstant(event.dueAt), event.reason);
    }
  }
}

export function migratePipeline(db: Store, input: MigrationInput, staff: WorkspaceStaff | null, members: CampaignRehearsalMember[], now: string) {
  const { campaignId, batch, correctionKeys } = input;
  if (batch && (campaignId || batch.origin !== input.origin)) return { error: "Use the source key embedded in the Orbit batch file in CRM migration." };
  if (!batch && input.rows.some((row) => row.type === "Task" && row.followUpHistory)) {
    return { error: "Use the original Orbit batch file to restore follow-up history." };
  }
  if (!batch && input.rows.some((row) => row.type === "Callback" || (row.type === "Note" && row.leadEventActor))) {
    return { error: "Use the original Orbit batch file to restore callback promises and call evidence." };
  }
  if (campaignId && Object.keys(input.ownerMappings ?? {}).length) return { error: "Resolve missing CRM owners in Migration." };
  if (campaignId && correctionKeys) return { error: "Reimport corrected CRM rows in Migration." };
  if (campaignId && (input.origin !== campaignOrigin(campaignId) || !db.prepare("SELECT 1 FROM call_campaigns WHERE id = ?").get(campaignId) ||
    input.rows.some((row) => row.type !== "Lead" || !!row.parentId || !!row.realtorId || !!row.heldAt ||
      row.optedOut === "Yes" || !row.phone || !leadContactFields.phone.safeParse(row.phone).success))) {
    return { error: "Choose an available call campaign and import only lead rows with a phone number." };
  }
  const ordered = [...input.rows].sort((a, b) => migrationTypes.indexOf(a.type) - migrationTypes.indexOf(b.type));
  const routing = campaignId ? readCampaignRouting(db, campaignId) : undefined;
  const keys = ordered.map(migrationKey);
  const keySet = new Set(keys);
  if (keySet.size !== keys.length) return { error: "Each record type and external ID must appear only once in a file." };
  const targets = new Map(db.prepare("SELECT recordKey, targetId FROM migration_records WHERE origin = ?").all(input.origin)
    .map((row) => [String(row.recordKey), String(row.targetId)]));
  const undone = new Map(db.prepare(`SELECT recordKey, undoId FROM migration_undone_records WHERE rowid IN (
    SELECT max(rowid) FROM migration_undone_records WHERE origin = ?
      AND recordKey IN (SELECT value FROM json_each(?)) GROUP BY recordKey
  )`).all(input.origin, JSON.stringify(keys)).map(({ recordKey, undoId }) => [String(recordKey), String(undoId)]));
  const corrections = correctionKeys ? new Set(correctionKeys) : undefined;
  if (corrections && (corrections.size !== correctionKeys?.length ||
    [...corrections].some((key) => !keySet.has(key) || !undone.has(key)))) {
    return { error: "Select only rows from this CSV that were undone under this source key." };
  }
  const importBatch = corrections ? undefined : batch;
  const contentHash = importBatch ? createHash("sha256").update(JSON.stringify({ batch: importBatch, rows: ordered })).digest("hex") : null;
  if (importBatch) {
    const latest = db.prepare("SELECT part, partCount FROM migration_batches WHERE origin = ? AND snapshot = ? ORDER BY part DESC LIMIT 1")
      .get(input.origin, importBatch.snapshot);
    if (latest && latest.partCount !== importBatch.partCount) return { error: "The batch count differs from the earlier files. Use the original export set." };
    const nextPart = Number(latest?.part ?? 0) + 1;
    if (importBatch.part > nextPart) return { error: `Import batch ${nextPart} of ${importBatch.partCount} before batch ${importBatch.part}.` };
    if (importBatch.part < nextPart) {
      const previous = db.prepare("SELECT contentHash, excluded FROM migration_batches WHERE origin = ? AND snapshot = ? AND part = ?")
        .get(input.origin, importBatch.snapshot, importBatch.part);
      if (!previous || previous.contentHash !== contentHash) return { error: "This batch was already imported with different records. Load the original CSV or choose correction mode to review undone rows." };
      const excluded = JSON.parse(String(previous.excluded)) as Record<string, "Skipped" | "Suppressed" | "Undone">;
      const rows: Result[] = ordered.map((row) => {
        const key = migrationKey(row);
        const targetId = targets.get(key);
        const priorStatus = excluded[key];
        const status = priorStatus === "Skipped" || priorStatus === "Suppressed" ? priorStatus :
          !targetId && undone.has(key) ? "Undone" : "Previously imported";
        const detail = status === "Undone" ? "Removed by a confirmed import undo." : "Already reconciled in this batch.";
        return { key, label: recordLabel(row), status, detail, targetId };
      });
      return { migration: { rows, fingerprint: String(previous.contentHash),
        batch: { completed: true, nextPart: nextPart <= importBatch.partCount ? nextPart : null } },
        message: `Batch ${importBatch.part} was already reconciled.` };
    }
  }
  const contacts = db.prepare("SELECT id, name, email, phone, role FROM contacts ORDER BY id").all() as unknown as Contact[];
  const openLeads = new Set<string>();
  const suppressedLeadIds = new Set<string>();
  const suppression = outreachSuppressionKeys(db);
  for (const lead of db.prepare(`SELECT id, email, phone, importedContactId AS contactId
    FROM referral_leads WHERE resolvedAt IS NULL OR loanId IS NOT NULL`).all()) {
    openLeads.add(String(lead.id));
    if (outreachSuppressed(suppression, { ...lead, leadId: lead.id })) suppressedLeadIds.add(String(lead.id));
  }
  const campaignContacts = campaignId ? db.prepare(`SELECT lead.id, lead.name, lead.email, lead.phone, lead.heldAt, 'Borrower' AS role,
    campaign.name AS campaignName FROM referral_leads lead LEFT JOIN call_campaign_members member ON member.leadId = lead.id
    LEFT JOIN call_campaigns campaign ON campaign.id = member.campaignId WHERE lead.resolvedAt IS NULL ORDER BY lead.id`).all() as unknown as CampaignLeadMatch[] : [];
  const matchedContacts = new Map<string, string>();
  const owners = new Map(members.map(({ email, name }) => [email, { email, name }]));
  const buyerEmail = campaignId && (keySet.has(rehearsalBuyerKey) || keySet.has(rehearsalReserveKey)) ? campaignRehearsalBuyer(db, campaignId) : undefined;
  const buyerStillEligible = !buyerEmail || members.some(({ email, role }) => email === buyerEmail && role === "LO");
  const rehearsalOwners = new Map<string, string>();
  if (buyerEmail) {
    rehearsalOwners.set(rehearsalBuyerKey, buyerEmail);
    rehearsalOwners.set(rehearsalReserveKey, routing?.officers.find(({ email }) => email !== buyerEmail && owners.has(email))?.email ?? "");
  }
  const savedOwners = new Map(batch ? db.prepare("SELECT sourceEmail, target FROM migration_owner_mappings WHERE origin = ? AND snapshot = ?")
    .all(input.origin, batch.snapshot).map(({ sourceEmail, target }) => [String(sourceEmail), String(target)]) : []);
  const missing = new Map<string, NonNullable<MigrationReport["ownership"]>["missing"][number]>();
  const resolvedOwners = new Map<string, StaffIdentity>();
  function resolveOwner(key: string, sourceEmail = "") {
    const email = sourceEmail.toLowerCase();
    const unassigned = { email: "", name: "" };
    let owner = email ? owners.get(email) : unassigned;
    if (email && !owner && !campaignId) {
      const target = input.ownerMappings?.[email] ?? savedOwners.get(email);
      owner = target === "unassigned" ? unassigned : owners.get(target ?? "");
      const count = (missing.get(email)?.count ?? 0) + 1;
      missing.set(email, { email, count, target: owner ? target : undefined });
    }
    if (owner) resolvedOwners.set(key, owner);
    return owner;
  }
  const plan = new Map<string, Result>();
  const restoredCallAuthors = new Map<string, string>();
  const sourceRows = new Map(ordered.map((row) => [migrationKey(row), row]));
  const sourceTarget = (key: string) => plan.get(key)?.targetId ?? targets.get(key);
  const contactTarget = (id: string) => plan.get(`Contact:${id}`)?.targetId ?? targets.get(`Contact:${id}`);

  for (const row of ordered) {
    const key = migrationKey(row);
    const label = recordLabel(row);
    const result: Result = { key, label, status: "Create", detail: "", targetId: `planned:${key}` };
    plan.set(key, result);
    const known = targets.get(key);
    const decision = input.decisions[key];
    const review = (detail: string) => Object.assign(result, { status: "Review", detail, targetId: undefined });
    if (known) {
      Object.assign(result, { status: "Previously imported", detail: "Source ID already reconciled.", targetId: known });
      if (batch && !corrections && row.type === "Note" && row.leadEventKind === "Call" && row.leadEventActor && row.leadEventActor !== "CRM import" &&
        db.prepare(`SELECT 1 FROM lead_events WHERE id = ? AND leadId = ? AND at = ? AND kind = 'Call'
          AND outcome IS ? AND text = ? AND actor = 'CRM import'`)
          .get(known, sourceTarget(`Lead:${row.parentId}`) ?? null, toInstant(row.createdAt), row.leadOutcome ?? null, row.text)) {
        restoredCallAuthors.set(key, row.leadEventActor);
        result.detail = "Source ID reconciled. The original call author will be restored.";
      }
      continue;
    }
    if (undone.has(key) && !corrections?.has(key)) {
      Object.assign(result, { status: "Undone", detail: "Removed by a confirmed import undo.", targetId: undefined });
      continue;
    }
    if (corrections) {
      if (!corrections.has(key)) {
        Object.assign(result, { status: "Skipped", detail: "Correction mode only imports selected undone rows.", targetId: undefined });
        continue;
      }
      result.correction = true;
    }
    if (row.type === "Lead") {
      const contact = row.parentId && contacts.find((item) => item.id === contactTarget(row.parentId));
      if (row.optedOut !== "Yes" && (outreachSuppressed(suppression, row) || (contact && outreachSuppressed(suppression, { ...contact, contactId: contact.id })))) {
        Object.assign(result, { status: "Suppressed", detail: "Borrower opted out of brokerage outreach.", targetId: undefined });
        continue;
      }
    }
    if (decision === "skip") {
      Object.assign(result, { status: "Skipped", detail: "Excluded by reviewer.", targetId: undefined });
      continue;
    }
    if (row.type === "Contact") {
      const candidates = contacts.filter((contact) => contactDuplicate(row, [contact]));
      if (candidates.length) {
        const match = candidates.find((contact) => contact.id === decision);
        if (match) Object.assign(result, { status: "Reuse contact", detail: match.name, targetId: match.id });
        else {
          review("Choose a contact to reuse or skip this row.");
          result.matches = candidates.map((item) => ({ id: item.id, label: `${item.name}${item.email ? ` · ${item.email}` : ""}` }));
        }
      } else if (decision) review("The selected contact no longer matches.");
      else contacts.push({ ...row, id: result.targetId! });
    } else if (row.type === "Lead") {
      const owner = key === rehearsalBuyerKey && !buyerStillEligible ? undefined : resolveOwner(key, rehearsalOwners.get(key) ?? row.ownerEmail);
      const contactId = row.parentId && contactTarget(row.parentId);
      const candidate = { ...row, role: "Borrower" as const };
      const matches = contactId ? [] : contacts.filter((contact) => contactDuplicate(candidate, [contact]));
      const match = matches.find((item) => item.id === decision);
      const duplicates = campaignContacts.filter((lead) => contactDuplicate(candidate, [lead]));
      if (!owner) review(rehearsalOwners.has(key) ? "The selected buyer owner is unavailable. Choose an active officer in the Demo Guide." : campaignId
        ? "Use the email of an active LO or admin in this brokerage, or leave it blank for the shared inbox."
        : "Choose a destination in Owner mapping.");
      else if (row.parentId && (!contactId || !contacts.some((item) => item.id === contactId && item.role !== "Realtor"))) {
        review("Map this lead to an available borrower contact from the same source.");
      } else if (row.realtorId && !contacts.some((item) => item.id === contactTarget(row.realtorId!) && item.role === "Realtor")) {
        review("Map this lead to an available realtor contact from the same source.");
      } else if (duplicates.length) {
        const existing = duplicates.filter(({ id }) => !isPlanned(id));
        review(existing.length ? "An open lead shares this phone or email. Use the existing record or skip this row." :
          "An earlier row in this CSV shares this phone or email. Keep one row and preview again.");
        if (existing.length) result.campaignDuplicates = existing.slice(0, 5).map(({ id, name, campaignName, phone, heldAt }) => ({
          id, name, campaignName, canEnroll: !campaignName && assignableCampaignLead({ phone, heldAt, outreachSuppressed: suppressedLeadIds.has(id) }),
        }));
      } else if (campaignId && matches.length > 1) {
        review("More than one borrower contact matches. Skip this row and reconcile the contacts in Migration.");
      } else if (!campaignId && matches.length && !match) {
        review("Choose the borrower contact for this lead or skip the row.");
        result.matches = matches.map((item) => ({ id: item.id, label: item.name }));
      } else if (row.dueAt && toInstant(row.dueAt) < toInstant(row.createdAt)) review("First contact cannot be due before lead creation.");
      else {
        openLeads.add(result.targetId!);
        result.detail = owner.email ? `Owner ${owner.name}` : routing?.enabled && !rehearsalOwners.has(key) ? "Round robin when capacity is available" : "Shared inbox";
        if (match) {
          matchedContacts.set(key, match.id);
          result.detail += ` · Linked to ${match.name}`;
        }
        if (row.optedOut === "Yes") result.detail += " · Outreach opted out";
        if (campaignId) {
          campaignContacts.push({ ...candidate, id: result.targetId!, campaignName: null, heldAt: null });
          if (matches[0]) {
            matchedContacts.set(key, matches[0].id);
            result.detail += " · Existing contact matched";
          }
        }
      }
    } else if (row.type === "Task" && row.parentType === "Contact") {
      const owner = resolveOwner(key, row.ownerEmail);
      if (!contacts.some((contact) => contact.id === contactTarget(row.parentId))) review("Reference an available contact from the same source.");
      else if (!owner) review("Choose a destination in Owner mapping.");
      else {
        result.detail = owner.email ? `Follow-up owner ${owner.name}` : "Unassigned · Admin can assign";
        if (row.followUpHistory) {
          const count = row.followUpHistory.completions.length + row.followUpHistory.reschedules.length;
          if (count) result.detail += ` · ${count} follow-up history ${count === 1 ? "event" : "events"}`;
        }
      }
    } else {
      const parent = `Lead:${row.parentId}`;
      const leadId = plan.get(parent)?.targetId ?? targets.get(parent);
      if (plan.get(parent)?.status === "Suppressed" || (row.type === "Task" && row.taskPurpose !== "Loan service" && !row.completedAt &&
        leadId && suppressedLeadIds.has(leadId))) {
        Object.assign(result, { status: "Suppressed", detail: "The linked lead is suppressed.", targetId: undefined });
        continue;
      }
      if (!leadId || !openLeads.has(leadId)) review("Reference an open or converted lead from the same source.");
      else if (row.type === "Callback") {
        const source = sourceRows.get(parent);
        const optedOut = suppressedLeadIds.has(leadId) || (source?.type === "Lead" && source.optedOut === "Yes");
        const problem = reviewCallbackImport(db, row, leadId, { target: sourceTarget, row: (key) => sourceRows.get(key) }, optedOut);
        if (problem) review(problem);
        else result.detail = `${row.callbackHistory.campaignName} · ${row.callbackHistory.promises.length} tracked callback promises`;
      }
    }
  }
  const rows = keys.map((key) => plan.get(key)!);
  const ownership = missing.size ? { missing: [...missing.values()], eligible: [...owners.values()] } : undefined;
  const fingerprint = createHash("sha256").update(JSON.stringify({ origin: input.origin, batch, input: ordered, rows, matchedContacts: [...matchedContacts],
    ...(corrections ? { corrections: [...corrections].sort().map((key) => [key, undone.get(key)]) } : {}),
    resolvedOwners: [...resolvedOwners], ...(restoredCallAuthors.size ? { restoredCallAuthors: [...restoredCallAuthors] } : {}),
    ...(campaignId ? { campaignId, routingRevision: routing?.revision } : {}) })).digest("hex");
  if (!input.preview) return { migration: { rows, fingerprint, ownership }, message: "Migration preview is ready." };
  if (input.preview !== fingerprint) return { error: "The preview changed. Review the latest results before importing." };
  if (rows.some((row) => row.status === "Review")) return { error: "Resolve or skip every flagged record before importing." };
  if (corrections && !rows.some((row) => row.status === "Create" || row.status === "Reuse contact")) {
    return { error: "Select at least one undone row that can be reimported." };
  }

  const campaignLeads: string[] = [];
  for (const row of ordered) {
    const key = migrationKey(row);
    const result = plan.get(key)!;
    const author = restoredCallAuthors.get(key);
    if (author) db.prepare("UPDATE lead_events SET actor = ? WHERE id = ?").run(author, result.targetId!);
    if (result.status !== "Create" && result.status !== "Reuse contact") continue;
    const id = row.type === "Callback" ? targets.get(`Lead:${row.parentId}`)! : result.status === "Create" ? crypto.randomUUID() :
      isPlanned(result.targetId!) ? targets.get(result.targetId!.slice("planned:".length))! : result.targetId!;
    if (result.status === "Create") {
      if (row.type === "Contact") {
        db.prepare("INSERT INTO contacts (id, name, email, phone, role, addedBy) VALUES (?, ?, ?, ?, ?, ?)")
          .run(id, row.name, row.email, row.phone, row.role, staff?.email ?? null);
      } else if (row.type === "Lead") {
        const owner = resolvedOwners.get(key)!;
        const created = toInstant(row.createdAt);
        const matched = matchedContacts.get(key);
        db.prepare(`INSERT INTO referral_leads (id, requestId, name, email, phone, purpose, officer, officerEmail, createdAt,
          dueAt, zip, importSource, importedContactId, realtorId, heldAt, holdReason, revisitDate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(id, id, row.name, row.email, row.phone, row.purpose, owner.name, owner.email || null,
            created, row.dueAt ? toInstant(row.dueAt) : firstContactDue(created, leadRouting(db)), row.zip, row.source,
            matched && isPlanned(matched) ? targets.get(matched.slice("planned:".length))! : matched ?? targets.get(`Contact:${row.parentId}`) ?? null,
            targets.get(`Contact:${row.realtorId}`) ?? null, row.heldAt ? toInstant(row.heldAt) : null, row.holdReason ?? null, row.revisitDate ?? null);
        if (row.firstContactAt) db.prepare("INSERT INTO lead_follow_up (leadId, firstContactAt) VALUES (?, ?)").run(id, toInstant(row.firstContactAt));
        if (row.optedOut === "Yes") optOutLead(db, id, now);
        if (campaignId) {
          const linked = linkCampaignLead(db, campaignId, id, now);
          if ("error" in linked) throw new Error(linked.error);
          if (!rehearsalOwners.has(key)) campaignLeads.push(id);
        }
      } else if (row.type === "Task" && row.parentType === "Contact") {
        const owner = resolvedOwners.get(key)!;
        const history = row.followUpHistory;
        db.prepare(`INSERT INTO contact_activity (id, contactId, officer, officerEmail, kind, outcome, text, createdAt, dueAt,
          completedAt, purpose, followUpOwner, followUpOwnerEmail, revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(id, targets.get(`Contact:${row.parentId}`)!, history?.loggedBy ?? "CRM import", null,
            row.activityKind ?? "Call", row.activityOutcome ?? null, row.text, toInstant(row.createdAt ?? row.dueAt),
            toInstant(row.dueAt), row.completedAt ? toInstant(row.completedAt) : null, row.taskPurpose ?? "Loan service", owner.name || null,
            owner.email || null, history?.revision ?? 0);
        if (history) restoreFollowUpHistory(db, id, history);
      } else if (row.type === "Callback") {
        const source = sourceRows.get(`Lead:${row.parentId}`);
        restoreCallbackImport(db, input.origin, row, id, targets, now,
          suppressedLeadIds.has(id) || (source?.type === "Lead" && source.optedOut === "Yes"));
      } else {
        const leadId = targets.get(`Lead:${row.parentId}`)!;
        const loanId = db.prepare("SELECT loanId FROM referral_leads WHERE id = ?").get(leadId)?.loanId ?? null;
        if (row.type === "Note") {
          if (loanId) db.prepare("INSERT INTO activity (id, loanId, text, createdAt, kind, outcome) VALUES (?, ?, ?, ?, ?, ?)")
            .run(id, loanId, row.text, toInstant(row.createdAt), row.leadEventKind ?? "Note", row.leadOutcome ?? null);
          else db.prepare("INSERT INTO lead_events (id, leadId, at, actor, kind, outcome, text) VALUES (?, ?, ?, ?, ?, ?, ?)")
            .run(id, leadId, toInstant(row.createdAt), row.leadEventActor ?? "CRM import", row.leadEventKind ?? "Note", row.leadOutcome ?? null, row.text);
        } else {
          const task = [id, loanId ?? leadId, row.text, toInstant(row.dueAt), row.completedAt ? toInstant(row.completedAt) : null, row.taskPurpose ?? "Loan service"] as const;
          if (loanId) db.prepare("INSERT INTO tasks (id, loanId, title, dueAt, completedAt, purpose) VALUES (?, ?, ?, ?, ?, ?)").run(...task);
          else db.prepare("INSERT INTO lead_import_tasks (id, leadId, title, dueAt, completedAt, purpose) VALUES (?, ?, ?, ?, ?, ?)").run(...task);
        }
      }
    }
    if (row.type === "Contact" && row.optedOut === "Yes") optOutContact(db, id, now);
    db.prepare("INSERT INTO migration_records (origin, recordKey, targetId) VALUES (?, ?, ?)").run(input.origin, key, id);
    targets.set(key, id);
    result.targetId = id;
  }
  const count = (status: Result["status"]) => rows.filter((row) => row.status === status).length;
  if (importBatch) {
    const saveOwner = db.prepare(`INSERT INTO migration_owner_mappings (origin, snapshot, sourceEmail, target) VALUES (?, ?, ?, ?)
      ON CONFLICT (origin, snapshot, sourceEmail) DO UPDATE SET target = excluded.target`);
    for (const { email, target } of missing.values()) {
      if (target && target !== savedOwners.get(email)) saveOwner.run(input.origin, importBatch.snapshot, email, target);
    }
    const excluded = Object.fromEntries(rows.filter((row) => row.status === "Skipped" || row.status === "Suppressed" || row.status === "Undone")
      .map((row) => [row.key, row.status]));
    db.prepare("INSERT INTO migration_batches (origin, snapshot, part, partCount, contentHash, excluded) VALUES (?, ?, ?, ?, ?, ?)")
      .run(input.origin, importBatch.snapshot, importBatch.part, importBatch.partCount, contentHash, JSON.stringify(excluded));
  }
  const routed = campaignId ? distributeCampaignLeads(db, staff, campaignId, staff ? members : undefined, now, campaignLeads).assigned : 0;
  if (campaignId) addCampaignEnrollmentDetails(db, campaignId, rows);
  if (!campaignId && staff) recordMigrationReceipt(db, { origin: input.origin, batch: importBatch }, ordered, rows, staff, now);
  if (corrections) {
    const total = count("Create") + count("Reuse contact");
    accessEvent(db, staff, "Reimported corrected CRM rows", input.origin, now);
    return { migration: { rows, fingerprint }, message: `Reimported ${total} corrected CRM ${total === 1 ? "record" : "records"}.` };
  }
  if (count("Create") || count("Reuse contact")) accessEvent(db, staff, "Imported fictional CRM records", input.origin, now);
  if (restoredCallAuthors.size) accessEvent(db, staff, "Restored original CRM call authors", input.origin, now);
  return { migration: { rows, fingerprint, ...(importBatch ? { batch: { completed: true, nextPart: importBatch.part < importBatch.partCount ? importBatch.part + 1 : null } } : {}) },
    message: `${count("Create")} created · ${count("Reuse contact")} reused · ${count("Previously imported")} previously imported · ${count("Skipped")} skipped · ${count("Suppressed")} suppressed${count("Undone") ? ` · ${count("Undone")} previously undone` : ""}${routed ? ` · ${routed} routed` : ""}` };
}
