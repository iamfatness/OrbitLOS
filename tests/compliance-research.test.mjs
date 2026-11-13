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
    MI: ["REQ-MI-LICENSING-FIRST-RENEW", "REQ-MI-LICENSING-SECOND-RENEW", "REQ-MI-LICENSING-MLO-RENEW",
      "REQ-MI-LOAN-FEES", "REQ-MI-LOAN-BOOKLET", "REQ-MI-LOAN-CMPA-SERVICE", "REQ-MI-LOAN-CMPA-INTEGRITY",
      "REQ-MI-LOAN-CMPA-APPRAISAL", "REQ-MI-LOAN-CMPA-PREMIUM", "REQ-MI-LOAN-CMPA-TERM", "REQ-MI-OUTREACH-ADVERTISING",
      "REQ-MI-OUTREACH-SECONDARY-ADS", "REQ-MI-OUTREACH-MLO-ADS"],
    FL: ["REQ-FL-RECORDS-TXN-JOURNAL", "REQ-FL-RECORDS-FILE-ENTRIES", "REQ-FL-RECORDS-ALT-STORAGE",
      "REQ-FL-RECORDS-OFR-PRODUCTION"],
    TX: ["REQ-TX-RECORDS-ORIG-LOG", "REQ-TX-RECORDS-PROCESS-LOG", "REQ-TX-RECORDS-LOAN-FILES",
      "REQ-TX-RECORDS-CEASE-TRANSFER", "REQ-TX-RECORDS-CEASE-NOTICE",
      "REQ-TX-RECORDS-TRANSFER-NOTICE"],
    NY: ["REQ-NY-RECORDS-APP-LOG", "REQ-NY-RECORDS-BRANCH-REPORT", "REQ-NY-RECORDS-REJECTED-FILE",
      "REQ-NY-RECORDS-COMPLAINT-FILE", "REQ-NY-RECORDS-DFS-LETTERS"],
    OH: ["REQ-OH-REPORTING-MCR", "REQ-OH-LOAN-BROKER-DUTIES", "REQ-OH-OUTREACH-AD-IDENTIFIERS", "REQ-OH-RECORDS-EXAM-FILES"],
    IN: ["REQ-IN-LOAN-AGREEMENT", "REQ-IN-LOAN-FEE-DEPOSIT", "REQ-IN-REPORTING-CONDITION",
      "REQ-IN-OUTREACH-AD-ARCHIVE", "REQ-IN-RECORDS-EXAM-FILES"],
    IL: ["REQ-IL-REPORTING-ACTIVITY", "REQ-IL-LOAN-AGREEMENT", "REQ-IL-OUTREACH-ADVERTISING",
      "REQ-IL-RECORDS-LOAN-LOG", "REQ-IL-RECORDS-RETENTION"],
    WI: ["REQ-WI-REPORTING-FINSTAT", "REQ-WI-LOAN-AGREEMENT", "REQ-WI-OUTREACH-AD-IDENTIFIERS", "REQ-WI-RECORDS-APPLICATIONS"],
    MN: ["REQ-MN-LICENSING-COMPANY", "REQ-MN-REPORTING-MCR",
      "REQ-MN-LOAN-REFI-BENEFIT", "REQ-MN-OUTREACH-AD-CLAIMS", "REQ-MN-RECORDS-RETENTION"],
    IA: ["REQ-IA-LICENSING-COMPANY", "REQ-IA-REPORTING-MCR",
      "REQ-IA-LOAN-CONDUCT", "REQ-IA-OUTREACH-AD-TERMS", "REQ-IA-RECORDS-APPLICATIONS",
      "REQ-IA-REPORTING-BANKER-AUDIT", "REQ-IA-REPORTING-ORIG-DATA"],
    MO: ["REQ-MO-LICENSING-COMPANY", "REQ-MO-REPORTING-ANNUAL",
      "REQ-MO-LOAN-FEE-AGREEMENT", "REQ-MO-OUTREACH-ADVERTISING", "REQ-MO-RECORDS-ECOA-FILES"],
    NE: ["REQ-NE-LICENSING-COMPANY", "REQ-NE-REPORTING-MCR",
      "REQ-NE-LOAN-REFI-BENEFIT", "REQ-NE-OUTREACH-AD-IDENTIFIERS", "REQ-NE-RECORDS-RETENTION"],
    SD: ["REQ-SD-LICENSING-COMPANY", "REQ-SD-REPORTING-MCR",
      "REQ-SD-LOAN-APPRAISAL", "REQ-SD-OUTREACH-LICENSE-CLAIMS", "REQ-SD-RECORDS-EXAM-FILES"],
    ND: ["REQ-ND-LICENSING-COMPANY", "REQ-ND-REPORTING-MCR",
      "REQ-ND-LOAN-ADVANCE-DEPOSIT", "REQ-ND-OUTREACH-AD-TERMS", "REQ-ND-RECORDS-LAST-ENTRY"],
    KS: ["REQ-KS-LICENSING-COMPANY", "REQ-KS-REPORTING-SSSF",
      "REQ-KS-LOAN-CONSUMER-NOTICE", "REQ-KS-OUTREACH-AD-IDENTIFIERS", "REQ-KS-RECORDS-BROKER-FILES"],
    PA: ["REQ-PA-LICENSING-COMPANY", "REQ-PA-REPORTING-PERIODIC",
      "REQ-PA-LOAN-DISCLOSURE", "REQ-PA-OUTREACH-ADVERTISING", "REQ-PA-RECORDS-EXAM"],
    NY: ["REQ-NY-LICENSING-COMPANY", "REQ-NY-LICENSING-BANKER", "REQ-NY-LICENSING-SERVICER",
      "REQ-NY-REPORTING-VOOR", "REQ-NY-REPORTING-MCR", "REQ-NY-REPORTING-BANKER-VOOR", "REQ-NY-REPORTING-BANKER-QFS",
      "REQ-NY-REPORTING-BANKER-AUDIT", "REQ-NY-REPORTING-VOSR", "REQ-NY-REPORTING-SERVICER-QFS", "REQ-NY-REPORTING-SERVICER-AUD",
      "REQ-NY-LOAN-SPECIAL-FEE", "REQ-NY-OUTREACH-BROKER-ROLE", "REQ-NY-RECORDS-EXAM"],
    NJ: ["REQ-NJ-LICENSING-COMPANY", "REQ-NJ-REPORTING-ANNUAL",
      "REQ-NJ-LOAN-AGREEMENT", "REQ-NJ-OUTREACH-ADVERTISING", "REQ-NJ-RECORDS-EXAM"],
    DE: ["REQ-DE-LICENSING-COMPANY", "REQ-DE-REPORTING-VOLUME", "REQ-DE-REPORTING-ASSETS", "REQ-DE-REPORTING-MCR",
      "REQ-DE-LOAN-AGREEMENT", "REQ-DE-OUTREACH-AD-ARCHIVE", "REQ-DE-RECORDS-BROKER-FILES"],
    MD: ["REQ-MD-LICENSING-COMPANY", "REQ-MD-RECORDS-EXAM",
      "REQ-MD-LOAN-DISCLOSURE", "REQ-MD-OUTREACH-AD-IDENTIFIERS", "REQ-MD-REPORTING-MCR"],
    VA: ["REQ-VA-LICENSING-COMPANY", "REQ-VA-REPORTING-MCR",
      "REQ-VA-LOAN-COMPENSATION", "REQ-VA-OUTREACH-ADVERTISING", "REQ-VA-RECORDS-COMPENSATION"],
    WV: ["REQ-WV-LICENSING-COMPANY", "REQ-WV-REPORTING-NMLS",
      "REQ-WV-LOAN-FEES", "REQ-WV-OUTREACH-AD-ARCHIVE", "REQ-WV-RECORDS-BROKER-FILES"],
    CT: ["REQ-CT-LICENSING-COMPANY", "REQ-CT-REPORTING-MCR",
      "REQ-CT-LOAN-FEE-DISCLOSURE", "REQ-CT-LOAN-REFI-BENEFIT", "REQ-CT-OUTREACH-BROKER-ROLE", "REQ-CT-RECORDS-BROKER-FILES"],
    RI: ["REQ-RI-LICENSING-COMPANY", "REQ-RI-REPORTING-CONDITION", "REQ-RI-REPORTING-FINSTAT",
      "REQ-RI-LOAN-PRE-CLOSE-ESCROW", "REQ-RI-OUTREACH-LICENSE-STATUS", "REQ-RI-RECORDS-BROKER-FILES"],
    MA: ["REQ-MA-LICENSING-COMPANY", "REQ-MA-REPORTING-MCR", "REQ-MA-REPORTING-FINSTAT",
      "REQ-MA-LOAN-RATE-LOCK", "REQ-MA-LOAN-LICENSE-DISC", "REQ-MA-OUTREACH-BROKER-ROLE", "REQ-MA-RECORDS-BROKER-FILES"],
    VT: ["REQ-VT-LICENSING-COMPANY", "REQ-VT-REPORTING-ANNUAL", "REQ-VT-REPORTING-FINSTAT", "REQ-VT-REPORTING-MCR",
      "REQ-VT-LOAN-AGREEMENT", "REQ-VT-OUTREACH-AD-IDENTIFIERS", "REQ-VT-RECORDS-FINAL-ENTRY"],
    NH: ["REQ-NH-LICENSING-COMPANY", "REQ-NH-REPORTING-MCR", "REQ-NH-REPORTING-FINSTAT",
      "REQ-NH-LOAN-ADVANCE-FEES", "REQ-NH-OUTREACH-AD-IDENTIFIERS", "REQ-NH-RECORDS-FINAL-ACTIVITY"],
    ME: ["REQ-ME-LICENSING-COMPANY", "REQ-ME-REPORTING-BROKERED",
      "REQ-ME-LOAN-AGREEMENT", "REQ-ME-LOAN-EARLY-DISCLOSURE", "REQ-ME-OUTREACH-PRINT-AD", "REQ-ME-RECORDS-EXAM"],
    KY: ["REQ-KY-LICENSING-COMPANY", "REQ-KY-REPORTING-FHA",
      "REQ-KY-LOAN-FEE-DISCLOSURE", "REQ-KY-OUTREACH-AD-IDENTIFIERS", "REQ-KY-RECORDS-EXAM", "REQ-KY-REPORTING-MCR"],
    TN: ["REQ-TN-LICENSING-COMPANY", "REQ-TN-REPORTING-MCR",
      "REQ-TN-LOAN-FEE-SCHEDULE", "REQ-TN-OUTREACH-AD-CLAIMS", "REQ-TN-RECORDS-FILE-RETENTION", "REQ-TN-REPORTING-ANNUAL"],
    NC: ["REQ-NC-LICENSING-COMPANY", "REQ-NC-REPORTING-ANNUAL", "REQ-NC-REPORTING-DEPOSIT",
      "REQ-NC-REPORTING-FINSTAT", "REQ-NC-REPORTING-LOANLEVEL", "REQ-NC-REPORTING-MCR",
      "REQ-NC-LOAN-BORROWER-INTEREST", "REQ-NC-OUTREACH-AD-IDENTIFIERS", "REQ-NC-RECORDS-EXAM"],
    SC: ["REQ-SC-LICENSING-COMPANY", "REQ-SC-REPORTING-MORTGAGELOG",
      "REQ-SC-LOAN-FEE-AGREEMENT", "REQ-SC-OUTREACH-AD-AUTHORITY", "REQ-SC-RECORDS-BROKER-FILES"],
    GA: ["REQ-GA-LICENSING-COMPANY", "REQ-GA-REPORTING-MCR", "REQ-GA-REPORTING-GRMA",
      "REQ-GA-LOAN-FEE-DISCLOSURE", "REQ-GA-OUTREACH-AD-IDENTIFIERS", "REQ-GA-RECORDS-DISPOSITION"],
    FL: ["REQ-FL-LICENSING-COMPANY", "REQ-FL-LICENSING-LENDER", "REQ-FL-LICENSING-AMENDMENTS", "REQ-FL-REPORTING-MCR",
      "REQ-FL-REPORTING-LENDER-AUDIT", "REQ-FL-REPORTING-AUDIT-CHANGE", "REQ-FL-RECORDS-SERVICING-AUDIT",
      "REQ-FL-LOAN-THIRD-PARTY-FEES", "REQ-FL-OUTREACH-AD-CLAIMS", "REQ-FL-RECORDS-EXAM"],
    AL: ["REQ-AL-LICENSING-COMPANY", "REQ-AL-REPORTING-ANNUAL",
      "REQ-AL-LICENSING-NMLS-MOVE", "REQ-AL-LOAN-BROKER-FEES", "REQ-AL-OUTREACH-AD-IDENTIFIERS", "REQ-AL-RECORDS-EXAM"],
    MS: ["REQ-MS-LICENSING-COMPANY", "REQ-MS-RECORDS-FILE",
      "REQ-MS-LOAN-DUAL-ROLE", "REQ-MS-LOAN-LOCK-FEE", "REQ-MS-OUTREACH-AD-CHANNELS", "REQ-MS-REPORTING-MCR"],
    AR: ["REQ-AR-LICENSING-COMPANY", "REQ-AR-REPORTING-QUARTERLY",
      "REQ-AR-LOAN-BORROWER-INTEREST", "REQ-AR-OUTREACH-AD-IDENTIFIERS", "REQ-AR-RECORDS-BROKER-FILES"],
    LA: ["REQ-LA-LICENSING-COMPANY", "REQ-LA-LOAN-AGREEMENT",
      "REQ-LA-OUTREACH-AD-CLAIMS", "REQ-LA-RECORDS-EXAM", "REQ-LA-REPORTING-MCR"],
    TX: ["REQ-TX-LICENSING-COMPANY", "REQ-TX-LICENSING-CO-RENEW", "REQ-TX-LICENSING-BANKER-RENEW",
      "REQ-TX-LICENSING-OCCC-LENDER", "REQ-TX-REPORTING-OCCC-ANNUAL", "REQ-TX-REPORTING-MCR", "REQ-TX-REPORTING-SSSF",
      "REQ-TX-LOAN-APPLICANT-NOTICE", "REQ-TX-LOAN-DUAL-ROLE", "REQ-TX-OUTREACH-AD-IDENTIFIERS", "REQ-TX-RECORDS-EXAM"],
    OK: ["REQ-OK-LICENSING-COMPANY", "REQ-OK-REPORTING-MCR",
      "REQ-OK-LOAN-BROKER-FEES", "REQ-OK-OUTREACH-AD-CLAIMS", "REQ-OK-RECORDS-TRUST-LEDGER"],
    NM: ["REQ-NM-LICENSING-COMPANY", "REQ-NM-REPORTING-MCR",
      "REQ-NM-LOAN-DEPOSIT-AGREEMENT", "REQ-NM-OUTREACH-AD-IDENTIFIERS", "REQ-NM-RECORDS-BROKER-FILES"],
    CO: ["REQ-CO-LICENSING-COMPANY", "REQ-CO-REPORTING-MCR",
      "REQ-CO-LOAN-BORROWER-BENEFIT", "REQ-CO-OUTREACH-AD-IDENTIFIERS", "REQ-CO-RECORDS-EXAM"],
    AZ: ["REQ-AZ-LICENSING-COMPANY", "REQ-AZ-REPORTING-RENEWAL",
      "REQ-AZ-LOAN-FEE-AGREEMENT", "REQ-AZ-OUTREACH-AD-IDENTIFIERS", "REQ-AZ-RECORDS-BROKER-FILES"],
    UT: ["REQ-UT-LICENSING-COMPANY", "REQ-UT-REPORTING-CONDITION",
      "REQ-UT-LOAN-FEE-REFUND", "REQ-UT-LOAN-VALUATION-COPY", "REQ-UT-OUTREACH-AD-CLAIMS", "REQ-UT-RECORDS-FILE-RETENTION"],
    NV: ["REQ-NV-LICENSING-COMPANY", "REQ-NV-REPORTING-MONTHLY", "REQ-NV-REPORTING-MCR", "REQ-NV-REPORTING-FINSTAT",
      "REQ-NV-LOAN-FEE-DISCLOSURE", "REQ-NV-OUTREACH-AD-APPROVAL", "REQ-NV-RECORDS-BROKER-FILES"],
    CA: ["REQ-CA-LICENSING-COMPANY", "REQ-CA-LICENSING-CFL", "REQ-CA-LICENSING-CRMLA", "REQ-CA-REPORTING-BAR", "REQ-CA-REPORTING-CFLANNUAL",
      "REQ-CA-REPORTING-CRMLA-ANNUAL", "REQ-CA-REPORTING-HOLDEN", "REQ-CA-REPORTING-CRMLA-MCR", "REQ-CA-REPORTING-CRMLA-AUDIT",
      "REQ-CA-LOAN-DRE-DISCLOSURE", "REQ-CA-OUTREACH-DRE-ADS", "REQ-CA-RECORDS-DRE-FILES", "REQ-CA-LOAN-CFL-LOAN-TERMS", "REQ-CA-OUTREACH-CFL-ADS", "REQ-CA-RECORDS-CFL-EXAM", "REQ-CA-REPORTING-DRE-MCR"],
    OR: ["REQ-OR-LICENSING-COMPANY", "REQ-OR-REPORTING-ANNUAL",
      "REQ-OR-LOAN-CLOSING-DISC", "REQ-OR-OUTREACH-AD-ARCHIVE", "REQ-OR-RECORDS-BORROWER-FILES", "REQ-OR-REPORTING-MCR"],
    WA: ["REQ-WA-LICENSING-COMPANY", "REQ-WA-REPORTING-MCR", "REQ-WA-RECORDS-RETENTION",
      "REQ-WA-LOAN-DISCLOSURE", "REQ-WA-OUTREACH-AD-RATE-PROOF"],
    ID: ["REQ-ID-LICENSING-COMPANY", "REQ-ID-OUTREACH-ADVERTISING",
      "REQ-ID-LOAN-PRE-CLOSE-FEES", "REQ-ID-RECORDS-BROKER-FILES", "REQ-ID-REPORTING-MCR", "REQ-ID-REPORTING-FINANCIAL"],
    MT: ["REQ-MT-LICENSING-COMPANY", "REQ-MT-REPORTING-MCR",
      "REQ-MT-LOAN-ORIGINATION-DISC", "REQ-MT-OUTREACH-AD-IDENTIFIERS", "REQ-MT-RECORDS-FINAL-ACTIVITY"],
    WY: ["REQ-WY-LICENSING-COMPANY", "REQ-WY-REPORTING-RENEWAL", "REQ-WY-REPORTING-MCR",
      "REQ-WY-LOAN-FEE-AGREEMENT", "REQ-WY-OUTREACH-AD-CLAIMS", "REQ-WY-RECORDS-CLOSED-LOAN"],
    AK: ["REQ-AK-LICENSING-COMPANY", "REQ-AK-REPORTING-ANNUAL", "REQ-AK-REPORTING-MCR",
      "REQ-AK-LOAN-CO-BROKER-FEE", "REQ-AK-OUTREACH-AD-CLAIMS", "REQ-AK-RECORDS-EXAM"],
    HI: ["REQ-HI-LICENSING-COMPANY", "REQ-HI-REPORTING-MCR",
      "REQ-HI-LOAN-BROKER-FEES", "REQ-HI-OUTREACH-AD-IDENTIFIERS", "REQ-HI-RECORDS-EXAM"],
  };
  assert.deepEqual(new Set(Object.keys(rolloutRequirements)), new Set(stateRolloutSources.map(item => item.jurisdiction)));
  let total = 0;
  for (const [code, expected] of Object.entries(rolloutRequirements)) {
    const state = read(code);
    assert.equal(state.items.length, 5, code);
    for (const item of state.items) assert.ok(item.requirements.length > 0, item.source.key);
    const keys = state.items.flatMap(item => item.requirements.map(requirement => requirement.source.key));
    assert.equal(state.states.find(item => item.jurisdiction === code).requirements, keys.length);
    for (const key of expected) assert.ok(keys.includes(key), key);
    total += keys.length;
  }
  assert.equal(Object.keys(rolloutRequirements).length, 50);
  assert.equal(total, stateRequirementSources.length);
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

test("owner home separates current and changed company state records and pages the exact targets", t => {
  const f = fixture(t);
  const work = (type, input, actor = f.owner, target = f.tenant) =>
    complianceCaseWork(f.db, { type, input }, f.staff(actor, target), target, f.roster, now);
  const company = name => work("program", { operation: "createEntity", requestId: crypto.randomUUID(), name, nmls: "",
    scopeNote: "Fictional broker scope" }).entities.find(entity => entity.name === name).id;
  const north = company("Fictional North LLC");
  const south = company("Fictional South LLC");
  const facts = { activity: "Brokerage", lienScope: "First lien", companyEvidence: "", officeEvidence: "", originatorEvidence: "",
    products: "Closed-end purchase", responsibility: "", reportingBasis: "", counselPacketReference: "" };
  const save = (entityId, jurisdiction, expectedRevision = 0) =>
    work("stateScope", { operation: "save", entityId, jurisdiction, expectedRevision, facts, requestId: crypto.randomUUID() });
  const home = (stateOffset = 0) => work("program", { operation: "ownerHome", stateOffset });
  for (const jurisdiction of ["MI", "OH", "WI", "IN", "IL"]) assert.equal(save(north, jurisdiction).revision, 1);
  assert.equal(save(south, "MI").revision, 1);
  assert.equal(home().stateScopes.total, 6);
  assert.equal(home().stateScopes.needsRecheck, 0);
  assert.equal(home().stateScopes.items.length, 5);
  assert.equal(home(5).stateScopes.items.length, 1);
  const license = { operation: "saveLicense", requestId: crypto.randomUUID(), id: crypto.randomUUID(), entityId: south,
    revision: 0, jurisdiction: "MI", licenseType: "Fictional broker authority", licenseNumber: "FICTIONAL-009",
    status: "Active", effectiveOn: null, expiresOn: null, evidence: "Fictional register reference" };
  assert.equal(work("program", license).kind, "programLicenses");
  assert.deepEqual(home().stateScopes.items[0], { entityId: south, entityName: "Fictional South LLC", jurisdiction: "MI",
    revision: 1, openQuestions: 0, completedQuestions: 0, changes: ["License records changed"] });
  assert.equal(save(south, "MI", 1).revision, 2);
  assert.equal(home().stateScopes.needsRecheck, 0);
  f.db.prepare("UPDATE compliance_state_scope_versions SET sourceHash=?,licenseSnapshots=NULL WHERE entityId=? AND jurisdiction=? AND revision=2")
    .run("previous research source", south, "MI");
  f.db.prepare("UPDATE compliance_program_entities SET name=? WHERE id=?").run("Fictional South Updated LLC", south);
  assert.deepEqual(home().stateScopes.items[0], { entityId: south, entityName: "Fictional South Updated LLC", jurisdiction: "MI",
    revision: 2, openQuestions: 0, completedQuestions: 0, changes: ["Company details changed", "Research sources changed", "License records were not captured"] });
  assert.ok(work("program", { operation: "ownerHome" }, f.lo).error);
  assert.equal(work("program", { operation: "ownerHome" }, f.owner, crypto.randomUUID()).stateScopes.total, 0);
});

test("state requirement evidence is versioned by entity, state, source and exact scope", t => {
  const f = fixture(t);
  const work = (type, input, actor = f.owner, target = f.tenant) =>
    complianceCaseWork(f.db, { type, input }, f.staff(actor, target), target, f.roster, now);
  const entity = work("program", { operation: "createEntity", requestId: crypto.randomUUID(), name: "Fictional Michigan",
    nmls: "", scopeNote: "Fictional test entity" }).entities[0];
  const facts = { activity: "Brokerage", lienScope: "First lien", companyEvidence: "", officeEvidence: "",
    originatorEvidence: "", products: "Closed-end purchase", responsibility: "", reportingBasis: "", counselPacketReference: "" };
  const scope = (jurisdiction, expectedRevision = 0) => work("stateScope", {
    operation: "save", jurisdiction, entityId: entity.id, expectedRevision, facts, requestId: crypto.randomUUID(),
  });
  const sourceKey = "REQ-MI-LOAN-FEES";
  const query = { operation: "read", entityId: entity.id, jurisdiction: "MI", scopeRevision: 1, sourceKey };
  assert.ok(work("stateReadiness", query).error);
  for (const jurisdiction of stateRolloutSources.filter(item => item.key.endsWith("-LICENSING")).map(item => item.jurisdiction)) {
    assert.equal(scope(jurisdiction).revision, 1);
    const state = work("stateReadiness", { ...query, jurisdiction, sourceKey: undefined });
    assert.ok(state.items.some(item => item.key.startsWith(`REQ-${jurisdiction}-LICENSING-`)), jurisdiction);
    assert.ok(state.items.every(item => item.recorded === null), jurisdiction);
    for (const { key } of state.items) {
      assert.equal(work("stateReadiness", { ...query, jurisdiction, sourceKey: key }).historySourceKey, key, key);
    }
  }
  assert.equal(work("stateReadiness", query).legalApproval, false);
  assert.ok(work("stateReadiness", query, f.lo).error);
  assert.ok(work("stateReadiness", query, f.owner, crypto.randomUUID()).error);
  assert.ok(work("stateReadiness", { ...query, jurisdiction: "OH" }).error);
  const save = { ...query, operation: "save", expectedRevision: 0, requestId: crypto.randomUUID(), facts: {
    counsel: "Counsel advised applicable", counselEvidence: "Fictional counsel reference",
    control: "Control tested internally", controlEvidence: "Fictional test reference", nextAction: "Review deployment evidence",
  } };
  assert.ok(work("stateReadiness", { ...save, facts: { ...save.facts, counselEvidence: "" } }).error);
  assert.ok(work("stateReadiness", { ...save, facts: { ...save.facts, controlEvidence: "" } }).error);
  assert.equal(work("stateReadiness", save).revision, 1);
  assert.equal(work("stateReadiness", save).revision, 1);
  assert.ok(work("stateReadiness", { ...save, requestId: crypto.randomUUID() }).error);
  assert.equal(work("stateReadiness", { ...save, expectedRevision: 1, requestId: crypto.randomUUID(),
    facts: { ...save.facts, nextAction: "Fictional updated review" } }).revision, 2);
  const reviewed = work("stateReadiness", query);
  assert.equal(reviewed.items.find(item => item.key === sourceKey).recorded.revision, 2);
  assert.deepEqual(reviewed.history[1].facts, save.facts);
  assert.equal(work("program", { operation: "saveLicense", requestId: crypto.randomUUID(), id: crypto.randomUUID(),
    entityId: entity.id, revision: 0, jurisdiction: "MI", licenseType: "Fictional broker authority", licenseNumber: "FICTIONAL-002",
    status: "Active", effectiveOn: null, expiresOn: null, evidence: "Fictional register reference" }).kind, "programLicenses");
  assert.equal(work("stateScope", { operation: "read", entityId: entity.id, jurisdiction: "MI" }).licensesChanged, true);
  assert.equal(work("stateReadiness", query).readOnly, true);
  assert.ok(work("stateReadiness", { ...save, expectedRevision: 2, requestId: crypto.randomUUID() }).error);
  assert.equal(scope("MI", 1).revision, 2);
  const currentQuery = { ...query, scopeRevision: 2 };
  assert.equal(work("stateReadiness", currentQuery).readOnly, false);
  assert.equal(work("stateReadiness", currentQuery).items.find(item => item.key === sourceKey).recorded, null);
  f.db.prepare("UPDATE compliance_state_scope_versions SET sourceHash=? WHERE jurisdiction='MI' AND revision=2").run("changed");
  assert.equal(work("stateReadiness", currentQuery).scopeChanged, true);
  assert.ok(work("stateReadiness", { ...save, scopeRevision: 2, requestId: crypto.randomUUID() }).error);
  assert.equal(work("stateReadiness", query).historical, true);
  assert.equal(work("stateReadiness", query).history.length, 2);
});

test("state question appears in admin review, retains its source version, and retries without duplication", t => {
  const f = fixture(t);
  const work = (type, input, actor = f.owner, roster = f.roster, tenant = f.tenant) =>
    complianceCaseWork(f.db, { type, input }, f.staff(actor, tenant), tenant, roster, now);
  const entityId = work("program", { operation: "createEntity", requestId: crypto.randomUUID(), name: "Fictional State Broker",
    nmls: "", scopeNote: "Fictional state review entity" }).entities[0].id;
  const facts = { activity: "Brokerage", lienScope: "First lien", companyEvidence: "Fictional evidence 1", officeEvidence: "",
    originatorEvidence: "", products: "First mortgage purchase", responsibility: "", reportingBasis: "", counselPacketReference: "" };
  const basis = { entityId, jurisdiction: "MI", scopeRevision: 1 };
  const read = { operation: "read", ...basis };
  const scope = { operation: "save", entityId, jurisdiction: "MI", expectedRevision: 0, facts };
  assert.ok(work("scopeReview", read).error);
  assert.equal(work("stateScope", { ...scope, requestId: crypto.randomUUID() }).revision, 1);
  const assign = { operation: "assign", ...basis, requestId: crypto.randomUUID(), reviewerEmail: f.backup.email,
    reviewerRevision: 1, internalTarget: "2026-11-19", sourceKey: "REQ-MI-LOAN-FEES", question: "Do these fees apply to this entity?" };
  assert.ok(work("scopeReview", { ...assign, sourceKey: "REQ-OH-LOAN-FEES" }).error);
  assert.ok(work("scopeReview", { ...assign, reviewerEmail: f.lo.email }).error);
  assert.ok(work("scopeReview", { ...assign, reviewerRevision: 0 }).error);
  assert.ok(work("scopeReview", assign, f.lo).error);
  const assigned = work("scopeReview", assign);
  assert.equal(assigned.kind, "scopeReviewAssigned");
  assert.deepEqual(work("scopeReview", assign), assigned);
  assert.ok(work("scopeReview", { ...assign, question: "A changed question" }).error);
  assert.ok(work("scopeReview", assign, f.backup).error);
  assert.ok(work("scopeReview", read, f.owner, f.roster, crypto.randomUUID()).error);
  const { month, itemId } = assigned.target;
  assert.ok(work("program", { operation: "ownerHome" }, f.backup).reviews.items.some(item => item.id === itemId && item.ownerName === f.backup.name));
  const monthly = { operation: "month", entityId, month };
  assert.deepEqual(work("program", monthly, f.backup).items[0].stateReview.facts, facts);
  assert.equal(work("stateScope", { ...scope, expectedRevision: 1, facts: { ...facts, products: "Changed" }, requestId: crypto.randomUUID() }).revision, 2);
  assert.deepEqual(work("scopeReview", assign), assigned);
  assert.equal(work("scopeReview", read).canAssign, false);
  assert.ok(work("scopeReview", { ...assign, requestId: crypto.randomUUID() }).error);
  assert.deepEqual(work("scopeReview", { ...read, scopeRevision: 2 }).items, []);
  assert.deepEqual(work("program", monthly, f.backup).items[0].stateReview.facts, facts);
  const edit = { operation: "update", entityId, month, id: itemId, status: "Awaiting review", ownerEmail: f.backup.email,
    internalTarget: "2026-11-19", note: "Counsel reference collected. Confirm the license scope next.", evidence: "Fictional decision reference" };
  assert.equal(work("program", { ...edit, expectedRevision: 1, requestId: crypto.randomUUID() }, f.backup).items[0].status, "Awaiting review");
  assert.equal(work("program", { ...edit, status: "Completed", expectedRevision: 2, requestId: crypto.randomUUID() }, f.backup).items[0].status, "Completed");
  const archived = work("scopeReview", read);
  assert.equal(archived.items.length, 1);
  assert.equal(archived.items[0].latestNote, edit.note);
  assert.equal(archived.items[0].evidence, edit.evidence);
  assert.equal(archived.items[0].status, "Completed");
  assert.equal(work("scopeReview", read, f.owner, [f.owner, { ...f.backup, accessRevision: 2 }]).items[0].reviewer, null);
});

test("an owner can track a state question without a source and record an external answer", t => {
  const f = fixture(t);
  const work = (type, input) => complianceCaseWork(f.db, { type, input }, f.staff(f.owner), f.tenant, [f.owner], now);
  const entityId = work("program", { operation: "createEntity", requestId: crypto.randomUUID(), name: "Fictional Solo Broker",
    nmls: "", scopeNote: "Fictional first office" }).entities[0].id;
  const facts = { activity: "Brokerage", lienScope: "Unresolved", companyEvidence: "", officeEvidence: "", originatorEvidence: "",
    products: "Purchase", responsibility: "", reportingBasis: "", counselPacketReference: "" };
  assert.equal(work("stateScope", { operation: "save", entityId, jurisdiction: "MI", expectedRevision: 0, facts,
    requestId: crypto.randomUUID() }).revision, 1);
  const home = () => work("program", { operation: "ownerHome" });
  const questionCounts = () => home().stateScopes.items.map(({ openQuestions, completedQuestions }) => [openQuestions, completedQuestions]);
  assert.deepEqual(questionCounts(), [[0, 0]]);
  const basis = { entityId, jurisdiction: "MI", scopeRevision: 1 };
  const read = { operation: "read", ...basis };
  const [owner] = work("scopeReview", read).reviewers;
  assert.equal(owner.isCurrentUser, true);
  const question = "Which filings should we review for this office?";
  const submit = { operation: "assign", ...basis, requestId: crypto.randomUUID(), reviewerEmail: owner.email,
    reviewerRevision: owner.revision, internalTarget: "2026-11-19", question };
  const result = work("scopeReview", submit);
  assert.equal(result.kind, "scopeReviewAssigned");
  assert.deepEqual(work("scopeReview", submit), result);
  assert.ok(work("scopeReview", { ...submit, sourceKey: "REQ-MI-LOAN-FEES" }).error);
  const { month, itemId } = result.target;
  assert.ok(home().reviews.items.some(item => item.id === itemId && item.ownerName === owner.name && item.title.includes(question)));
  assert.deepEqual(questionCounts(), [[1, 0]]);
  const [pending] = work("program", { operation: "month", entityId, month }).items;
  assert.equal(pending.stateReview.source, null);
  assert.deepEqual(pending.stateReview.facts, facts);
  assert.equal(pending.stateReview.latestNote, undefined);
  const update = { operation: "update", entityId, month, id: itemId, ownerEmail: owner.email, internalTarget: submit.internalTarget,
    evidence: "Fictional compliance advice, office reference 7", note: "External reviewer answered the question. Confirm the scope next quarter." };
  assert.equal(work("program", { ...update, status: "Awaiting review", expectedRevision: 1,
    requestId: crypto.randomUUID() }).items[0].status, "Awaiting review");
  assert.equal(work("program", { ...update, status: "Completed", expectedRevision: 2,
    requestId: crypto.randomUUID() }).items[0].status, "Completed");
  const reopened = work("program", { operation: "month", entityId, month }).items.find(item => item.id === itemId);
  assert.equal(reopened.stateReview.latestNote, update.note);
  assert.equal(reopened.evidence, update.evidence);
  const saved = work("scopeReview", read).items;
  assert.equal(saved.length, 1);
  assert.equal(saved[0].source, null);
  assert.equal(saved[0].latestNote, update.note);
  assert.equal(saved[0].evidence, update.evidence);
  assert.deepEqual(questionCounts(), [[0, 1]]);
  assert.equal(work("stateScope", { operation: "save", entityId, jurisdiction: "MI", expectedRevision: 1,
    facts: { ...facts, products: "Purchase and refinance" }, requestId: crypto.randomUUID() }).revision, 2);
  assert.deepEqual(questionCounts(), [[0, 0]]);
  assert.equal(work("scopeReview", read).items[0].status, "Completed");
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

test("Florida amendments preserve distinct clocks and versioned evidence through the authenticated service", t => {
  const f = fixture(t);
  const call = (type, input, entityId, actor = f.owner) => complianceCaseWork(f.db,
    { type, entityId, input }, f.staff(actor), f.tenant, f.roster, now);
  const entityId = complianceCaseWork(f.db, { type: "program", input: {
    operation: "createEntity", requestId: crypto.randomUUID(), name: "Fictional Florida broker", nmls: "", scopeNote: "Fictional amendment review",
  } }, f.staff(), f.tenant, f.roster, now).entities[0].id;
  const work = (input, actor) => call("floridaAmendment", input, entityId, actor);
  const effective = { on: "2026-10-02", reference: "Fictional change effective date" };
  const base = { authority: "Mortgage broker", zone: "America/New_York", licenseReference: "Fictional Florida authority", effective };
  const save = (change, extra = {}) => ({ operation: "save", noticeId: crypto.randomUUID(), requestId: crypto.randomUUID(),
    expected: 0, facts: { ...base, change, ...extra } });
  const principal = save({ kind: "Principal loan originator", designationReference: "Fictional designation" });
  assert.ok(work(principal, f.lo).error);
  assert.ok(call("floridaAmendment", principal, crypto.randomUUID()).error);
  const initial = work(principal).versions[0];
  assert.equal(initial.finding.dueOn, "2026-11-01");
  assert.equal(initial.finding.designationReview, true);
  assert.equal(initial.finding.timingStatus, "Nominal date passed without filing evidence");
  assert.deepEqual(work(principal).versions, [initial]);
  assert.ok(work({ ...principal, requestId: crypto.randomUUID() }).error);
  const updated = { ...principal, requestId: crypto.randomUUID(), expected: 1, correction: "Fictional receipt added",
    facts: { ...principal.facts, filed: { on: "2026-11-03", reference: "Fictional Registry receipt" } } };
  const history = work(updated).versions;
  assert.equal(history[0].finding.timingStatus, "Filed after nominal date");
  assert.equal(history[0].finding.regulatorStatus, "No regulator status recorded");
  assert.deepEqual(history[1], initial);
  assert.equal(work({ operation: "history", noticeId: principal.noticeId, before: 2 }).versions.length, 1);
  assert.equal(work(save({ kind: "Control person", timing: { route: "Advance filing" } })).versions[0].finding.dueOn, "2026-09-02");
  const firstNotice = { on: "2026-09-04", reference: "Fictional first notice" };
  const control = (calendar) => save({ kind: "Control person", timing: { route: "First notice", firstNotice, calendar } });
  assert.equal(work(control()).versions[0].finding.timingStatus, "Verify business-day calendar");
  const calendar = { through: "2026-09-09", holidays: ["2026-09-07"], reference: "Fictional reviewed calendar" };
  assert.equal(work(control(calendar)).versions[0].finding.dueOn, "2026-09-09");
  assert.ok(work({ ...updated, requestId: crypto.randomUUID(), expected: 2, facts: { ...updated.facts,
    status: { on: "2026-11-02", reference: "Fictional status", outcome: "Acknowledged" } } }).error);
  assert.equal(work({ operation: "list" }).items.length, 4);
});
