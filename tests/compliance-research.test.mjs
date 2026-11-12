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
const { initializeStore } = await import("../src/lib/store.ts");
const { complianceCaseWork } = await import("../src/lib/compliance-cases.ts");
const { researchSources, stateRolloutSources, stateRequirementSources } = await import("../src/lib/compliance-research-model.ts");
const now = "2026-11-11T12:00:00.000Z";
const filters = { jurisdiction: "", status: "", ownership: "all" };
const unavailable = { error: "This compliance work is unavailable." };
function fixture(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const db = { exec: (sql) => sqlite.exec(sql), prepare: (sql) => sqlite.prepare(sql), transaction(run) {
    sqlite.exec("BEGIN");
    try { const result = run(); sqlite.exec("COMMIT"); return result; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } };
  initializeStore(db, false);
  const member = (email, role = "Admin") => ({ email, name: email.split("@")[0], role, status: "Active", accessRevision: 1 });
  const owner = member("owner@example.test"), backup = member("backup@example.test"), lo = member("lo@example.test", "LO");
  const roster = [owner, backup, lo];
  const tenant = crypto.randomUUID();
  const staff = (actor = owner, id = tenant) => ({ email: actor.email, name: actor.name, brokerage: { id, name: "Fictional", pilot: true,
    role: actor.role, accessRevision: actor.accessRevision } });
  const run = (input, actor = owner, members = roster, target = tenant) => complianceCaseWork(db, { type: "research", input }, staff(actor), target, members, now);
  const open = (sourceKey = "FED-02", kind = "Requirement review") => run({ operation: "open", sourceKey, kind });
  const list = (changes = {}, after) => run({ operation: "list", filters: { ...filters, ...changes }, ...(after ? { after } : {}) });
  const saveInput = (item, changes = {}) => ({ operation: "save", caseId: item.id, expectedRevision: item.revision, requestId: crypto.randomUUID(),
    ownerEmail: owner.email, status: "In progress", followUpOn: "2026-11-10", nextAction: "Confirm approved scope with reviewer", note: "Fictional research progress", ...changes });
  return { db, sqlite, run, open, list, saveInput, roster, owner, backup, lo, tenant, staff };
}

test("catalog covers 50 states and 25 federal areas without unknown jurisdiction fallback", () => {
  assert.equal(researchSources.length, 75);
  assert.equal(new Set(researchSources.map((entry) => entry.key)).size, 75);
  assert.equal(researchSources.filter((entry) => entry.jurisdiction === "US").length, 25);
  assert.equal(researchSources.some((entry) => entry.jurisdiction === "DC"), false);
});
test("state rollout tracks five independently owned areas across all 50 states", t => {
  const f = fixture(t);
  const query = { operation: "stateRollout", jurisdiction: "MI" };
  const overview = f.run(query);
  assert.equal(overview.kind, "stateRollout");
  assert.equal(overview.states.length, 50);
  assert.equal(stateRolloutSources.length, 250);
  assert.equal(new Set(stateRolloutSources.map(item => item.key)).size, 250);
  assert.ok(overview.states.every(item => item.total === 5 && item.tracked === 0));
  assert.ok(stateRolloutSources.filter(item => item.key.endsWith("-REPORTING")).every(item => item.sourceDate && item.relatedSources.length));
  assert.ok(overview.items.every(item => !item.cases.length));
  assert.deepEqual(f.run({ ...query, jurisdiction: "DC" }), unavailable);
  assert.deepEqual(f.run(query, f.lo), unavailable);
  assert.deepEqual(f.run(query, f.owner, [], f.tenant), unavailable);
  const item = f.open("STATE-MI-REPORTING").item;
  assert.equal(f.open("STATE-MI-REPORTING").item.id, item.id);
  assert.equal(JSON.parse(item.sourceSnapshot).researchBaseline, "2026-11-11");
  assert.ok(JSON.parse(item.sourceSnapshot).relatedSources.length);
  f.open("STATE-MI-REPORTING", "Control gap");
  f.open("STATE-NV-LICENSING");
  const updated = f.run(query);
  assert.equal(updated.states.find(state => state.jurisdiction === "MI").tracked, 1);
  assert.equal(updated.states.find(state => state.jurisdiction === "NV").tracked, 1);
  assert.equal(updated.items.find(entry => entry.source.key === "STATE-MI-REPORTING").cases.length, 2);
  assert.equal(f.list({ jurisdiction: "MI" }).counts.total, 2);
  assert.equal(updated.coverage.legalApproval, false);
  assert.equal(updated.coverage.runtimeEnforcement, false);
  const otherTenant = "other";
  const isolated = complianceCaseWork(f.db, { type: "research", input: query }, f.staff(f.owner, otherTenant), otherTenant, f.roster, now);
  assert.equal(isolated.states.find(state => state.jurisdiction === "MI").tracked, 0);
  f.db.prepare("UPDATE compliance_cases SET confidentiality = 'Restricted' WHERE id = ?").run(item.id);
  assert.equal(f.run(query).items.find(entry => entry.source.key === "STATE-MI-REPORTING").cases.length, 1);
});
test("specific requirements preserve independent review cases and counsel questions", t => {
  const f = fixture(t);
  const read = jurisdiction => f.run({ operation: "stateRollout", jurisdiction });
  assert.equal(new Set(stateRequirementSources.map(item => item.source.key)).size, stateRequirementSources.length);
  assert.ok(stateRequirementSources.every(item => item.source.key.length <= 30 && item.source.counselQuestion &&
    item.source.relatedSources.every(link => new URL(link.url).protocol === "https:")));
  assert.deepEqual(
    new Set(stateRequirementSources.filter(item => item.areaKey.endsWith("-LICENSING")).map(item => item.source.jurisdiction)),
    new Set(stateRolloutSources.map(item => item.jurisdiction)),
  );
  const rolloutRequirements = {
    MI: ["REQ-MI-LOAN-FEES", "REQ-MI-OUTREACH-ADVERTISING"],
    OH: ["REQ-OH-REPORTING-MCR"],
    IN: ["REQ-IN-LOAN-AGREEMENT"],
    IL: ["REQ-IL-REPORTING-ACTIVITY"],
    WI: ["REQ-WI-REPORTING-FINSTAT"],
    MN: ["REQ-MN-LICENSING-COMPANY", "REQ-MN-REPORTING-MCR"],
    IA: ["REQ-IA-LICENSING-COMPANY", "REQ-IA-REPORTING-MCR"],
    MO: ["REQ-MO-LICENSING-COMPANY", "REQ-MO-REPORTING-ANNUAL"],
    NE: ["REQ-NE-LICENSING-COMPANY", "REQ-NE-REPORTING-MCR"],
    SD: ["REQ-SD-LICENSING-COMPANY", "REQ-SD-REPORTING-MCR"],
    ND: ["REQ-ND-LICENSING-COMPANY", "REQ-ND-REPORTING-MCR"],
    KS: ["REQ-KS-LICENSING-COMPANY", "REQ-KS-REPORTING-SSSF"],
    PA: ["REQ-PA-LICENSING-COMPANY", "REQ-PA-REPORTING-PERIODIC"],
    NY: ["REQ-NY-LICENSING-COMPANY", "REQ-NY-REPORTING-VOOR", "REQ-NY-REPORTING-MCR"],
    NJ: ["REQ-NJ-LICENSING-COMPANY", "REQ-NJ-REPORTING-ANNUAL"],
    DE: ["REQ-DE-LICENSING-COMPANY", "REQ-DE-REPORTING-VOLUME", "REQ-DE-REPORTING-ASSETS", "REQ-DE-REPORTING-MCR"],
    MD: ["REQ-MD-LICENSING-COMPANY", "REQ-MD-RECORDS-EXAM"],
    VA: ["REQ-VA-LICENSING-COMPANY", "REQ-VA-REPORTING-MCR"],
    WV: ["REQ-WV-LICENSING-COMPANY", "REQ-WV-REPORTING-NMLS"],
    CT: ["REQ-CT-LICENSING-COMPANY", "REQ-CT-REPORTING-MCR"],
    RI: ["REQ-RI-LICENSING-COMPANY", "REQ-RI-REPORTING-CONDITION", "REQ-RI-REPORTING-FINSTAT"],
    MA: ["REQ-MA-LICENSING-COMPANY", "REQ-MA-REPORTING-MCR", "REQ-MA-REPORTING-FINSTAT"],
    VT: ["REQ-VT-LICENSING-COMPANY", "REQ-VT-REPORTING-ANNUAL", "REQ-VT-REPORTING-FINSTAT", "REQ-VT-REPORTING-MCR"],
    NH: ["REQ-NH-LICENSING-COMPANY", "REQ-NH-REPORTING-MCR", "REQ-NH-REPORTING-FINSTAT"],
    ME: ["REQ-ME-LICENSING-COMPANY", "REQ-ME-REPORTING-BROKERED"],
    KY: ["REQ-KY-LICENSING-COMPANY", "REQ-KY-REPORTING-FHA"],
    TN: ["REQ-TN-LICENSING-COMPANY", "REQ-TN-REPORTING-MCR"],
    NC: ["REQ-NC-LICENSING-COMPANY", "REQ-NC-REPORTING-ANNUAL", "REQ-NC-REPORTING-DEPOSIT",
      "REQ-NC-REPORTING-FINSTAT", "REQ-NC-REPORTING-LOANLEVEL", "REQ-NC-REPORTING-MCR"],
    SC: ["REQ-SC-LICENSING-COMPANY", "REQ-SC-REPORTING-MORTGAGELOG"],
    GA: ["REQ-GA-LICENSING-COMPANY", "REQ-GA-REPORTING-MCR", "REQ-GA-REPORTING-GRMA"],
    FL: ["REQ-FL-LICENSING-COMPANY", "REQ-FL-REPORTING-MCR"],
    AL: ["REQ-AL-LICENSING-COMPANY", "REQ-AL-REPORTING-ANNUAL"],
    MS: ["REQ-MS-LICENSING-COMPANY", "REQ-MS-RECORDS-FILE"],
    AR: ["REQ-AR-LICENSING-COMPANY", "REQ-AR-REPORTING-QUARTERLY"],
    LA: ["REQ-LA-LICENSING-COMPANY", "REQ-LA-LOAN-AGREEMENT"],
    TX: ["REQ-TX-LICENSING-COMPANY", "REQ-TX-REPORTING-MCR", "REQ-TX-REPORTING-SSSF"],
    OK: ["REQ-OK-LICENSING-COMPANY", "REQ-OK-REPORTING-MCR"],
    NM: ["REQ-NM-LICENSING-COMPANY", "REQ-NM-REPORTING-MCR"],
    CO: ["REQ-CO-LICENSING-COMPANY", "REQ-CO-REPORTING-MCR"],
    AZ: ["REQ-AZ-LICENSING-COMPANY", "REQ-AZ-REPORTING-RENEWAL"],
    UT: ["REQ-UT-LICENSING-COMPANY", "REQ-UT-REPORTING-CONDITION"],
    NV: ["REQ-NV-LICENSING-COMPANY", "REQ-NV-REPORTING-MONTHLY", "REQ-NV-REPORTING-MCR", "REQ-NV-REPORTING-FINSTAT"],
    CA: ["REQ-CA-LICENSING-COMPANY", "REQ-CA-LICENSING-CFL", "REQ-CA-REPORTING-BAR", "REQ-CA-REPORTING-CFLANNUAL"],
    OR: ["REQ-OR-LICENSING-COMPANY", "REQ-OR-REPORTING-ANNUAL"],
    WA: ["REQ-WA-LICENSING-COMPANY", "REQ-WA-REPORTING-MCR", "REQ-WA-RECORDS-RETENTION"],
    ID: ["REQ-ID-LICENSING-COMPANY", "REQ-ID-OUTREACH-ADVERTISING"],
    MT: ["REQ-MT-LICENSING-COMPANY", "REQ-MT-REPORTING-MCR"],
    WY: ["REQ-WY-LICENSING-COMPANY", "REQ-WY-REPORTING-RENEWAL", "REQ-WY-REPORTING-MCR"],
    AK: ["REQ-AK-LICENSING-COMPANY", "REQ-AK-REPORTING-ANNUAL", "REQ-AK-REPORTING-MCR"],
    HI: ["REQ-HI-LICENSING-COMPANY", "REQ-HI-REPORTING-MCR"],
  };
  for (const [code, expected] of Object.entries(rolloutRequirements)) {
    const keys = read(code).items.flatMap(item => item.requirements.map(requirement => requirement.source.key));
    for (const key of expected) assert.ok(keys.includes(key), key);
  }
  const rmla = f.open("REQ-MI-REPORTING-RMLA");
  const fc = f.open("REQ-MI-REPORTING-FC");
  assert.notEqual(rmla.item.id, fc.item.id);
  assert.equal(f.open("REQ-MI-REPORTING-RMLA").item.id, rmla.item.id);
  const snapshot = JSON.parse(rmla.item.sourceSnapshot);
  assert.equal(snapshot.researchBaseline, "2026-11-12");
  assert.match(snapshot.counselQuestion, /zero-activity/);
  const updated = read("MI");
  assert.equal(updated.states.find(state => state.jurisdiction === "MI").tracked, 1);
  assert.equal(updated.items.find(item => item.source.key === "STATE-MI-REPORTING").requirements
    .find(item => item.source.key === "REQ-MI-REPORTING-FC").cases[0].id, fc.item.id);
  assert.equal(updated.coverage.legalApproval, false);
});
test("state scope saves an exact entity and source basis without granting approval", t => {
  const f = fixture(t);
  const work = (type, input, actor = f.owner) => complianceCaseWork(f.db, { type, input }, f.staff(actor), f.tenant, f.roster, now);
  const entity = work("program", { operation: "createEntity", requestId: crypto.randomUUID(), name: "Fictional Michigan",
    nmls: "", scopeNote: "Broker scope needs counsel review" }).entities[0];
  const query = { operation: "read", jurisdiction: "MI", entityId: entity.id };
  const save = { ...query, operation: "save", requestId: crypto.randomUUID(), expectedRevision: 0, facts: {
    activity: "Brokerage", lienScope: "First lien", companyEvidence: "Fictional license", officeEvidence: "",
    originatorEvidence: "", products: "Closed-end purchase", responsibility: "Creditor LE", reportingBasis: "Fictional Q3",
    counselPacketReference: "",
  } };
  assert.equal(work("stateScope", query).revision, 0);
  const operational = { ...f.staff(), brokerage: { ...f.staff().brokerage, pilot: false, features: { uwm: false, compliance: true } } };
  assert.equal(complianceCaseWork(f.db, { type: "stateScope", input: query }, operational, f.tenant, f.roster, now).revision, 0);
  assert.ok(complianceCaseWork(f.db, { type: "stateScope", input: query }, {
    ...operational, brokerage: { ...operational.brokerage, features: { uwm: false, compliance: false } },
  }, f.tenant, f.roster, now).error);
  assert.ok(work("stateScope", save, f.lo).error);
  assert.ok(work("stateScope", { ...query, jurisdiction: "DC" }).error);
  assert.ok(work("stateScope", { ...query, entityId: crypto.randomUUID() }).error);
  const license = { operation: "saveLicense", requestId: crypto.randomUUID(), id: crypto.randomUUID(), entityId: entity.id,
    revision: 0, jurisdiction: "MI", licenseType: "Fictional broker authority", licenseNumber: "FICTIONAL-001",
    status: "Active", effectiveOn: null, expiresOn: null, evidence: "Fictional register reference" };
  assert.equal(work("program", license).kind, "programLicenses");
  assert.equal(work("program", { ...license, id: crypto.randomUUID(), requestId: crypto.randomUUID(), jurisdiction: "OH" }).kind, "programLicenses");
  const first = work("stateScope", save);
  assert.equal(first.legalApproval, false);
  assert.equal(first.revision, 1);
  assert.deepEqual(first.licenseSummary, [
    { holder: "Company", counts: { current: 1, expired: 0, review: 0 } },
    { holder: "Branch", counts: { current: 0, expired: 0, review: 0 } },
    { holder: "Loan officer", counts: { current: 0, expired: 0, review: 0 } },
  ]);
  assert.deepEqual(JSON.parse(first.savedBasis.licenses).map(({ id, revision }) => ({ id, revision })), [{ id: license.id, revision: 1 }]);
  assert.equal(work("stateScope", save).history.length, 1);
  assert.ok(work("stateScope", { ...save, requestId: crypto.randomUUID() }).error);
  const newScope = { ...save, requestId: crypto.randomUUID(), expectedRevision: 1,
    facts: { ...save.facts, products: "Purchase and refinance", counselPacketReference: "Fictional counsel packet" } };
  assert.equal(work("program", { ...license, requestId: crypto.randomUUID(), revision: 1, status: "Expired" }).kind, "programLicenses");
  const second = work("stateScope", newScope);
  assert.equal(second.revision, 2);
  assert.equal(second.licensesChanged, false);
  assert.equal(second.licenseSummary[0].counts.expired, 1);
  assert.equal(JSON.parse(second.savedBasis.licenses)[0].revision, 2);
  const replay = work("stateScope", save);
  assert.equal(replay.revision, 1);
  assert.equal(replay.latestRevision, 2);
  assert.equal(replay.licensesChanged, true);
  const historical = work("stateScope", { ...query, revision: 1 });
  assert.deepEqual(historical.facts, save.facts);
  assert.deepEqual(historical.savedBasis, first.savedBasis);
  assert.equal(historical.latestRevision, 2);
  const sources = JSON.parse(historical.savedBasis.sources).map(entry => JSON.parse(entry));
  assert.ok(sources.some(entry => entry.key === "REQ-MI-REPORTING-RMLA" && entry.counselQuestion));
  assert.ok(sources.some(entry => entry.key === "REQ-MI-LOAN-FEES" && entry.counselQuestion));
  assert.ok(sources.every(entry => entry.jurisdiction === "MI"));
  f.db.prepare("UPDATE compliance_state_scope_versions SET sourceHash = ? WHERE revision = 1").run("historic");
  assert.equal(work("stateScope", { ...query, revision: 1 }).sourceChanged, true);
  assert.equal(work("stateScope", { ...query, jurisdiction: "OH" }).revision, 0);
});
test("opening research is idempotent, canonical, and preserves research-only status", (t) => {
  const f = fixture(t);
  assert.equal(f.list().counts.total, 0);
  assert.equal(f.list().coverage.evaluatedFiles, null);
  const first = f.open();
  assert.equal(first.kind, "researchDetail");
  assert.equal(f.open().item.id, first.item.id);
  assert.equal(f.open().history.length, 1);
  const gap = f.open("FED-02", "Control gap");
  assert.notEqual(gap.item.id, first.item.id);
  assert.equal(f.list().counts.total, 2);
  assert.equal(JSON.parse(first.item.sourceSnapshot).researchBaseline, "2026-11-10");
  assert.deepEqual(first.coverage, { legalApproval: false, runtimeEnforcement: false, evaluatedFiles: null });
  const canonical = complianceCaseWork(f.db, { type: "list" }, f.staff(), f.tenant, f.roster, now);
  assert.equal(canonical.items.some((item) => item.id === first.item.id), true);
  assert.deepEqual(f.open("STATE-DC"), unavailable);
});
test("admin, tenant, pilot and current roster checks precede research reads and mutations", (t) => {
  const f = fixture(t), id = f.open().item.id;
  for (const input of [{ operation: "list", filters }, { operation: "read", caseId: id }, { operation: "open", sourceKey: "FED-01", kind: "Control gap" }]) {
    assert.deepEqual(f.run(input, f.lo), unavailable);
    assert.deepEqual(f.run(input, f.owner, f.roster, "other"), unavailable);
    assert.deepEqual(f.run(input, f.owner, [{ ...f.owner, status: "Revoked" }]), unavailable);
    assert.deepEqual(f.run(input, f.owner, [{ ...f.owner, accessRevision: 2 }]), unavailable);
    const staff = f.staff(); staff.brokerage.pilot = false;
    assert.deepEqual(complianceCaseWork(f.db, { type: "research", input }, staff, f.tenant, f.roster, now), unavailable);
  }
  const other = f.staff(f.owner, "other");
  assert.deepEqual(complianceCaseWork(f.db, { type: "research", input: { operation: "read", caseId: id } }, other, "other", f.roster, now), unavailable);
});
test("restricted research cases do not leak through reads, counts or reopening", (t) => {
  const f = fixture(t), { id } = f.open().item;
  f.db.prepare("UPDATE compliance_cases SET confidentiality = 'Restricted' WHERE id = ?").run(id);
  assert.equal(f.list().counts.total, 0);
  assert.deepEqual(f.run({ operation: "read", caseId: id }), unavailable);
  assert.deepEqual(f.open(), unavailable);
});
test("save is atomic, revision checked and retry-safe; workflow cannot grant legal approval", (t) => {
  const f = fixture(t), first = f.open(), input = f.saveInput(first.item);
  const saved = f.run(input);
  assert.equal(saved.item.revision, 2);
  assert.equal(saved.item.overdue, true);
  assert.equal(saved.history[0].note, input.note);
  assert.equal(f.run(input).item.revision, 2);
  assert.equal(f.run(input).history.length, 2);
  assert.match(f.run({ ...input, note: "Different payload" }).error, /changed/);
  assert.match(f.run({ ...input, requestId: crypto.randomUUID() }).error, /changed/);
  assert.deepEqual(f.run(f.saveInput(saved.item, { status: "Resolved" })), unavailable);
  assert.deepEqual(f.run({ ...f.saveInput(saved.item), legalApproval: true }), unavailable);
  assert.equal(f.run(f.saveInput(saved.item, { status: "Awaiting review" })).coverage.legalApproval, false);
});
test("owner revocation/reinvite requires reassignment and never silently restores ownership", (t) => {
  const f = fixture(t), first = f.open();
  const reassigned = f.run(f.saveInput(first.item, { ownerEmail: f.backup.email }));
  const roster = f.roster.map((member) => member.email === f.backup.email ? { ...member, accessRevision: 2 } : member);
  const staleOwner = f.run({ operation: "read", caseId: first.item.id }, f.owner, roster);
  assert.equal(staleOwner.item.ownerAvailable, false);
  const missing = f.run({ operation: "list", filters: { ...filters, ownership: "unavailable" } }, f.owner, roster);
  assert.equal(missing.counts.total, 1);
  const restored = f.run(f.saveInput(reassigned.item, { ownerEmail: f.backup.email }), f.owner, roster);
  assert.equal(restored.item.ownerAvailable, true);
  assert.match(f.run(f.saveInput(restored.item, { ownerEmail: f.lo.email })).error, /active brokerage admin/);
});
test("filtered keyset pages detect changes and reject cross-filter or revoked-roster cursors", (t) => {
  const f = fixture(t);
  for (const entry of researchSources.slice(0, 25)) f.open(entry.key);
  const first = f.list();
  assert.equal(first.items.length, 20);
  const last = f.list({}, first.next);
  assert.equal(last.items.length, 5);
  assert.equal(new Set([...first.items, ...last.items].map((item) => item.id)).size, 25);
  assert.match(f.list({ jurisdiction: "US" }, first.next).error, /changed/);
  assert.match(f.run({ operation: "list", filters, after: first.next }, f.owner, [f.owner, f.lo]).error, /changed/);
  f.run(f.saveInput(first.items[0]));
  assert.match(f.list({}, first.next).error, /changed/);
  assert.equal(f.list({ status: "In progress" }).counts.overdue, 1);
  assert.deepEqual(f.list({ jurisdiction: "ZZ" }), unavailable);
});
test("source changes and reopened stores retain the original source and review history", (t) => {
  const f = fixture(t), first = f.open("STATE-MI");
  const saved = f.run(f.saveInput(first.item, { followUpOn: null }));
  initializeStore(f.db, false);
  assert.equal(f.open("STATE-MI").item.id, first.item.id);
  assert.equal(f.open("STATE-MI").history.length, 2);
  f.db.prepare("UPDATE compliance_research_work SET sourceSnapshot = ? WHERE caseId = ?").run(JSON.stringify({ title: "Prior source" }), first.item.id);
  assert.equal(f.run({ operation: "read", caseId: first.item.id }).item.sourceChanged, true);
  assert.equal(saved.item.overdue, false);
});
test("audit-write failure rolls back case and metadata changes", (t) => {
  const f = fixture(t), first = f.open();
  f.db.exec("CREATE TRIGGER reject_research_event BEFORE INSERT ON compliance_case_events BEGIN SELECT RAISE(ABORT, 'fixture failure'); END;");
  assert.throws(() => f.run(f.saveInput(first.item)), /fixture failure/);
  const row = f.run({ operation: "read", caseId: first.item.id });
  assert.equal(row.item.revision, 1);
  assert.equal(row.item.followUpOn, null);
  assert.equal(row.history.length, 1);
});
