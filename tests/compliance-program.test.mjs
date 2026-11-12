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
 for(const name of ["compliance_obligation_versions","compliance_obligation_occurrences","compliance_obligation_events","compliance_obligation_work",
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
