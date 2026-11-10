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

const { initializeStore, insertContact, leadWorkRecord } = await import("../src/lib/store.ts");
const { createCallCampaign } = await import("../src/lib/call-campaigns.ts");
const { saveCampaignRouting } = await import("../src/lib/campaign-routing.ts");
const { defaultLeadRouting } = await import("../src/lib/lead-inbox-model.ts");
const { leadFollowUp, writeLeadRouting } = await import("../src/lib/lead-inbox.ts");
const { optOutContact } = await import("../src/lib/outreach-preferences.ts");
const { defaultQuoteIntakeConfig } = await import("../src/lib/quote-intake-model.ts");
const { quoteIntakeRouting, receiveQuoteLead, workOnQuoteSettings } = await import("../src/lib/quote-intake.ts");
const { executeCommand } = await import("../src/lib/commands.ts");
const { getApplication } = await import("../src/lib/applications.ts");

function fixture(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const db = { prepare: (sql) => sqlite.prepare(sql), exec: (sql) => sqlite.exec(sql), transaction(run) {
    sqlite.exec("BEGIN");
    try { const result = run(); sqlite.exec("COMMIT"); return result; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } };
  initializeStore(db, false);
  const now = "2026-11-10T12:00:00.000Z";
  const token = "a".repeat(64);
  const admin = { email: "admin@example.test", name: "Fictional Admin",
    brokerage: { id: crypto.randomUUID(), name: "Fictional Brokerage", role: "Admin", pilot: true } };
  const officer = { email: "officer@example.test", name: "Fictional Officer" };
  const fallback = { email: "inbox@example.test", name: "Fictional Inbox Owner" };
  const members = [admin, officer, fallback];
  const campaignId = crypto.randomUUID();
  const officers = [admin, officer].map(({ email }) => ({ email, limit: 1 }));
  writeLeadRouting(db, { ...defaultLeadRouting, quoteToken: token, websiteOwner: fallback.email });
  createCallCampaign(db, admin, { id: campaignId, name: "Fictional website" }, now);
  saveCampaignRouting(db, admin, { campaignId, revision: 0, enabled: true, officers }, members, now);
  const config = { ...defaultQuoteIntakeConfig, title: "Fictional home quote", theme: "Evergreen", zip: "Required",
    timing: "Required", question: { prompt: "What is your goal?", required: true }, campaignId };
  const settings = (input, staff = admin, brokerage = admin.brokerage.id, eligibleOwner) => workOnQuoteSettings(db, input, staff, brokerage, now, eligibleOwner);
  const receive = (input, snapshot, roster = members) => receiveQuoteLead(db, { token, ...input }, snapshot, roster, now);
  const request = (index, overrides = {}) => ({ requestId: crypto.randomUUID(), formRevision: 1, name: `Fictional Borrower ${index}`,
    purpose: "Purchase", email: `quote-${index}@example.test`, phone: `248-555-016${index}`, zip: "48304", timing: "Just exploring",
    answer: "Fictional first home", consent: true, ...overrides });
  const lead = (data) => db.prepare(`SELECT lead.id, lead.officerEmail, lead.dueAt, lead.zip, lead.importSource,
    receipt.formRevision, receipt.answer, receipt.timing, receipt.campaignId, receipt.profile FROM referral_leads lead
    JOIN quote_intake_receipts receipt ON receipt.leadId = lead.id WHERE lead.requestId = ?`).get(data.requestId);
  return { db, now, token, admin, officer, fallback, members, campaignId, officers, config, settings, receive, request, lead };
}

test("website form publication checks brokerage and revision while preserving old links and receipts", (t) => {
  const { db, admin, config, settings, receive, request, lead } = fixture(t);
  const legacy = request(0, { formRevision: undefined, zip: "", answer: "", timing: "" });
  assert.equal(receive({ type: "read" }).value.revision, 0);
  assert.equal(receive({ type: "read", token: "b".repeat(64) }).status, 404);
  assert.deepEqual(receive(legacy).value, { received: true });
  const publish = { type: "publish", revision: 0, config };
  assert.ok(settings(publish, null).error);
  assert.ok(settings(publish, { ...admin, brokerage: { ...admin.brokerage, role: "LO" } }).error);
  assert.ok(settings(publish, { ...admin, brokerage: { ...admin.brokerage, pilot: false } }).error);
  assert.ok(settings(publish, admin, crypto.randomUUID()).error);
  assert.ok(settings({ ...publish, config: { ...config, campaignId: crypto.randomUUID() } }).error);
  assert.equal(settings(publish).revision, 1);
  assert.equal(settings({ ...publish, revision: 1 }).revision, 1);
  assert.match(settings(publish).error, /form changed/);
  const publicForm = receive({ type: "read" }).value;
  assert.equal(publicForm.revision, 1);
  assert.equal(publicForm.config.title, config.title);
  assert.equal("campaignId" in publicForm.config, false);
  assert.deepEqual(receive(legacy).value, { received: true });
  assert.equal(lead(legacy).formRevision, 0);
  assert.equal(receive(request(1, { formRevision: 0 })).status, 409);
  for (const overrides of [{ zip: "" }, { timing: "" }, { answer: "" }, { consent: false }, { website: "bot" }]) {
    assert.equal(receive(request(1, overrides)).status, 400);
  }
  assert.equal(db.prepare("SELECT count(*) AS total FROM referral_leads").get().total, 1);
  assert.equal(db.prepare("SELECT count(*) AS total FROM workspace_access_history WHERE action = 'Published quote intake form'").get().total, 1);
});

test("eligible quote requests respect campaign capacity and opted-out requests stay in the inbox", (t) => {
  const { db, now, admin, officer, fallback, campaignId, config, settings, receive, request, lead } = fixture(t);
  assert.equal(settings({ type: "publish", revision: 0, config }).revision, 1);
  const requests = [request(1), request(2), request(3), request(4, { phone: "" }), request(5)];
  insertContact(db, { id: "opted-out", name: requests[4].name, role: "Borrower", email: requests[4].email, phone: requests[4].phone });
  optOutContact(db, "opted-out", now);
  for (const data of requests) assert.deepEqual(receive(data).value, { received: true });
  assert.deepEqual(receive(requests[0]).value, { received: true });
  const results = requests.map(lead);
  assert.deepEqual(results.map(({ officerEmail }) => officerEmail), [admin.email, officer.email, null, fallback.email, fallback.email]);
  assert.deepEqual(results.map(({ campaignId }) => Boolean(campaignId)), [true, true, true, false, false]);
  assert.equal(results[0].campaignId, campaignId);
  assert.equal(results[0].dueAt, "2026-11-11T12:00:00.000Z");
  assert.ok(results.every(({ importSource, formRevision, zip }) => importSource === "Website quote request" && formRevision === 1 && zip === "48304"));
  assert.equal(leadFollowUp(db, results[4].id).status, "Stopped");
  assert.equal(leadFollowUp(db, results[0].id).events.filter(({ text }) => text.includes(config.question.prompt)).length, 1);
  assert.equal(settings({ type: "publish", revision: 1, config: { ...config, zip: "Hidden", timing: "Hidden", question: null } }).revision, 2);
  const hidden = request(6, { formRevision: 2 });
  assert.deepEqual(receive(hidden).value, { received: true });
  assert.deepEqual([lead(hidden).zip, lead(hidden).timing, lead(hidden).answer], ["", "", ""]);
  assert.deepEqual([lead(requests[0]).timing, lead(requests[0]).answer], ["Just exploring", "Fictional first home"]);
  assert.equal(db.prepare("SELECT count(*) AS total FROM referral_leads").get().total, 6);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
});

test("a campaign rule change during directory lookup keeps the website lead unassigned", (t) => {
  const { db, now, admin, campaignId, config, members, officers, settings, receive, request, lead } = fixture(t);
  assert.equal(settings({ type: "publish", revision: 0, config }).revision, 1);
  const snapshot = quoteIntakeRouting(db);
  saveCampaignRouting(db, admin, { campaignId, revision: 1, enabled: true, officers: officers.toReversed() }, members, now);
  const stale = request(1);
  assert.deepEqual(receive(stale, snapshot).value, { received: true });
  assert.equal(lead(stale).officerEmail, null);
  assert.equal(lead(stale).campaignId, campaignId);
  const directoryUnavailable = request(2);
  assert.deepEqual(receive(directoryUnavailable, undefined, []).value, { received: true });
  assert.equal(lead(directoryUnavailable).officerEmail, null);
});

test("purpose profiles preserve versioned questions, route separately and reject stale submissions", (t) => {
  const { db, admin, officer, campaignId, config, settings, receive, request, lead } = fixture(t);
  const read = (purpose) => receive({ type: "read", purpose }).value;
  const save = (profile, revision, config, eligibleOwner) =>
    settings({ type: "publish", profile, revision, config }, admin, admin.brokerage.id, eligibleOwner);
  const general = save("General", 0, defaultQuoteIntakeConfig);
  assert.equal(general.revision, 0);
  assert.equal(read("Refinance").profile, "General");
  const purchase = save("Purchase", 0, config);
  assert.equal(purchase.revision, 1);
  assert.equal(read("Purchase").profile, "Purchase");
  const refiConfig = { ...defaultQuoteIntakeConfig, title: "Fictional refinance", ownerEmail: officer.email,
    contact: "Email required", zip: "Hidden", question: { prompt: "What would you like to change?", required: true } };
  assert.match(save("Refinance", 0, refiConfig).error, /active loan officer/);
  const refi = save("Refinance", 0, refiConfig, officer);
  assert.equal(refi.revision, 2);
  assert.equal(read("Refinance").config.question.prompt, refiConfig.question.prompt);
  assert.doesNotMatch(JSON.stringify(read("Refinance")), /ownerEmail|campaignId|officer@example/);
  const buyer = request(1, { formRevision: purchase.revision });
  const borrower = request(2, { formRevision: refi.revision, purpose: "Refinance", phone: "", answer: "Lower the sample payment" });
  assert.equal(receive({ ...buyer, formRevision: refi.revision }).status, 409);
  assert.equal(receive({ ...borrower, formRevision: purchase.revision }).status, 409);
  assert.equal(receive({ ...borrower, answer: "" }).status, 400);
  assert.deepEqual(receive(buyer).value, { received: true });
  assert.deepEqual(receive(borrower).value, { received: true });
  assert.deepEqual([lead(buyer).profile, lead(buyer).campaignId], ["Purchase", campaignId]);
  assert.deepEqual([lead(borrower).profile, lead(borrower).officerEmail, lead(borrower).zip, lead(borrower).campaignId],
    ["Refinance", officer.email, "", null]);
  assert.match(JSON.stringify(leadFollowUp(db, lead(borrower).id).events), /Form version 2.*Refinance profile.*What would you like to change/);

  const retired = settings({ type: "retire", profile: "Refinance", revision: refi.revision });
  assert.equal(retired.active, false);
  assert.deepEqual(retired.history.map(({ active }) => active), [false, true]);
  assert.equal(read("Refinance").profile, "General");
  assert.equal(read("Purchase").revision, purchase.revision);
  assert.equal(receive({ ...borrower, requestId: crypto.randomUUID() }).status, 409);
  assert.deepEqual(receive(borrower).value, { received: true });
  assert.equal(lead(borrower).answer, borrower.answer);
  assert.equal(lead(borrower).formRevision, refi.revision);
});

test("visible answers are immutable and only staff-selected compatible fields prefill a new draft", async (t) => {
  const { db, admin, officer, settings, receive, request, lead } = fixture(t);
  const gate = { id: crypto.randomUUID(), prompt: "Is this a rental?", kind: "Yes or no", required: true, when: null, prefill: null };
  const occupancy = { id: crypto.randomUUID(), prompt: "How will you use it?", kind: "Occupancy", required: true,
    when: { questionId: gate.id, equals: "Yes" }, prefill: "occupancy" };
  const amount = { id: crypto.randomUUID(), prompt: "What loan amount are you considering?", kind: "Dollar amount", required: true,
    when: { questionId: occupancy.id, equals: "Investment property" }, prefill: "loanAmount" };
  const value = { ...amount, id: crypto.randomUUID(), prompt: "What is the estimated property value?", prefill: "estimatedValue" };
  const publish = (questions, revision = 0) => settings({ type: "publish", profile: "Refinance", revision,
    config: { ...defaultQuoteIntakeConfig, questions, ownerEmail: officer.email } }, admin, admin.brokerage.id, officer);
  assert.ok(publish([occupancy, gate]).error);
  assert.ok(publish([gate, { ...occupancy, prefill: "loanAmount" }]).error);
  assert.ok(publish([gate, occupancy, amount, { ...value, prefill: "loanAmount" }]).error);
  const config = [gate, occupancy, amount, value];
  assert.equal(publish(config).revision, 1);
  const form = receive({ type: "read", purpose: "Refinance" }).value;
  assert.ok(form.config.questions.every((question) => question.prefill === null));
  const answers = { [gate.id]: "Yes", [occupancy.id]: "Investment property", [amount.id]: "260000.00", [value.id]: "350000" };
  const visible = request(1, { purpose: "Refinance", answers });
  const hidden = request(2, { purpose: "Refinance", answers: { ...answers, [gate.id]: "No" } });
  assert.match(receive({ ...visible, answers: { ...answers, [occupancy.id]: "" } }).error, /How will you use it/);
  assert.match(receive({ ...visible, answers: { ...answers, [amount.id]: "-500" } }).error, /positive dollar amount/);
  assert.match(receive({ ...visible, answers: { ...answers, [occupancy.id]: "FHA secondary residence" } }).error, /Choose an available answer/);
  assert.deepEqual(receive(hidden).value, { received: true });
  assert.deepEqual(receive(visible).value, { received: true });
  assert.equal(publish([gate, { ...occupancy, prompt: "New prompt" }], 1).revision, 2);
  assert.deepEqual(receive(visible).value, { received: true });
  const leadId = lead(visible).id;
  assert.deepEqual(leadWorkRecord(db, lead(hidden).id).lead.intake.answers.map(({ value }) => value), ["No"]);
  const evidence = leadWorkRecord(db, leadId).lead.intake;
  assert.equal(evidence.revision, 1);
  assert.equal(evidence.answers[1].prompt, occupancy.prompt);
  const command = { type: "convertReferral", referralId: leadId, contactId: null };
  const lo = { ...officer, brokerage: { ...admin.brokerage, role: "LO" } };
  const convert = (revision, fields, staff = lo) =>
    executeCommand(db, { ...command, intakeReview: { revision, fields, occupancy: "Primary residence", loanAmount: "1" } }, staff);
  assert.ok((await convert(1, ["occupancy"], { ...lo, email: "other@example.test" })).error);
  assert.match((await convert(2, ["occupancy"])).error, /intake answers changed/);
  assert.ok((await convert(1, ["occupancy", "occupancy"])).error);
  assert.match((await executeCommand(db, { ...command, referralId: lead(hidden).id, intakeReview: { revision: 1, fields: ["loanAmount"] } }, lo)).error,
    /cannot prefill/);
  assert.equal(db.prepare("SELECT count(*) AS total FROM loans").get().total, 0);
  const converted = await convert(1, ["occupancy", "loanAmount"]);
  assert.ok(converted.referralLoanId, converted.error);
  const draft = getApplication(db, converted.referralLoanId);
  assert.deepEqual([draft.submittedAt, draft.reviewedAt], [null, null]);
  assert.deepEqual([JSON.parse(draft.draft).occupancy, JSON.parse(draft.draft).loanAmount, JSON.parse(draft.draft).estimatedValue],
    ["Investment property", "260000", ""]);
  assert.equal(db.prepare("SELECT amount FROM loans WHERE id = ?").get(converted.referralLoanId).amount, 0);
  const replay = await convert(1, ["estimatedValue"]);
  assert.equal(replay.referralLoanId, converted.referralLoanId);
  assert.equal(getApplication(db, converted.referralLoanId).draft, draft.draft);
  assert.equal(db.prepare("SELECT count(*) AS total FROM activity WHERE loanId = ? AND text LIKE 'Prefilled 1003 from Refinance intake v1%'")
    .get(converted.referralLoanId).total, 1);
});
