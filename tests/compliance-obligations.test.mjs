import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
registerHooks({ resolve(specifier, context, next) { try { return next(specifier, context); } catch (e) {
  if (e.code !== "ERR_MODULE_NOT_FOUND" || !specifier.startsWith("./")) throw e;
  return next(`${specifier}.ts`, context);
} } });
const { initializeComplianceObligations, complianceObligationsWork } = await import("../src/lib/compliance-obligations.ts");
const { initializeComplianceProgram } = await import("../src/lib/compliance-program.ts");
const { obligationPeriod, obligationRequest } = await import("../src/lib/compliance-obligations-model.ts");
function fixture(t) {
  const sql = new DatabaseSync(":memory:"); t.after(() => sql.close());
  const db = { exec: s => sql.exec(s), prepare: s => sql.prepare(s), transaction(work) {
    sql.exec("BEGIN"); try { const result = work(); sql.exec("COMMIT"); return result; } catch(e) { sql.exec("ROLLBACK"); throw e; }
  } };
  sql.exec("PRAGMA foreign_keys=ON");initializeComplianceProgram(db);
  initializeComplianceObligations(db);
  const entityId=crypto.randomUUID(),tenant=crypto.randomUUID(),id=crypto.randomUUID();
  sql.prepare("INSERT INTO compliance_program_entities VALUES (?,?,?,?,?,?)").run(tenant,entityId,"Fictional Michigan","","Review pending","2026-11-11");
  const actor={email:"admin@example.test",role:"Admin",status:"Active",accessRevision:1};
  const staff={email:actor.email,brokerage:{id:tenant,role:"Admin",pilot:true,accessRevision:1}};
  const draft={title:"Review reporting scope",sourceUrl:"https://example.test/official",authority:"Fictional authority fixture",basis:"Fictional review basis",
    applicability:"Needs review",applicabilityReason:"Counsel scope determination pending",reviewerEvidence:"",effectiveFrom:"2024-01-01",effectiveThrough:"",
    cadence:"Monthly",internalTargetDay:31,ownerEmail:actor.email};
  const save=(changes={})=>({operation:"save",entityId,id,expectedRevision:0,requestId:crypto.randomUUID(),draft,...changes});
  const generate=(changes={})=>({operation:"generate",entityId,id,expectedRevision:1,requestId:crypto.randomUUID(),period:"2024-02",...changes});
  const run=(request,s=staff,roster=[actor])=>db.transaction(()=>complianceObligationsWork(db,request,s,roster,"2026-11-11T12:00:00Z"));
  return {sql,db,run,save,generate,draft,entityId,id,staff,actor};
}
test("UTC final-month targets clamp leap years and enforce cadence anchors",()=>{
  assert.equal(obligationPeriod("2024-02","Monthly",31).internalTarget,"2024-02-29");
  assert.equal(obligationPeriod("2025-02","Monthly",31).internalTarget,"2025-02-28");
  assert.equal(obligationPeriod("2026-04","Quarterly",31).internalTarget,"2026-06-30");
  assert.equal(obligationPeriod("2026-01","Annual",31).internalTarget,"2026-12-31");
  assert.equal(obligationPeriod("2026-02","Quarterly",31),null);
});

test("period history preserves original versions and remains entity scoped",t=>{
 const f=fixture(t);f.run(f.save());f.run(f.generate());
 f.run(f.save({expectedRevision:1,draft:{...f.draft,title:"Revised internal basis"}}));
 const query={operation:"occurrences",entityId:f.entityId,id:f.id};
 const history=f.run(query);
 assert.equal(history.items.length,1);assert.equal(history.items[0].version,1);
 assert.equal(JSON.parse(history.items[0].snapshot).draft.title,f.draft.title);
 assert.equal(f.run({...query,offset:50}).items.length,0);
 assert.ok(f.run({...query,entityId:crypto.randomUUID()}).error);
 assert.ok(f.run(query,f.staff,[]).error);
});

test("planning a period creates one owned monthly item and retains its original basis",t=>{
 const f=fixture(t);f.run(f.save());f.run(f.generate());
 f.run(f.save({expectedRevision:1,draft:{...f.draft,title:"New version title"}}));
 const request={operation:"planWork",entityId:f.entityId,id:f.id,period:"2024-02",requestId:crypto.randomUUID()};
 const first=f.run(request);assert.equal(first.kind,"obligationWorkPlanned");
 assert.deepEqual(f.run(request),first);
 assert.equal(f.run({...request,requestId:crypto.randomUUID()}).workId,first.workId);
 const items=f.sql.prepare("SELECT * FROM compliance_program_items").all();assert.equal(items.length,1);
 assert.equal(items[0].title,f.draft.title);assert.equal(items[0].status,"Planned");
 assert.match(items[0].instructions,/Applicability review gap/);assert.match(items[0].instructions,/version 1/);
 assert.equal(items[0].month,"2024-02");
 assert.ok(f.run({...request,entityId:crypto.randomUUID(),requestId:crypto.randomUUID()}).error);
});

test("planning rejects unavailable owners and rolls back monthly work on audit failure",t=>{
 const f=fixture(t);f.run(f.save());f.run(f.generate());
 const request={operation:"planWork",entityId:f.entityId,id:f.id,period:"2024-02",requestId:crypto.randomUUID()};
 const nextActor={...f.actor,accessRevision:2};
 assert.ok(f.run(request,{...f.staff,brokerage:{...f.staff.brokerage,accessRevision:2}},[nextActor]).error);
 f.sql.exec("CREATE TRIGGER fail_link BEFORE INSERT ON compliance_obligation_work BEGIN SELECT RAISE(ABORT,'link failed'); END");
 assert.throws(()=>f.run(request),/link failed/);
 assert.equal(f.sql.prepare("SELECT count(*) n FROM compliance_program_items").get().n,0);
 assert.equal(f.sql.prepare("SELECT count(*) n FROM compliance_program_events").get().n,0);
});
test("strict schema rejects legal activation claims and missing review evidence",t=>{
  const f=fixture(t);assert.ok(f.run({...f.save(),lawyerApproved:true}).error);
  assert.ok(f.run(f.save({draft:{...f.draft,applicability:"Required"}})).error);
  assert.ok(f.run(f.save({draft:{...f.draft,sourceUrl:"javascript:alert(1)"}})).error);
  assert.equal(obligationRequest.safeParse({...f.generate(),period:"2026-13"}).success,false);
});
test("tenant/entity/current active admin boundaries hold for reads and writes",t=>{
  const f=fixture(t),req=f.save();
  assert.ok(f.run(req,f.staff,[]).error);
  assert.ok(f.run(req,{...f.staff,brokerage:{...f.staff.brokerage,accessRevision:2}}).error);
  assert.ok(f.run(req,{...f.staff,brokerage:{...f.staff.brokerage,pilot:false}}).error);
  assert.ok(f.run(req,{...f.staff,brokerage:{...f.staff.brokerage,id:crypto.randomUUID()}}).error);
  assert.ok(f.run({...req,entityId:crypto.randomUUID()}).error);
  assert.ok(f.run(req,f.staff,[{...f.actor,status:"Inactive"}]).error);
});
test("idempotent replay, stale revisions and immutable occurrence basis",t=>{
  const f=fixture(t),save=f.save();assert.equal(f.run(save).revision,1);assert.equal(f.run(save).revision,1);
  assert.ok(f.run({...save,draft:{...f.draft,title:"Different retry"}}).error);
  assert.ok(f.run(f.save()).error);
  const gen=f.generate(),a=f.run(gen);assert.equal(a.occurrence.status,"Applicability review gap");
  assert.deepEqual(f.run(gen),a);
  f.run(f.save({expectedRevision:1,draft:{...f.draft,applicability:"Required",reviewerEvidence:"Internal review ticket",internalTargetDay:5}}));
  const b=f.run(f.generate({expectedRevision:2}));assert.equal(b.reused,true);
  assert.equal(b.occurrence.version,1);assert.equal(b.occurrence.internalTarget,"2024-02-29");
  assert.equal(f.sql.prepare("SELECT count(*) n FROM compliance_obligation_occurrences").get().n,1);
});
test("partial effective periods create gaps; exclusions remain explicit records",t=>{
  const f=fixture(t);f.run(f.save({draft:{...f.draft,effectiveFrom:"2024-02-10",applicability:"Not applicable",reviewerEvidence:"Internal documented rationale"}}));
  assert.equal(f.run(f.generate()).occurrence.status,"Applicability review gap");
  assert.equal(f.run(f.generate({period:"2024-03"})).occurrence.status,"Internal exclusion review recorded");
  assert.ok(f.run(f.generate({period:"2024-01"})).error);
});
test("omitted applicability defaults to a review gap, never an exemption",t=>{
  const f=fixture(t),draft={...f.draft};delete draft.applicability;
  assert.equal(f.run(f.save({draft})).revision,1);
  assert.equal(f.run(f.generate()).occurrence.status,"Applicability review gap");
});
test("owner removal or access revision change blocks generation",t=>{
  const f=fixture(t),owner={...f.actor,email:"owner@example.test"};
  f.run(f.save({draft:{...f.draft,ownerEmail:owner.email}}),f.staff,[f.actor,owner]);
  assert.match(f.run(f.generate()).error,/owner/);
  assert.match(f.run(f.generate(),f.staff,[f.actor,{...owner,accessRevision:2}]).error,/owner/);
});
test("audit insertion failure rolls back draft and occurrence writes",t=>{
  const f=fixture(t);f.sql.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON compliance_obligation_events BEGIN SELECT RAISE(ABORT,'audit unavailable'); END");
  assert.throws(()=>f.run(f.save()),/audit unavailable/);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM compliance_obligation_versions").get().n,0);
  f.sql.exec("DROP TRIGGER fail_audit");f.run(f.save());
  f.sql.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON compliance_obligation_events BEGIN SELECT RAISE(ABORT,'audit unavailable'); END");
  assert.throws(()=>f.run(f.generate()),/audit unavailable/);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM compliance_obligation_occurrences").get().n,0);
});
test("bounded paged reads and reinitialization preserve version history",t=>{
  const f=fixture(t);for(let i=0;i<52;i++)f.run(f.save({id:crypto.randomUUID()}));
  initializeComplianceObligations(f.db);
  const first=f.run({operation:"list",entityId:f.entityId});assert.equal(first.items.length,50);assert.equal(first.more,true);
  assert.equal(f.run({operation:"list",entityId:f.entityId,offset:50}).items.length,2);
});
