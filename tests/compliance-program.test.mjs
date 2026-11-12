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
const { readActionCounts } = await import("../src/lib/workspace-action-counts.ts");
const { initializeComplianceProgram } = await import("../src/lib/compliance-program.ts");
const { updateBranch } = await import("../src/lib/branches.ts");
const { complianceCaseWork } = await import("../src/lib/compliance-cases.ts");

const now = "2026-11-11T12:00:00.000Z";
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
  const run = (input, actor = owner, members = roster, target = tenant) => complianceCaseWork(db, { type: "program", input }, staff(actor), target, members, now);
  const create = (changes = {}) => run({operation:"createEntity",requestId:crypto.randomUUID(),name:"Michigan Pilot LLC",nmls:"",scopeNote:"Michigan broker; user and lawyer review pending",...changes});
  const entity = () => create().entities[0];
  const query = id => ({operation:"month",entityId:id,month:"2026-11"});
  const schedule = (id, changes={}) => ({operation:"schedule",entityId:id,month:"2026-11",requestId:crypto.randomUUID(),title:"Review reporting scope",category:"Reporting preparation",ownerEmail:owner.email,internalTarget:"2026-11-10",instructions:"Confirm reporting scope with legal reviewer",...changes});
  const update = (id,item,changes={}) => ({operation:"update",entityId:id,month:"2026-11",id:item.id,expectedRevision:item.revision,requestId:crypto.randomUUID(),status:"Awaiting review",ownerEmail:owner.email,internalTarget:item.internalTarget,evidence:"Internal scope review record 123",note:"Submitted for internal evidence review",...changes});
  return {db,sqlite,run,create,entity,query,schedule,update,roster,owner,backup,lo,tenant,staff};
}


test("entity creation retries once; request-ID reuse with a different body fails", t=>{
 const f=fixture(t),request={operation:"createEntity",requestId:crypto.randomUUID(),name:"Michigan pilot",nmls:"",scopeNote:"Legal review pending"};
 assert.equal(f.run(request).entities.length,1);assert.equal(f.run(request).entities.length,1);
 assert.match(f.run({...request,name:"Different company"}).error,/changed/);
});
test("program operations retain pilot, tenant, role and current-roster boundaries",t=>{
 const f=fixture(t),e=f.entity(),q=f.query(e.id);
 assert.ok(f.run(q,f.lo).error);assert.ok(f.run(q,f.owner,[],f.tenant).error);
 assert.ok(f.run(q,f.owner,f.roster,crypto.randomUUID()).error);
 assert.ok(complianceCaseWork(f.db,{type:"program",input:q},{...f.staff(),brokerage:{...f.staff().brokerage,pilot:false}},f.tenant,f.roster,now).error);
 const other=f.staff(f.owner,crypto.randomUUID());assert.ok(complianceCaseWork(f.db,{type:"program",input:q},other,other.brokerage.id,f.roster,now).error);
});
test("internal targets, review state and evidence do not claim regulatory completion",t=>{
 const f=fixture(t),e=f.entity();let m=f.run(f.schedule(e.id));
 assert.equal(m.counts.overdue,1);assert.equal(m.coverage,"Regulatory applicability not evaluated");
 assert.match(f.run(f.update(e.id,m.items[0],{status:"Completed"})).error,/Submit/);
 m=f.run(f.update(e.id,m.items[0]));assert.equal(m.items[0].status,"Awaiting review");
 assert.match(f.run(f.update(e.id,m.items[0],{status:"Completed",evidence:""})).error,/evidence/);
 m=f.run(f.update(e.id,m.items[0],{status:"Completed"}));assert.equal(m.counts.open,0);assert.equal(m.counts.overdue,0);
});
test("save replay is exact and stale revisions cannot overwrite work",t=>{
 const f=fixture(t),e=f.entity(),first=f.run(f.schedule(e.id)),req=f.update(e.id,first.items[0]);
 assert.equal(f.run(req).items[0].revision,2);assert.equal(f.run(req).items[0].revision,2);
 assert.match(f.run({...req,requestId:crypto.randomUUID()}).error,/changed/);
 assert.match(f.run({...req,note:"Different retry payload"}).error,/changed/);
});
test("review snapshots retain unresolved work and invalidate after edits",t=>{
 const f=fixture(t),e=f.entity();let m=f.run(f.schedule(e.id));
 const req={operation:"reviewMonth",entityId:e.id,month:"2026-11",requestId:crypto.randomUUID(),fingerprint:m.fingerprint,note:"One outstanding reporting review; follow up with lawyer"};
 m=f.run(req);assert.equal(m.counts.open,1);assert.equal(m.reviews[0].current,true);
 assert.equal(JSON.parse(m.reviews[0].snapshot).counts.open,1);assert.equal(f.run(req).reviews.length,1);
 m=f.run(f.update(e.id,m.items[0]));assert.equal(m.reviews[0].current,false);
 assert.match(f.run({...req,requestId:crypto.randomUUID()}).error,/changed/);
});
test("reinvited owner is unavailable and invalidates current monthly basis",t=>{
 const f=fixture(t),e=f.entity();let m=f.run(f.schedule(e.id));
 const changedRoster=f.roster.map(x=>x.email===f.backup.email?x:{...x,accessRevision:2});
 m=f.run(f.query(e.id),f.backup,changedRoster);assert.equal(m.counts.unavailableOwners,1);
 const before=m.fingerprint;m=f.run(f.update(e.id,m.items[0],{ownerEmail:f.backup.email}),f.backup,changedRoster);
 assert.equal(m.items[0].ownerAvailable,true);assert.notEqual(m.fingerprint,before);
});
test("entity and period cannot cross-update an item or accept unknown fields",t=>{
 const f=fixture(t),e=f.entity(),m=f.run(f.schedule(e.id));
 const second=f.create({name:"Second legal entity"}).entities.find(x=>x.id!==e.id);
 assert.ok(f.run(f.update(second.id,m.items[0])).error);
 assert.ok(f.run({...f.update(e.id,m.items[0]),month:"2026-12"}).error);
 assert.ok(f.run({...f.schedule(e.id),legalDeadline:"2026-11-30"}).error);
 assert.ok(f.run({...f.query(e.id),month:"2026-13"}).error);
});
test("audit failure rolls back the entire mutation",t=>{
 const f=fixture(t),e=f.entity();f.sqlite.exec("CREATE TRIGGER fail_program BEFORE INSERT ON compliance_program_events BEGIN SELECT RAISE(ABORT,'audit unavailable'); END");
 assert.throws(()=>f.run(f.schedule(e.id)),/audit unavailable/);assert.equal(f.run(f.query(e.id)).items.length,0);
});
test("reinitializing preserves entities, work, reviews and history",t=>{
 const f=fixture(t),e=f.entity();f.run(f.schedule(e.id));initializeStore(f.db,false);
 assert.equal(f.run(f.query(e.id)).items.length,1);assert.equal(f.run(f.query(e.id)).history.length,1);
});

test("bounded entity/month scope rejects overflow instead of truncating",t=>{
 const f=fixture(t),e=f.entity();
 for(let i=0;i<200;i++)assert.equal(f.run(f.schedule(e.id,{title:`Internal work ${i}`})).kind,"programMonth");
 assert.match(f.run(f.schedule(e.id)).error,/200/);assert.equal(f.run(f.query(e.id)).items.length,200);
 for(let i=1;i<50;i++)assert.equal(f.create({name:`Entity ${i}`}).kind,"programEntities");
 assert.match(f.create().error,/50/);
});
test("an empty month cannot be signed off",t=>{
 const f=fixture(t),e=f.entity(),m=f.run(f.query(e.id));
 assert.match(f.run({operation:"reviewMonth",entityId:e.id,month:"2026-11",requestId:crypto.randomUUID(),fingerprint:m.fingerprint,note:"Review empty month"}).error,/Add review work/);
});

test("restore refuses to rewind compliance program evidence",async()=>{
 const {restoreBlockers}=await import("../src/lib/workspace-restore.ts");
 const before={schema:"same",tables:[{name:"compliance_program_events",digest:"old",rows:1}],impact:{},files:{items:[]}};
 assert.equal(restoreBlockers(before,before).length,0);
 assert.ok(restoreBlockers(before,{...before,tables:[{name:"compliance_program_events",digest:"new",rows:2}]}).some(x=>x.includes("Compliance program records changed")));
});

test("integrated learning and obligations retain authentication and atomic audit boundaries",t=>{
 const f=fixture(t), e=f.entity();
 const call=(type,input,staff=f.staff(),roster=f.roster)=>complianceCaseWork(f.db,{type,input},staff,f.tenant,roster,now);
 assert.equal(call("obligations",{operation:"list",entityId:e.id}).result.kind,"obligationRegistry");
 assert.equal(call("learning",{operation:"list"}).result.kind,"learningLibrary");
 for(const type of ["learning","obligations"]){
   const input=type==="learning"?{operation:"list"}:{operation:"list",entityId:e.id};
   assert.ok(call(type,input,null).error);
   assert.ok(call(type,input,f.staff(),[]).error);
   assert.ok(call(type,input,{...f.staff(),brokerage:{...f.staff().brokerage,pilot:false}}).error);
 }
 const input={operation:"createVersion",requestId:crypto.randomUUID(),contentId:crypto.randomUUID(),previousVersionId:null,
   kind:"Policy",title:"Fictional policy",body:"Internal draft for review",sourceReferences:"Fictional test evidence",questions:[],passPercent:100};
 assert.ok(call("learning",input,f.staff(f.lo)).result.error);
 f.sqlite.exec("CREATE TRIGGER fail_learning BEFORE INSERT ON compliance_learning_events BEGIN SELECT RAISE(ABORT,'audit unavailable'); END");
 assert.throws(()=>call("learning",input),/audit unavailable/);
 assert.equal(call("learning",{operation:"list"}).result.items.length,0);
});

test("restore protects obligation versions and learning evidence",async()=>{
 const {restoreBlockers}=await import("../src/lib/workspace-restore.ts");
 for(const name of ["compliance_obligation_versions","compliance_obligation_occurrences","compliance_obligation_events","compliance_obligation_work","compliance_state_scope_versions",
   "compliance_learning_versions","compliance_learning_assignments","compliance_learning_events"]){
   const before={schema:"same",tables:[{name,digest:"old",rows:1}],impact:{},files:{items:[]}};
   assert.equal(restoreBlockers(before,before).length,0);
   assert.ok(restoreBlockers(before,{...before,tables:[{name,digest:"new",rows:2}]}).some(x=>x.includes("Compliance program records changed")));
 }
});

test("license register uses recorded state scope, exact retries, and current operational admin access", t => {
  const f = fixture(t);
  const entity = f.entity();
  const request = { operation: "saveLicense", entityId: entity.id, id: crypto.randomUUID(), requestId: crypto.randomUUID(),
    revision: 0, jurisdiction: "MI", licenseType: "Fictional broker license", licenseNumber: "TEST-01", status: "Active",
    effectiveOn: "2026-01-01", expiresOn: "2026-12-31", evidence: "Fictional license review" };
  const admin = f.staff();
  const operational = { ...admin, brokerage: { ...admin.brokerage, pilot: false, features: { compliance: true, uwm: false, revision: 1 } } };
  const work = (input, actor = operational) => complianceCaseWork(f.db, { type: "program", input }, actor, f.tenant, f.roster, now);
  assert.equal(work(request).licenses[0].revision, 1);
  assert.equal(work(request).licenses.length, 1);
  assert.match(work({ ...request, evidence: "Different retry" }).error, /changed/);
  assert.match(work({ ...request, id: crypto.randomUUID(), requestId: crypto.randomUUID(), licenseNumber: "test-01" }).error, /already recorded/);
  assert.match(work({ ...request, requestId: crypto.randomUUID(), revision: 1, expiresOn: "2025-12-31" }).error, /expiration date/);
  const edit = { ...request, requestId: crypto.randomUUID(), revision: 1, expiresOn: "2027-12-31" };
  assert.equal(work(edit).licenses[0].expiresOn, "2027-12-31");
  assert.match(work({ ...edit, requestId: crypto.randomUUID() }).error, /changed/);
  assert.equal(f.sqlite.prepare("SELECT count(*) AS total FROM compliance_program_events WHERE action LIKE '%license%'").get().total, 2);
  const list = { operation: "licenses", entityId: entity.id };
  assert.ok(work(list, { ...operational, brokerage: { ...operational.brokerage, features: { compliance: false, uwm: false, revision: 2 } } }).error);
  assert.ok(work(list, f.staff(f.lo)).error);
  assert.ok(work({ ...list, entityId: crypto.randomUUID() }).error);
});

test("operational branch and officer license holders retain identity through archive and reinvitation", t => {
  const f = fixture(t);
  const entity = f.entity();
  const admin = f.staff();
  const staff = { ...admin, brokerage: { ...admin.brokerage, pilot: false, features: { compliance: true, uwm: false, revision: 1 } } };
  const branch = crypto.randomUUID();
  assert.ok(updateBranch(f.db, { type: "saveBranch", id: branch, revision: 0, name: "Fictional Office", staffEmails: [], ownerEmail: null },
    staff, f.tenant, f.roster).message);
  const read = { operation: "licenses", entityId: entity.id };
  const work = (input, roster = f.roster) => complianceCaseWork(f.db, { type: "program", input }, staff, f.tenant, roster, now);
  const save = (licenseNumber, holder, expiresOn) => ({ operation: "saveLicense", entityId: entity.id, id: crypto.randomUUID(), requestId: crypto.randomUUID(),
    revision: 0, jurisdiction: "MI", licenseType: "Fictional license", licenseNumber, status: "Active", effectiveOn: null,
    expiresOn, evidence: "", holder });
  const office = save("BRANCH-01", { kind: "Branch", id: branch }, "2026-12-11");
  const loanOfficer = save("LO-01", { kind: "Loan officer", id: f.lo.email, accessRevision: 1 }, "2026-11-10");
  assert.equal(work(office).licenses[0].renewal, "Expires soon");
  assert.equal(work(loanOfficer).licenses[1].renewal, "Past expiration");
  assert.ok(work(save("FOREIGN", { kind: "Branch", id: crypto.randomUUID() }, null)).error);
  assert.ok(work(save("STALE", { kind: "Loan officer", id: f.lo.email, accessRevision: 0 }, null)).error);
  assert.ok(updateBranch(f.db, { type: "setBranchActive", id: branch, revision: 1, active: false }, staff, f.tenant, f.roster).message);
  const rehired = f.roster.map(member => member.email === f.lo.email ? { ...member, accessRevision: 3 } : member);
  const after = work(read, rehired);
  assert.deepEqual(after.licenses.map(item => [item.holderLabel, item.holderAvailable]), [["Fictional Office", false], ["lo", false]]);
  assert.equal(work({ ...office, revision: 1, requestId: crypto.randomUUID(), status: "Inactive", holder: undefined }, rehired).licenses[0].renewal, null);
  const reassigned = work({ ...loanOfficer, revision: 1, requestId: crypto.randomUUID(), holder: { ...loanOfficer.holder, accessRevision: 3 } }, rehired);
  assert.equal(reassigned.licenses[1].holderAvailable, true);
  assert.equal(reassigned.licenses[1].holder.accessRevision, 3);
});

test("upgrading a pre-existing license register preserves company records", t => {
  const f = fixture(t);
  const entity = f.entity();
  const id = crypto.randomUUID();
  f.sqlite.exec("ALTER TABLE compliance_program_licenses DROP COLUMN holder; ALTER TABLE compliance_program_licenses DROP COLUMN renewalOwner; ALTER TABLE compliance_program_events DROP COLUMN details");
  f.sqlite.prepare("INSERT INTO compliance_program_licenses VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(f.tenant, entity.id, id, "MI", "Fictional company license", "ORIGINAL-1", "Active", null, null, "Saved prior evidence", 2, now);
  initializeComplianceProgram(f.db);
  const { licenses } = f.run({ operation: "licenses", entityId: entity.id });
  assert.equal(licenses[0].id, id);
  assert.equal(licenses[0].revision, 2);
  assert.equal(licenses[0].evidence, "Saved prior evidence");
  assert.deepEqual(licenses[0].holder, { kind: "Company" });
  assert.equal(licenses[0].holderAvailable, true);
});

test("renewal queue is tenant-scoped, paged in date order and clears renewed licenses", t => {
  const f = fixture(t);
  const first = f.entity();
  const second = f.create({ name: "Second fictional entity" }).entities.find(entity => entity.id !== first.id);
  const save = (licenseNumber, entityId, expiresOn, status = "Active") => ({
    operation: "saveLicense", entityId, id: crypto.randomUUID(), requestId: crypto.randomUUID(), revision: 0,
    jurisdiction: "MI", licenseType: "Fictional company license", licenseNumber, status, expiresOn, effectiveOn: null, evidence: "",
  });
  const past = save("PAST", first.id, "2026-11-10", "Expired");
  const boundary = save("DAY30", second.id, "2026-12-11");
  assert.ok(f.run(past).licenses);
  assert.ok(f.run(boundary).licenses);
  f.run(save("DAY31", first.id, "2026-12-12"));
  f.run(save("PENDING", second.id, "2026-11-10", "Pending"));
  for (let index = 1; index <= 8; index++) f.run(save(`R-${index}`, first.id, "2026-11-15"));
  const query = { operation: "licenseRenewals" };
  const page = f.run(query);
  assert.equal(page.total, 10);
  assert.deepEqual([page.items[0].licenseId, page.items[0].renewal], [past.id, "Past expiration"]);
  const next = f.run({ ...query, after: page.next });
  assert.equal(next.items.length, 2);
  assert.deepEqual([next.items[1].licenseId, next.items[1].entityName], [boundary.id, second.name]);
  assert.equal(next.next, null);
  f.run({ ...past, requestId: crypto.randomUUID(), revision: 1, status: "Active", expiresOn: "2027-01-01" });
  assert.equal(f.run(query).total, 9);
  assert.ok(f.run(query, f.lo).error);
  const other = f.staff(f.owner, crypto.randomUUID());
  const otherQueue = complianceCaseWork(f.db, { type: "program", input: query }, other, other.brokerage.id, f.roster, now);
  assert.equal(otherQueue.total, 0);
});

test("renewal owner changes are versioned, safely replayed and visible in exact history", t => {
  const f = fixture(t);
  const entity = f.entity();
  const id = crypto.randomUUID();
  const initial = { operation: "saveLicense", entityId: entity.id, id, requestId: crypto.randomUUID(), revision: 0,
    jurisdiction: "MI", licenseType: "Fictional license", licenseNumber: "RN-01", status: "Active", effectiveOn: null,
    expiresOn: "2026-11-29", evidence: "" };
  assert.equal(f.run(initial).licenses[0].renewalOwner, null);
  const assign = { ...initial, revision: 1, requestId: crypto.randomUUID(), renewalOwner: { email: f.backup.email, accessRevision: 1 },
    renewalNote: "Confirm the renewal receipt with the office", evidence: "Fictional receipt" };
  assert.equal(f.run(assign).licenses[0].renewalOwner.name, f.backup.name);
  assert.equal(f.run(assign).licenses[0].revision, 2);
  assert.equal(f.run({ operation: "licenseRenewals" }).items[0].renewalOwner.available, true);
  const changedRoster = f.roster.map(member => member.email === f.backup.email ? { ...member, accessRevision: 3 } : member);
  assert.equal(f.run({ operation: "licenseRenewals" }, f.owner, changedRoster).items[0].renewalOwner.available, false);
  const revise = { ...assign, revision: 2, requestId: crypto.randomUUID() };
  assert.match(f.run(revise, f.owner, changedRoster).error, /current admin/);
  assert.match(f.run({ ...revise, renewalOwner: { email: f.lo.email, accessRevision: 1 } }).error, /current admin/);
  assert.equal(f.run({ ...revise, renewalOwner: undefined }, f.owner, changedRoster).licenses[0].renewalOwner.available, false);
  const historyRequest = { operation: "licenseHistory", entityId: entity.id, licenseId: id };
  const history = f.run(historyRequest);
  assert.equal(history.entries.length, 3);
  assert.equal(history.entries[0].renewalOwner, f.backup.name);
  assert.equal(history.entries[1].note, assign.renewalNote);
  assert.equal(history.entries[1].evidence, assign.evidence);
  assert.equal(history.entries[1].actor, f.owner.email);
  assert.ok(f.run(historyRequest, f.lo).error);
  assert.ok(f.run({ ...historyRequest, entityId: crypto.randomUUID() }).error);
  assert.equal(f.run({ ...revise, revision: 3, requestId: crypto.randomUUID(), renewalOwner: null }).licenses[0].renewalOwner, null);
});

test("Today counts and lists only renewals assigned to the current admin access revision", t => {
  const f = fixture(t);
  const entity = f.entity();
  const request = { operation: "saveLicense", entityId: entity.id, id: crypto.randomUUID(), requestId: crypto.randomUUID(), revision: 0,
    jurisdiction: "MI", licenseType: "Fictional company authority", licenseNumber: "TODAY-1", status: "Active",
    effectiveOn: null, expiresOn: "2026-12-05", evidence: "", renewalOwner: { email: f.owner.email, accessRevision: 1 } };
  const mine = { operation: "licenseRenewals", scope: "mine" };
  const count = actor => readActionCounts(f.db, f.staff(actor), f.tenant, new Date(now)).today;
  const beforeOwner = count(f.owner);
  const beforeBackup = count(f.backup);
  assert.equal(f.run(request).licenses[0].renewalOwner.email, f.owner.email);
  assert.equal(f.run(mine).total, 1);
  assert.equal(f.run(mine, f.backup).total, 0);
  assert.equal(count(f.owner), beforeOwner + 1);
  assert.equal(count(f.backup), beforeBackup);
  assert.ok(f.run(mine, f.lo).error);
  const updatedOwner = { ...f.owner, accessRevision: 3 };
  const roster = [updatedOwner, f.backup, f.lo];
  const stale = complianceCaseWork(f.db, { type: "program", input: mine }, f.staff(updatedOwner), f.tenant, roster, now);
  assert.equal(stale.total, 0);
  assert.equal(count(updatedOwner), beforeOwner);
  assert.ok(f.run({ ...request, revision: 1, requestId: crypto.randomUUID(), renewalOwner: { email: f.backup.email, accessRevision: 1 } }).licenses);
  assert.equal(f.run(mine).total, 0);
  assert.equal(f.run(mine, f.backup).items[0].licenseId, request.id);
  assert.equal(count(f.owner), beforeOwner);
  assert.equal(count(f.backup), beforeBackup + 1);
});

test("property-state check reports company records per entity, honors dates and excludes branch and tenant records", t => {
  const f = fixture(t);
  const primary = f.entity();
  const other = f.create({name:"Other company"}).entities.find(({id}) => id !== primary.id);
  const save = (entityId, number, fields = {}) => f.run({ operation:"saveLicense", requestId:crypto.randomUUID(),
    id:crypto.randomUUID(), entityId, revision:0, jurisdiction:"MI", licenseType:"Broker license", licenseNumber:number,
    status:"Active", effectiveOn:null, expiresOn:null, evidence:"", ...fields });
  assert.equal(save(primary.id,"THROUGH-TODAY",{expiresOn:"2026-11-11"}).kind,"programLicenses");
  assert.equal(save(primary.id,"PAST",{expiresOn:"2026-11-10"}).kind,"programLicenses");
  assert.equal(save(primary.id,"FUTURE",{effectiveOn:"2026-11-12"}).kind,"programLicenses");
  assert.equal(save(primary.id,"PENDING",{status:"Pending"}).kind,"programLicenses");
  assert.equal(save(primary.id,"OHIO",{jurisdiction:"OH"}).kind,"programLicenses");
  const branch = JSON.stringify({holder:{kind:"Branch",id:crypto.randomUUID()},label:"Fictional branch"});
  f.db.prepare("UPDATE compliance_program_licenses SET holder=? WHERE brokerageId=? AND licenseNumber='OHIO'").run(branch,f.tenant);
  f.db.prepare("UPDATE compliance_program_licenses SET holder=NULL WHERE brokerageId=? AND licenseNumber='THROUGH-TODAY'").run(f.tenant);
  const request = {operation:"licenseStateCheck",jurisdiction:"MI"};
  assert.deepEqual(f.run(request).entities, [
    {id:primary.id,name:primary.name,company:{current:1,expired:1,review:2}},
    {id:other.id,name:other.name,company:{current:0,expired:0,review:0}},
  ]);
  assert.equal(f.run({...request,jurisdiction:"OH"}).entities[0].company.current,0);
  assert.ok(f.run({...request,jurisdiction:"XX"}).error);
  assert.ok(f.run(request,f.lo).error);
  const unrelated = f.staff(f.owner,crypto.randomUUID());
  assert.deepEqual(complianceCaseWork(f.db,{type:"program",input:request},unrelated,unrelated.brokerage.id,f.roster,now).entities,[]);
  const operational = {...f.staff(),brokerage:{...f.staff().brokerage,pilot:false,features:{uwm:false,compliance:true}}};
  assert.equal(complianceCaseWork(f.db,{type:"program",input:request},operational,f.tenant,f.roster,now).entities.length,2);
  assert.ok(complianceCaseWork(f.db,{type:"program",input:request},
    {...operational,brokerage:{...operational.brokerage,features:{uwm:false,compliance:false}}},f.tenant,f.roster,now).error);
});

test("assignment license check includes the intake branch and current officer memberships with historical records distinguished", t => {
  const f = fixture(t);
  const entity = f.entity();
  const leadId = crypto.randomUUID();
  f.db.prepare(`INSERT INTO referral_leads (id,requestId,name,email,phone,purpose,officer,createdAt,dueAt,propertyState)
    VALUES (?,?,'Fictional Prospect','','','Purchase','',?,?,'MI')`).run(leadId, leadId, now, now);
  const branch = (name, staffEmails = []) => {
    const id = crypto.randomUUID();
    assert.ok(updateBranch(f.db, { type:"saveBranch", id, revision:0, name, staffEmails, ownerEmail:null },
      f.staff(), f.tenant, f.roster).message);
    return id;
  };
  const intake = branch("West Intake");
  const primary = branch("East Office",[f.lo.email]);
  const additional = branch("North Office",[f.lo.email]);
  const unrelated = branch("South Office",[f.backup.email]);
  const receipt = {profile:"General",formRevision:1,websiteRevision:1,rule:"Branch default",
    branch:{name:"West Intake",id:intake,zip:"480",revision:1},destination:"Shared inbox",note:"",campaign:null};
  f.db.prepare("INSERT INTO quote_intake_receipts (leadId,formRevision,timing,answer,routingReceipt) VALUES (?,1,'','',?)")
    .run(leadId,JSON.stringify(receipt));
  const save = (licenseNumber, holder, expiresOn = null) => f.run({ operation:"saveLicense", entityId:entity.id,
    id:crypto.randomUUID(), requestId:crypto.randomUUID(), revision:0, jurisdiction:"MI", licenseType:"Broker license",
    licenseNumber, status:"Active", effectiveOn:null, expiresOn, evidence:"", holder });
  assert.equal(save("COMPANY",{kind:"Company"}).kind,"programLicenses");
  assert.equal(save("WEST",{kind:"Branch",id:intake}).kind,"programLicenses");
  assert.equal(save("EAST",{kind:"Branch",id:primary},"2026-11-10").kind,"programLicenses");
  assert.equal(save("SOUTH",{kind:"Branch",id:unrelated}).kind,"programLicenses");
  assert.equal(save("OFFICER",{kind:"Loan officer",id:f.lo.email,accessRevision:1}).kind,"programLicenses");
  const request = {operation:"licenseStateCheck",jurisdiction:"MI",assignment:{leadId,officerEmail:f.lo.email}};
  const result = f.run(request);
  assert.deepEqual(result.assignment.branches.map(branch=>[branch.id,branch.atIntake,branch.officerAssigned]),[
    [primary,false,true],[additional,false,true],[intake,true,false],
  ]);
  assert.deepEqual(result.entities[0].branches.map(branch=>[branch.id,branch.counts]),[
    [primary,{current:0,expired:1,review:0}],[additional,{current:0,expired:0,review:0}],[intake,{current:1,expired:0,review:0}],
  ]);
  assert.equal(result.entities[0].company.current,1);
  assert.equal(result.entities[0].officer.current,1);
  const licenseIds = Object.fromEntries(f.run({operation:"licenses",entityId:entity.id}).licenses.map(record=>[record.licenseNumber,record.id]));
  assert.deepEqual(result.entities[0].singleRecords,{
    company:licenseIds.COMPANY,officer:licenseIds.OFFICER,branches:{[intake]:licenseIds.WEST,[primary]:licenseIds.EAST},
  });
  assert.equal(save("EAST-SECOND",{kind:"Branch",id:primary}).kind,"programLicenses");
  const grouped = f.run(request).entities[0];
  assert.equal(grouped.singleRecords.branches[primary],undefined);
  assert.deepEqual(grouped.branches.find(branch=>branch.id===primary).counts,{current:1,expired:1,review:0});
  const shared = f.run({...request,assignment:{leadId,officerEmail:null}});
  assert.deepEqual(shared.assignment.branches.map(branch=>branch.id),[intake]);
  assert.equal(shared.entities[0].officer,undefined);
  const unavailableOfficer = f.run({...request,assignment:{leadId,officerEmail:"missing@example.test"}});
  assert.deepEqual(unavailableOfficer.assignment.officer,{name:null});
  assert.equal(unavailableOfficer.entities[0].officer,undefined);
  assert.ok(updateBranch(f.db, {type:"setBranchActive",id:intake,revision:1,active:false}, f.staff(), f.tenant, f.roster).message);
  const reinstated = f.roster.map(member=>member.email===f.lo.email ? {...member,accessRevision:3} : member);
  const history = f.run(request,f.owner,reinstated);
  assert.deepEqual(history.assignment.branches.map(branch=>[branch.id,branch.active]),[[intake,false]]);
  assert.equal(history.entities[0].branches[0].counts.review,1);
  assert.equal(history.entities[0].officer.review,1);
  assert.ok(f.run(request,f.lo).error);
  assert.ok(f.run({...request,assignment:{...request.assignment,leadId:crypto.randomUUID()}}).error);
  f.db.prepare("UPDATE referral_leads SET resolvedAt=? WHERE id=?").run(now,leadId);
  assert.ok(f.run(request).error);
});
