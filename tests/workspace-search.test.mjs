import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context); }
  catch (error) {
    if (error.code !== "ERR_MODULE_NOT_FOUND" || !specifier.startsWith("./")) throw error;
    return next(`${specifier}.ts`, context);
  }
} });

const { initializeStore, insertContact, insertLoan, insertSubmission } = await import("../src/lib/store.ts");
const { readWorkspaceSearch } = await import("../src/lib/workspace-search.ts");
const { readEditableLoan } = await import("../src/lib/editable-loan.ts");
const { applyLeadWork } = await import("../src/lib/lead-work-model.ts");
const { changeConversation, readConversations } = await import("../src/lib/conversations.ts");
const { executeCommand } = await import("../src/lib/commands.ts");
const at = "2026-11-08T14:00:00.000Z";

function fixture(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const db = { exec: (sql) => sqlite.exec(sql), prepare: (sql) => sqlite.prepare(sql), transaction(fn) {
    sqlite.exec("BEGIN IMMEDIATE");
    try { const result = fn(); sqlite.exec("COMMIT"); return result; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } };
  initializeStore(db, false);
  const id = crypto.randomUUID();
  const person = (role, name) => ({ email: `${name}@example.test`, name, brokerage: { id, name: "Fictional brokerage", role } });
  const admin = person("Admin", "admin");
  const officer = person("LO", "officer");
  const other = person("LO", "other");
  const processor = person("Processor", "processor");
  const contact = (id, name, role = "Borrower", phone = "") => insertContact(db, { id, name, email: `${id}@example.test`, role, phone });
  const loan = (id, contactId, owner, address, partnerId = null) => insertLoan(db, { id, contactId, partnerId, officer: owner.name,
    officerEmail: owner.email, stage: "Processing", purpose: "Purchase", stageSince: at, amount: 350000, address });
  const search = (query, filter = "All records", staff = admin, after, brokerageId = id) => readWorkspaceSearch(db,
    { type: "search", query, filter, after }, staff, brokerageId);
  const open = (kind, recordId, staff = admin) => readWorkspaceSearch(db, { type: "open", kind, id: recordId }, staff, id);
  return { db, id, admin, officer, other, processor, contact, loan, search, open };
}

test("workspace search scopes mixed matches before paging and rechecks record access", (t) => {
  const { db, id, admin, officer, other, processor, contact, loan, search, open } = fixture(t);
  contact("buyer-one", "José Example", "Borrower", "+1 (248) 555-0101");
  contact("buyer-two", "José Example");
  contact("partner", "Taylor Example", "Realtor");
  contact("callback-contact", "Avery Assigned");
  contact("private-contact", "Private Exemplar");
  loan("visible-loan", "buyer-one", officer, "90 Fictional Way", "partner");
  loan("other-loan", "buyer-two", other, "99 Fictional Way");
  loan("other-loan-same-buyer", "buyer-one", other, "100 Fictional Way");
  db.prepare("INSERT INTO loan_processing VALUES ('visible-loan', ?, ?, 'Assigned', '', ?, 1)").run(processor.email, processor.name, at);
  const visibleThread = crypto.randomUUID();
  const hiddenThread = crypto.randomUUID();
  db.prepare(`INSERT INTO loan_conversations (id, loanId, contactId, audience, ownerRole, status, updatedAt)
    VALUES (?, 'visible-loan', 'partner', 'Realtor', 'Processor', 'Needs reply', ?),
    (?, 'other-loan', 'buyer-two', 'Borrower', 'Loan officer', 'Needs reply', ?)`).run(visibleThread, at, hiddenThread, at);
  db.prepare("INSERT INTO conversation_events VALUES (?, ?, 'Note', NULL, 'Internal', 'Unsearchable private note', 'Example', ?, ?, '{}')")
    .run(crypto.randomUUID(), visibleThread, processor.email, at);
  db.exec(`INSERT INTO tasks (id, loanId, title, dueAt) VALUES ('visible-task', 'visible-loan', 'Example payoff follow-up', '${at}'),
    ('private-task', 'other-loan', 'Example payoff follow-up', '${at}');
    INSERT INTO document_requests (id, loanId, kind, instructions, requestedAt) VALUES
    ('visible-document', 'visible-loan', 'Pay stub', 'Unsearchable borrower instructions', '${at}'),
    ('private-document', 'other-loan', 'Pay stub', '', '${at}');`);
  db.prepare(`INSERT INTO contact_activity (id, contactId, officer, kind, outcome, text, createdAt, dueAt, followUpOwnerEmail)
    VALUES ('assigned-work', 'callback-contact', 'Admin', 'Call', 'Requested callback', 'Fictional contact', ?, ?, ?)`).run(at, at, officer.email);
  const addLead = db.prepare(`INSERT INTO referral_leads (id, requestId, name, email, phone, purpose, officer, officerEmail, createdAt, dueAt, realtorId, resolvedAt)
    VALUES (?, ?, 'Example incoming lead', '', '', 'Purchase', '', ?, ?, ?, ?, ?)`);
  addLead.run("shared-lead", "shared-lead", null, at, at, null, null);
  addLead.run("other-lead", "other-lead", other.email, at, at, null, null);
  addLead.run("unowned-realtor-lead", "unowned-realtor-lead", null, at, at, "partner", null);
  addLead.run("archived-lead", "archived-lead", officer.email, at, at, null, at);
  for (const [file, lender] of [["uwm-file", "UWM"], ["second-file", "Manual lender"]]) {
    insertSubmission(db, { id: file, loanId: "visible-loan", lender, externalId: "FICTIONAL-26008", status: "In review", conditions: [], syncedAt: at });
  }

  assert.deepEqual(search("Jose Example", "Loans", officer).rows.map(({ id }) => id), ["visible-loan"]);
  assert.equal(search("Jose Example", "Loans", admin).rows.length, 3);
  assert.equal(search("Jose 90 Fic", "Loans", officer).rows[0].id, "visible-loan");
  assert.deepEqual(search("fictional-26008", "Loans", processor).rows.map(({ id }) => id), ["visible-loan"]);
  assert.deepEqual(search("2485550101", "Contacts", officer).rows.map(({ id }) => id), ["buyer-one"]);
  assert.deepEqual(search("(248) 555-0101", "Contacts", officer).rows.map(({ id }) => id), ["buyer-one"]);
  assert.deepEqual(search("Example incoming", "Leads", officer).rows.map(({ id }) => id), ["shared-lead"]);
  assert.equal(search("Example incoming", "Leads", processor).rows.length, 0);
  assert.deepEqual(search("Taylor", "Realtor partners", processor).rows.map(({ id }) => id), ["partner"]);
  assert.equal(search("Taylor", "Contacts", processor).rows.length, 0);
  assert.equal(search("payoff", "Tasks", processor).rows.length, 0);
  assert.deepEqual(search("payoff", "Tasks", officer).rows.map(({ id }) => id), ["visible-task"]);
  assert.deepEqual(search("pay stub", "Documents", processor).rows.map(({ id }) => id), ["visible-document"]);
  assert.deepEqual(search("needs rep", "Conversations", processor).rows.map(({ id }) => id), [visibleThread]);
  assert.equal(search("Unsearchable", "All records", admin).rows.length, 0);
  assert.equal(search('"NONSENSE" OR NEAR(*)').rows.length, 0);
  assert.ok(search("?*").error);
  assert.ok(search("Example", "All records", officer, undefined, crypto.randomUUID()).error);
  assert.ok(search("Example", "All records", null).error);

  const callback = open("contact", "callback-contact", officer);
  assert.equal(callback.assignedOnly, true);
  assert.deepEqual(callback.loans, []);
  assert.ok(open("contact", "private-contact", officer).error);
  assert.ok(open("lead", "other-lead", officer).error);
  assert.deepEqual(open("contact", "buyer-one", officer).loans.map(({ id }) => id), ["visible-loan"]);
  assert.equal(readConversations(db, { type: "thread", id: visibleThread }, processor, id).kind, "thread");
  db.exec("UPDATE loans SET officerEmail = 'other@example.test' WHERE id = 'visible-loan'");
  assert.ok(readEditableLoan(db, "visible-loan", officer, id).error);
  assert.ok(open("contact", "buyer-one", officer).error);
  assert.equal(search("Jose", "Loans", officer).rows.length, 0);
  db.exec("UPDATE loans SET partnerId = NULL WHERE id = 'visible-loan'");
  assert.equal(search("needs rep", "Conversations", processor).rows.length, 0);
  assert.ok(readConversations(db, { type: "thread", id: visibleThread }, processor, id).error);
  db.exec("UPDATE loans SET partnerId = 'partner' WHERE id = 'visible-loan'");
  assert.equal(search("needs rep", "Conversations", processor).rows[0].id, visibleThread);
  db.exec("UPDATE loan_processing SET processorEmail = NULL WHERE loanId = 'visible-loan'");
  assert.equal(search("pay stub", "Documents", processor).rows.length, 0);
  assert.ok(readConversations(db, { type: "thread", id: visibleThread }, processor, id).error);
});

test("processor search keeps complete pages when the assignment or related-record budget is exceeded", (t) => {
  const { db, officer, processor, other, contact, loan, search } = fixture(t);
  contact("borrower", "Fictional processor borrower");
  loan("assigned-loan", "borrower", officer, "Assigned property");
  loan("unassigned-loan", "borrower", officer, "Unassigned property");
  const assign = db.prepare("INSERT INTO loan_processing VALUES (?, ?, ?, 'Assigned', '', ?, 1)");
  const document = db.prepare("INSERT INTO document_requests (id, loanId, kind, instructions, requestedAt) VALUES (?, ?, ?, '', ?)");
  const docs = (after) => search("Pay stub", "Documents", processor, after);
  for (let i = 0; i < 25; i++) {
    const number = String(i).padStart(3, "0");
    document.run(`assigned-${number}`, "assigned-loan", `Pay stub ${number}`, at);
  }
  document.run("unassigned", "unassigned-loan", "Pay stub", at);
  assert.deepEqual(docs().rows, []);
  assign.run("assigned-loan", processor.email, processor.name, at);
  db.exec("UPDATE loans SET stage = 'Funded' WHERE id = 'assigned-loan'");
  const first = docs();
  const second = docs(first.next);
  assert.equal(first.rows.length, 20);
  assert.deepEqual(second.rows.map(({ id }) => id), ["assigned-020", "assigned-021", "assigned-022", "assigned-023", "assigned-024"]);
  assert.equal(second.next, null);
  for (let i = 0; i < 32; i++) {
    const id = `extra-loan-${i}`;
    loan(id, "borrower", officer, "Other property");
    assign.run(id, processor.email, processor.name, at);
  }
  assert.deepEqual(docs(), first);
  assert.deepEqual(docs(first.next), second);
  db.exec("DELETE FROM loan_processing WHERE loanId LIKE 'extra-loan-%'");
  for (let i = 0; i < 257; i++) document.run(`extra-document-${i}`, "assigned-loan", `Bank statement ${i}`, at);
  assert.deepEqual(docs().rows, first.rows);
  assert.deepEqual(docs(first.next).rows, second.rows);
  db.prepare("UPDATE loan_processing SET processorEmail = ? WHERE loanId = 'assigned-loan'").run(other.email);
  assert.deepEqual(docs().rows, []);
  assert.deepEqual(search("Assigned property", "Loans", processor).rows, []);
});

test("lender reference matches do not consume page slots or hide later search kinds", (t) => {
  const { contact, loan, officer, search, db } = fixture(t);
  for (let i = 0; i < 21; i++) {
    const id = String(i).padStart(2, "0");
    contact(`buyer-${id}`, `Example handoff ${id}`);
    loan(`loan-${id}`, `buyer-${id}`, officer, `${id} Example Way`);
  }
  for (let i = 0; i < 3; i++) {
    insertSubmission(db, { id: `reference-${i}`, loanId: "loan-00", lender: `Lender ${i}`, externalId: "Example handoff 00",
      status: "In review", conditions: [], syncedAt: at });
  }
  const first = search("Example", "All records", officer);
  assert.deepEqual(first.rows.map(({ id }) => id), Array.from({ length: 20 }, (_, i) => `loan-${String(i).padStart(2, "0")}`));
  assert.equal(first.next.id, "loan-19");
  const second = search("Example", "All records", officer, first.next);
  assert.equal(second.rows[0].id, "loan-20");
  assert.equal(second.rows[1].id, "buyer-00");
  const third = search("Example", "All records", officer, second.next);
  assert.deepEqual(third.rows.map(({ id }) => id), ["buyer-19", "buyer-20"]);
  assert.equal(third.next, null);
});

test("search opens a current shared lead with scoped campaign details and permits its normal claim", async (t) => {
  const { db, id, admin, officer, other, processor, contact, search, open } = fixture(t);
  const leadId = crypto.randomUUID();
  const realtorLeadId = crypto.randomUUID();
  const campaignId = crypto.randomUUID();
  const originalDue = "2026-11-09T15:00:00.000Z";
  contact("search-agent", "Fictional realtor", "Realtor");
  insertContact(db, { id: "owned-contact", name: "Fictional visible match", role: "Borrower",
    email: "shared-search@example.test", phone: "", addedBy: officer.email });
  insertContact(db, { id: "hidden-contact", name: "Fictional restricted match", role: "Borrower",
    email: "shared-search@example.test", phone: "" });
  const lead = db.prepare(`INSERT INTO referral_leads (id,requestId,name,email,phone,purpose,officer,createdAt,dueAt,realtorId)
    VALUES (?,?,'Fictional search intake','shared-search@example.test','2485550180','Purchase','',?,?,?)`);
  lead.run(leadId, leadId, at, originalDue, null);
  lead.run(realtorLeadId, realtorLeadId, at, originalDue, "search-agent");
  const shown = search("Fictional search intake", "Leads", officer).rows;
  assert.deepEqual(shown.map(({ id }) => id), [leadId]);
  assert.ok(open("lead", realtorLeadId, officer).error);
  assert.ok(open("lead", leadId, processor).error);
  db.prepare("UPDATE referral_leads SET name = 'Fictional current intake', zip = '48304' WHERE id = ?").run(leadId);
  db.prepare("INSERT INTO call_campaigns (id,name,createdAt) VALUES (?,'Fictional enrolled campaign',?)").run(campaignId, at);
  db.prepare("INSERT INTO campaign_routing (campaignId,enabled,officers,revision) VALUES (?,1,?,1)")
    .run(campaignId, JSON.stringify([{ email: other.email, limit: 1 }]));
  db.prepare("INSERT INTO call_campaign_members (leadId,campaignId,joinedAt) VALUES (?,?,?)").run(leadId, campaignId, at);

  const statements = [];
  const observed = { ...db, prepare(sql) { statements.push(sql); return db.prepare(sql); } };
  const current = readWorkspaceSearch(observed, { type: "open", kind: "lead", id: shown[0].id }, officer, id);
  assert.equal(current.kind, "lead");
  assert.equal(current.lead.name, "Fictional current intake");
  assert.equal(current.lead.zip, "48304");
  assert.equal(current.lead.officerEmail, null);
  assert.equal(current.member.campaignId, campaignId);
  assert.equal(current.campaign.routing, undefined);
  assert.deepEqual(current.lead.matches.map(({ id }) => id), ["owned-contact"]);
  assert.equal(current.lead.restrictedMatch, true);
  assert.doesNotMatch(JSON.stringify(current), /hidden-contact|restricted match|other@example.test/);
  assert.ok(!statements.some((sql) => /SELECT loans\.\*|SELECT \* FROM contacts ORDER BY/.test(sql)));
  assert.equal(open("lead", leadId, admin).campaign.routing.officers[0].email, other.email);
  assert.ok(readWorkspaceSearch(db, { type: "open", kind: "lead", id: leadId }, officer, crypto.randomUUID()).error);

  const emptySnapshot = (await executeCommand(db, { type: "refreshWorkspace" }, processor)).state;
  const patched = applyLeadWork(emptySnapshot, current);
  assert.deepEqual(patched.inboxLeads.map(({ id }) => id), [leadId]);
  assert.equal(patched.callCampaignMembers[0].leadId, leadId);
  assert.equal(patched.loans, emptySnapshot.loans);

  const claimed = await executeCommand(db, { type: "assignInboxLead", leadId, previousEmail: null, email: officer.email }, officer);
  assert.ok(claimed.state, claimed.error);
  assert.equal(open("lead", leadId, officer).lead.dueAt, originalDue);
  assert.ok(open("lead", leadId, other).error);
  const reassigned = await executeCommand(db, { type: "assignInboxLead", leadId, previousEmail: officer.email, email: other.email },
    admin, undefined, [other]);
  assert.ok(reassigned.state, reassigned.error);
  assert.ok(open("lead", leadId, officer).error);
  assert.equal(open("lead", leadId, other).lead.officerEmail, other.email);
  assert.equal(open("lead", leadId, other).lead.dueAt, originalDue);
  db.prepare("UPDATE referral_leads SET resolvedAt = ? WHERE id = ?").run(at, leadId);
  assert.ok(open("lead", leadId, other).error);
});

test("indexed names and metadata stay fresh, and backfill and matches page without duplicates", (t) => {
  const { db, admin, contact, loan, search, open } = fixture(t);
  contact("zz-name", "Staleonly Example");
  loan("old-loan", "zz-name", admin, "90 Fictional Way");
  const thread = crypto.randomUUID();
  db.prepare(`INSERT INTO loan_conversations (id, loanId, contactId, audience, ownerRole, updatedAt)
    VALUES (?, 'old-loan', 'zz-name', 'Borrower', 'Loan officer', ?)`).run(thread, at);
  for (let i = 0; i < 203; i++) contact(`original-${String(i).padStart(3, "0")}`, "Paged contact");
  const first = search("Paged", "Contacts");
  assert.equal(first.rows.length, 20);
  assert.equal(first.indexing, true);
  const complete = search("Paged", "Contacts");
  assert.equal(complete.indexing, false);
  const paged = [...complete.rows];
  let next = complete.next;
  while (next) {
    const page = search("Paged", "Contacts", admin, next);
    assert.ok(page.rows.length <= 20);
    paged.push(...page.rows);
    next = page.next;
  }
  assert.equal(paged.length, 203);
  assert.equal(new Set(paged.map(({ id }) => id)).size, 203);
  assert.equal(search("Staleonly").rows.length, 3);
  db.exec("UPDATE contacts SET name = 'Freshonly Example' WHERE id = 'zz-name'");
  for (let i = 0; i < 275; i++) contact(`a-${String(i).padStart(3, "0")}`, "Queued contact");
  const old = search("Staleonly");
  assert.equal(old.indexing, true);
  assert.equal(old.rows.length, 0);
  const fresh = search("Freshonly");
  assert.deepEqual(fresh.rows.map(({ kind }) => kind), ["loan", "contact", "conversation"]);
  assert.equal(Object.getPrototypeOf(fresh.rows[0]), Object.prototype);
  db.exec("UPDATE loans SET contactId = 'original-000' WHERE id = 'old-loan'");
  assert.deepEqual(search("Freshonly").rows.map(({ kind }) => kind), ["contact"]);
  db.exec("DELETE FROM contacts WHERE id = 'zz-name'");
  assert.equal(search("Freshonly").rows.length, 0);
  assert.ok(open("contact", "zz-name").error);
});

test("search upgrades in place and follows conversation access and lead conversion", async (t) => {
  const { db, id, admin, officer, other, processor, contact, loan, search } = fixture(t);
  const leadId = crypto.randomUUID();
  const person = "Fictional Search Partner";
  contact("partner", person, "Realtor");
  contact("buyer", "Fictional Existing Buyer");
  loan("assigned", "buyer", officer, "16 Example Avenue", "partner");
  const searchLoan = search("Existing Buyer", "Loans");
  assert.equal(searchLoan.rows[0].id, "assigned");
  const oldCatalog = db.prepare("SELECT id FROM workspace_search_catalog WHERE kind = 'loan' AND recordId = 'assigned'").get().id;
  // Simulate a deployed search index from before the two conversation sources existed.
  for (const source of ["leadConversation", "contactConversation"]) {
    db.exec(`DROP TRIGGER workspace_search_${source}_insert; DROP TRIGGER workspace_search_${source}_delete;
      DROP TRIGGER workspace_search_${source}_update; DELETE FROM workspace_search_backfill WHERE kind = '${source}';`);
  }
  db.exec("DROP TRIGGER workspace_search_lead_conversation_links; DROP TRIGGER workspace_search_contact_conversation_links;");
  db.prepare(`INSERT INTO referral_leads (id, requestId, name, email, phone, purpose, officer, officerEmail, createdAt, dueAt)
    VALUES (?, ?, 'Fictional Search Lead', 'lead-search@example.test', '', 'Refinance', ?, ?, ?, ?)`)
    .run(leadId, leadId, officer.name, officer.email, at, at);
  const now = new Date(at);
  const write = (input, staff, replacement) => changeConversation(db, input, staff, id, now, replacement);
  const leadThread = write({ type: "startLead", leadId }, officer).id;
  const contactThread = write({ type: "startContact", contactId: "partner" }, admin).id;
  const open = (thread, staff) => readConversations(db, { type: "thread", id: thread }, staff, id, now);
  const find = (name, staff) => search(name, "Conversations", staff).rows;

  assert.deepEqual(find("Search Lead", officer).map(({ id, detail }) => [id, detail]),
    [[leadThread, "Lead conversation · Refinance · Open"]]);
  assert.deepEqual(find("Search Partner", admin).map(({ id, detail }) => [id, detail]),
    [[contactThread, "Contact conversation · Realtor · Open"]]);
  assert.equal(db.prepare("SELECT id FROM workspace_search_catalog WHERE kind = 'loan' AND recordId = 'assigned'").get().id, oldCatalog);
  assert.equal(find("Fictional Search", processor).length, 0);
  assert.equal(find("Search Partner", officer).length, 0);
  assert.ok(open(contactThread, officer).error);
  assert.equal(find("Search Lead", other).length, 0);
  assert.ok(open(leadThread, other).error);
  assert.ok(search("Search Partner", "Conversations", admin, undefined, crypto.randomUUID()).error);
  assert.equal(write({ type: "note", id: contactThread, eventId: crypto.randomUUID(), revision: 1, text: "Unindexed relationship note" }, admin).id, contactThread);
  assert.equal(find("Unindexed relationship", admin).length, 0);
  assert.equal(write({ type: "assignContact", id: contactThread, eventId: crypto.randomUUID(), revision: 2, email: other.email }, admin, other).id, contactThread);
  assert.equal(find("Search Partner", other)[0].id, contactThread);
  assert.equal(open(contactThread, other).thread.id, contactThread);
  assert.equal(write({ type: "sampleReply", id: contactThread, eventId: crypto.randomUUID(), revision: 3 }, other).id, contactThread);
  assert.equal(find("Search Partner Needs rep", other)[0].id, contactThread);
  db.exec("UPDATE contacts SET name = 'Renamed Relationship' WHERE id = 'partner'");
  assert.equal(find("Search Partner", other).length, 0);
  assert.equal(find("Renamed Relationship", other)[0].id, contactThread);

  db.prepare("UPDATE referral_leads SET officerEmail = NULL WHERE id = ?").run(leadId);
  assert.equal(search("Search Lead", "Leads", officer).rows[0].id, leadId);
  assert.equal(find("Search Lead", officer).length, 0);
  assert.ok(open(leadThread, officer).error);
  db.prepare("UPDATE referral_leads SET name = 'Renamed Prospect', officerEmail = ? WHERE id = ?").run(other.email, leadId);
  assert.equal(find("Search Lead", admin).length, 0);
  assert.equal(find("Renamed Prospect", other)[0].id, leadThread);
  const converted = await executeCommand(db, { type: "convertReferral", referralId: leadId, contactId: null }, other);
  assert.ok(converted.referralLoanId, converted.error);
  const after = find("Renamed Prospect", other);
  assert.deepEqual(after.map(({ id, loanId }) => [id, loanId]), [[leadThread, converted.referralLoanId]]);
  assert.equal(open(leadThread, other).thread.loanId, converted.referralLoanId);
  db.exec("UPDATE loans SET partnerId = NULL WHERE id = 'assigned'; DELETE FROM contacts WHERE id = 'partner';");
  assert.equal(find("Renamed Relationship", other).length, 0);
  assert.ok(open(contactThread, other).error);
});
