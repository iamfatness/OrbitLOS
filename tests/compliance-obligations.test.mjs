import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
registerHooks({ resolve(specifier, context, next) { try { return next(specifier, context); } catch (e) {
  if (e.code !== "ERR_MODULE_NOT_FOUND" || !specifier.startsWith("./")) throw e;
  return next(`${specifier}.ts`, context);
} } });
const { initializeComplianceObligations, complianceObligationsWork } = await import("../src/lib/compliance-obligations.ts");
const { initializeStore } = await import("../src/lib/store.ts");
const { complianceCaseWork } = await import("../src/lib/compliance-cases.ts");
const { obligationPeriod, obligationRequest } = await import("../src/lib/compliance-obligations-model.ts");
function fixture(t) {
  const sql = new DatabaseSync(":memory:"); t.after(() => sql.close());
  const db = { exec: s => sql.exec(s), prepare: s => sql.prepare(s), transaction(work) {
    sql.exec("BEGIN"); try { const result = work(); sql.exec("COMMIT"); return result; } catch(e) { sql.exec("ROLLBACK"); throw e; }
  } };
  sql.exec("PRAGMA foreign_keys=ON");
  initializeStore(db, false);
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
 const program = input => complianceCaseWork(db,{type:"program",input},staff,tenant,[actor],"2026-11-11T12:00:00Z");
 const progress = month => program({operation:"month",entityId,month}).items[0].filingProgress;
 return {sql,db,run,save,generate,draft,entityId,id,staff,actor,program,progress};
}
test("UTC final-month targets clamp leap years and enforce cadence anchors",()=>{
  assert.equal(obligationPeriod("2024-02","Monthly",31).internalTarget,"2024-02-29");
  assert.equal(obligationPeriod("2025-02","Monthly",31).internalTarget,"2025-02-28");
  assert.equal(obligationPeriod("2026-04","Quarterly",31).internalTarget,"2026-06-30");
  assert.equal(obligationPeriod("2026-01","Annual",31).internalTarget,"2026-12-31");
  assert.equal(obligationPeriod("2026-02","Quarterly",31),null);
  assert.deepEqual(obligationPeriod("2025-11","Fiscal quarterly",31,2),{
    from:"2025-11-01",through:"2026-01-31",internalTarget:"2026-01-31",
  });
  assert.equal(obligationPeriod("2026-01","Fiscal quarterly",31,2),null);
});

test("obligation owner options include only active brokerage admins", t => {
  const f=fixture(t);
  const roster=[{...f.actor,name:"Fictional Owner"},
    {email:"next@example.test",name:"Second Admin",role:"Admin",status:"Active"},
    {email:"invited@example.test",name:"Invited Admin",role:"Admin",status:"Invited"},
    {email:"officer@example.test",name:"Loan Officer",role:"LO",status:"Active"}];
  assert.deepEqual(f.run({operation:"list",entityId:f.entityId},f.staff,roster).owners,[
    {email:f.actor.email,name:"Fictional Owner"},{email:"next@example.test",name:"Second Admin"},
  ]);
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

test("HMDA annual and quarterly evidence stays with the reporting entity and exact period", t => {
 const f = fixture(t);
 const sources = f.run({operation:"stateSources",entityId:f.entityId}).items;
 assert.deepEqual(sources.map(item=>item.sourceKey),["FED-HMDA-ANNUAL","FED-HMDA-QUARTERLY"]);
 for (const [cadence, key, dueOn] of [["Annual","ANNUAL","2026-03-02"],["Quarterly","QUARTERLY","2025-05-30"]]) {
  const id = crypto.randomUUID(), period = "2025-01";
  const draft = {...f.draft,cadence,applicability:"Required",reviewerEvidence:"Fictional internal HMDA review"};
  const stateReference = {jurisdiction:"US",revision:1,sourceKey:"FED-HMDA-"+key};
  assert.equal(f.run(f.save({id,draft,stateReference})).revision,1);
  if (cadence === "Quarterly") assert.match(f.run(f.generate({id,period:"2025-10"})).error,/fourth-quarter/);
  const occurrence = f.run(f.generate({id,period})).occurrence;
  assert.equal(JSON.parse(occurrence.snapshot).reportingBasis.nominalDueOn,dueOn);
  const target = {entityId:f.entityId,id,period};
  const planned = f.run({operation:"planWork",...target,requestId:crypto.randomUUID()});
  const monthly = () => f.program({operation:"month",entityId:f.entityId,month:planned.month}).items.find(item=>item.id===planned.workId);
  assert.equal(monthly().obligation.hmdaFiling,true);
  assert.equal(monthly().filingProgress.summary,"Filing evidence needed");
  const history = {operation:"michiganFilingHistory",...target};
  assert.equal(f.run(history).nominalDueOn,dueOn);
  const evidence = {deadline:{on:dueOn,reference:"Fictional filing instructions"},reconciliation:{reference:"Fictional LAR reconciliation"},
   submission:{on:dueOn,reference:"Fictional original confirmation"}};
  const save = {operation:"saveMichiganFiling",...target,requestId:crypto.randomUUID(),expected:0,evidence};
  assert.equal(f.run(save).version,1);
  assert.equal(f.run(save).version,1);
  assert.deepEqual(monthly().filingProgress.gaps,[]);
  const amendments = [{on:"2026-06-01",reference:"Fictional amended confirmation",reason:"Fictional corrected record"}];
  assert.equal(f.run({...save,expected:1,requestId:crypto.randomUUID(),correction:"Fictional amended record",evidence:{...evidence,amendments}}).version,2);
  assert.equal(f.run(history).versions[1].evidence.submission.reference,evidence.submission.reference);
  const update = (expectedRevision,status,internalTarget) => f.program({operation:"update",entityId:f.entityId,
   month:planned.month,id:planned.workId,requestId:crypto.randomUUID(),expectedRevision,status,internalTarget,
   ownerEmail:f.actor.email,evidence:"Fictional filing confirmation",note:"Fictional work target review"});
  const lateTarget = dueOn.slice(0,-2) + (key === "ANNUAL" ? "04" : "31");
  assert.equal(update(1,"Awaiting review",lateTarget).kind,"programMonth");
  assert.equal(update(2,"Completed",lateTarget).kind,"programMonth");
  assert.equal(monthly().status,"Completed");
  assert.equal(monthly().filingProgress.reviewedDueOn,dueOn);
  assert.deepEqual(monthly().filingProgress.gaps,["The internal target falls after the reviewed filing deadline."]);
  assert.equal(f.program({operation:"ownerHome"}).reviews.items.find(item=>item.id===planned.workId)?.status,"Completed");
  assert.equal(update(3,"Completed",dueOn).kind,"programMonth");
  assert.equal(monthly().status,"Completed");
  assert.deepEqual(monthly().filingProgress.gaps,[]);
  assert.ok(!f.program({operation:"ownerHome"}).reviews.items.some(item=>item.id===planned.workId));
  assert.ok(f.run({...history,entityId:crypto.randomUUID()}).error);
 }
 f.sql.prepare("UPDATE compliance_program_entities SET name=? WHERE id=?").run("Fictional changed reporting institution",f.entityId);
 assert.ok(f.run({operation:"list",entityId:f.entityId}).items.every(item=>item.stateBasisChanged));
});

test("monthly filing gaps include state reports with manual evidence", t => {
 const f = fixture(t);
 const jurisdiction = "CA";
 const scope = complianceCaseWork(f.db,{type:"stateScope",input:{operation:"save",entityId:f.entityId,
  jurisdiction,expectedRevision:0,requestId:crypto.randomUUID(),facts:{activity:"Brokerage",lienScope:"First lien",
   companyEvidence:"Fictional CFL authority",officeEvidence:"",originatorEvidence:"",products:"",responsibility:"",
   reportingBasis:"",counselPacketReference:""}}},f.staff,f.staff.brokerage.id,[f.actor],"2026-11-11T12:00:00Z");
 assert.equal(scope.revision,1);
 const draft = {...f.draft,cadence:"Annual",applicability:"Required",reviewerEvidence:"Fictional applicability review"};
 const stateReference = {jurisdiction,sourceKey:"REQ-CA-REPORTING-CFLANNUAL",revision:1};
 assert.equal(f.run(f.save({draft,stateReference})).revision,1);
 const target = {entityId:f.entityId,id:f.id,period:"2025-01"};
 assert.equal(f.run(f.generate({period:target.period})).kind,"obligationOccurrence");
 const planned = f.run({operation:"planWork",...target,requestId:crypto.randomUUID()});
 const month = {entityId:f.entityId,month:planned.month};
 const before = f.program({operation:"month",...month});
 assert.match(before.items[0].filingProgress.gaps.join(" "),/Record the filing evidence reference/);
 const reviewed = f.program({operation:"reviewMonth",...month,requestId:crypto.randomUUID(),fingerprint:before.fingerprint,note:"Fictional missing filing evidence"});
 const after = f.program({operation:"update",...month,id:planned.workId,requestId:crypto.randomUUID(),
  expectedRevision:1,status:"Awaiting review",ownerEmail:f.actor.email,internalTarget:"2026-03-20",
  evidence:"Fictional DFPI receipt reference",note:"Fictional submission received"});
 assert.equal(after.items[0].filingProgress.summary,"Filing reference recorded");
 assert.deepEqual(after.items[0].filingProgress.gaps,["The internal target falls after the nominal filing date."]);
 assert.equal(after.reviews[0].current,false);
 assert.equal(after.reviews[0].snapshot,reviewed.reviews[0].snapshot);
 const resolved = f.program({operation:"update",...month,id:planned.workId,requestId:crypto.randomUUID(),
  expectedRevision:2,status:"Completed",ownerEmail:f.actor.email,internalTarget:"2026-03-15",
  evidence:"Fictional DFPI receipt reference",note:"Fictional evidence reviewed"});
 assert.deepEqual(resolved.items[0].filingProgress.gaps,[]);
});

test("monthly filing work follows current decisions for the exact state report period", t => {
 const f = fixture(t);
 const facts = {activity:"Brokerage",lienScope:"First lien",companyEvidence:"Fictional authority",officeEvidence:"",
  originatorEvidence:"",products:"",responsibility:"",reportingBasis:"",counselPacketReference:""};
 const saveScope = (expectedRevision, scopeFacts) => complianceCaseWork(f.db,{type:"stateScope",input:{operation:"save",
  entityId:f.entityId,jurisdiction:"CA",expectedRevision,requestId:crypto.randomUUID(),facts:scopeFacts}},
  f.staff,f.staff.brokerage.id,[f.actor],"2026-11-11T12:00:00Z");
 assert.equal(saveScope(0,facts).revision,1);
 const draft = {...f.draft,cadence:"Annual"};
 const stateReference = {jurisdiction:"CA",sourceKey:"REQ-CA-REPORTING-CFLANNUAL",revision:1};
 assert.equal(f.run(f.save({draft,stateReference})).revision,1);
 const target = {entityId:f.entityId,id:f.id,period:"2025-01"};
 const generated = f.run(f.generate({period:target.period})).occurrence.snapshot;
 const planned = f.run({operation:"planWork",...target,requestId:crypto.randomUUID()});
 const month = {entityId:f.entityId,month:planned.month};
 const monthly = () => f.program({operation:"month",...month});
 const gaps = () => monthly().items[0].filingProgress.gaps.join(" ");
 const applicabilityGap = /Confirm whether this report applies/;
 assert.match(gaps(),applicabilityGap);
 const confirmed = {...draft,applicability:"Required",reviewerEvidence:"Fictional reviewed scope"};
 assert.equal(f.run(f.save({expectedRevision:1,draft:{...confirmed,effectiveFrom:"2025-07-01"}})).revision,2);
 assert.match(gaps(),applicabilityGap);
 assert.equal(f.run(f.save({expectedRevision:2,draft:confirmed})).revision,3);
 assert.doesNotMatch(gaps(),applicabilityGap);
 assert.match(gaps(),/Record the filing evidence reference/);
 assert.equal(monthly().items[0].obligation.applicabilityReview.decision,"Required");
 const excluded = {...confirmed,applicability:"Not applicable",reviewerEvidence:"Fictional exclusion reference"};
 assert.equal(f.run(f.save({expectedRevision:3,draft:excluded})).revision,4);
 const current = monthly();
 assert.deepEqual(current.items[0].filingProgress,{revision:null,summary:"Internal exclusion recorded",gaps:[]});
 const home = f.program({operation:"ownerHome"});
 assert.equal(home.reviews.items.find(item=>item.id===planned.workId).filing.summary,"Internal exclusion recorded");
 const recorded = f.program({operation:"reviewMonth",...month,requestId:crypto.randomUUID(),
  fingerprint:current.fingerprint,note:"Fictional exclusion reviewed"});
 assert.equal(recorded.reviews[0].current,true);
 assert.equal(f.run(f.save({expectedRevision:4,draft})).revision,5);
 assert.match(gaps(),applicabilityGap);
 assert.equal(monthly().reviews[0].current,false);
 assert.equal(JSON.parse(monthly().reviews[0].snapshot).items[0].obligation.applicabilityReview.decision,"Not applicable");
 assert.equal(f.run(f.save({expectedRevision:5,draft:excluded})).revision,6);
 assert.equal(gaps(),"");
 assert.equal(saveScope(1,{...facts,companyEvidence:"Fictional updated authority"}).revision,2);
 assert.match(gaps(),/Verify the filing evidence against the current scope and source/);
 assert.equal(f.run(f.save({expectedRevision:6,draft:excluded,stateReference:{...stateReference,revision:2}})).revision,7);
 assert.equal(gaps(),"");
 assert.equal(f.run(f.generate({period:target.period,expectedRevision:7})).occurrence.snapshot,generated);
});

test("priority-state FV7 filing evidence respects the source, period, cadence and review status", t => {
 const f = fixture(t);
 const saveScope = (jurisdiction, activity, expectedRevision = 0) => complianceCaseWork(f.db, {type:"stateScope",input:{
  operation:"save", entityId:f.entityId, jurisdiction, expectedRevision, requestId:crypto.randomUUID(),
  facts:{activity,lienScope:"First lien",companyEvidence:"Fictional company license",officeEvidence:"",originatorEvidence:"",
   products:"",responsibility:"",reportingBasis:"",counselPacketReference:""}}},
  f.staff,f.staff.brokerage.id,[f.actor],"2026-11-11T12:00:00Z");
 for (const jurisdiction of ["CA","FL","TX","NY","CO","IL"]) assert.equal(saveScope(jurisdiction,"Brokerage").revision,1);
 const record = (jurisdiction, suffix, cadence = "Quarterly", period = "2026-04", annualStartMonth) => {
  const id = crypto.randomUUID();
  assert.equal(f.run(f.save({id, draft:{...f.draft,cadence,annualStartMonth},
   stateReference:{jurisdiction,revision:1,sourceKey:`REQ-${jurisdiction}-REPORTING-${suffix}`}})).revision,1);
  assert.equal(f.run(f.generate({id,period})).kind,"obligationOccurrence");
  return {entityId:f.entityId,id,period};
 };
 const history = target => f.run({operation:"michiganFilingHistory",...target});
 const save = (target,evidence) => f.run({operation:"saveMichiganFiling",...target,expected:0,requestId:crypto.randomUUID(),evidence});
 const cases = [
  ["CA","DRE-MCR"],["CA","CFL-MCR"],["CA","CRMLA-MCR"],["FL","MCR"],["TX","MCR"],
  ["NY","MCR"],["CO","MCR"],["IL","ACTIVITY"],
 ];
 const lateReceipt = {on:"2026-08-15",reference:"Fictional original NMLS receipt"};
 for (const [jurisdiction,suffix] of cases) {
  const target = record(jurisdiction,suffix);
  assert.equal(history(target).component,"Residential Mortgage Loan Activity");
  assert.equal(history(target).versions.length,0);
  const planned = f.run({operation:"planWork",...target,requestId:crypto.randomUUID()});
  const progress = () => f.program({operation:"month",entityId:f.entityId,month:planned.month}).items.find(item=>item.id===planned.workId).filingProgress;
  assert.ok(progress().gaps.includes("The nominal date passed without recorded evidence."));
  const saved = save(target,{deadline:{on:"2026-08-14",reference:"Fictional reviewed deadline"},submission:lateReceipt,
   reconciliation:{activity:"No reportable activity",reference:"Fictional period reconciliation"}});
  assert.equal(saved.version,1);
  assert.deepEqual(progress().gaps,["Review the late submission."]);
 }
 for (const [jurisdiction,suffix,start] of [["CA","DRE-FC"],["CA","CFL-FC"],["FL","BROKER-FC"],["TX","FC"]]) {
  const target = record(jurisdiction,suffix,"Annual","2026-01",start);
  assert.equal(history(target).component,"Financial Condition");
  assert.equal(history(target).nominalDueOn,"2027-03-31");
  assert.deepEqual(history(target).versions,[]);
 }
 for (const [jurisdiction,suffix] of [["CA","DRE-FC"],["CA","CFL-FC"],["CA","CRMLA-FC"],["FL","LENDER-FC"],["TX","FC"],["CO","QUARTER-FC"]])
  assert.equal(history(record(jurisdiction,suffix)).component,"Financial Condition");
 const coloradoFiscal = record("CO","STD-FC","Annual","2026-07",7);
 assert.equal(history(coloradoFiscal).component,"Financial Condition");
 assert.equal(history(coloradoFiscal).nominalDueOn,null);
 const supplement = record("TX","SSSF");
 assert.equal(history(supplement).component,"State-Specific Supplemental Form");
 assert.match(save(supplement,{reconciliation:{activity:"No reportable activity",reference:"Fictional period reconciliation"}}).error,/activity determination/);
 assert.equal(save(supplement,{submission:lateReceipt}).version,1);
 assert.ok(history(record("NY","MCR","Quarterly","2025-10")).error);
 assert.ok(history(record("TX","MCR","Annual","2026-01")).error);
 assert.ok(history(record("NY","VOOR","Annual","2026-01")).error);
 assert.equal(saveScope("TX","Brokerage and servicing",1).revision,2);
 const month = f.program({operation:"month",entityId:f.entityId,month:"2026-06"});
 const texas = month.items.find(item => item.instructions.includes("REQ-TX-REPORTING-MCR"));
 assert.ok(texas.filingProgress.gaps.includes("Verify the filing evidence against the current scope and source."));
 assert.equal(texas.filingProgress.summary,"Filing timing needs review");
 assert.equal(texas.obligation.reportingBasis.nominalDueOn,null);
 assert.ok(!texas.filingProgress.gaps.includes("Review the late submission."));
 const prior = history({entityId:f.entityId,id:texas.obligation.obligationId,period:"2026-04"});
 assert.equal(prior.currentFinding.dueOn,null);
 assert.equal(prior.versions[0].finding.summary,"Receipt after recorded date");
 assert.equal(prior.versions[0].evidence.deadline.on,"2026-08-14");
 const occurrence=f.run({operation:"occurrences",entityId:f.entityId,id:texas.obligation.obligationId}).items[0];
 assert.equal(occurrence.priorFilingBasis,true);
 assert.equal(occurrence.reportingBasis.nominalDueOn,"2026-08-14");
 const target = {entityId:f.entityId,id:texas.obligation.obligationId,period:"2026-04"};
 const updated = {...target,operation:"saveMichiganFiling",expected:1,requestId:crypto.randomUUID(),
   reviewedScopeRevision:2,correction:"Fictional checked instructions",evidence:{...prior.versions[0].evidence,
     deadline:{on:"2026-11-10",reference:"Fictional updated deadline reference"}}};
 assert.equal(prior.reviewableScopeRevision,2);
 assert.ok(f.run({...updated,reviewedScopeRevision:1}).error);
 assert.ok(f.run({...updated,correction:undefined}).error);
 assert.equal(f.run(updated).version,2);
 assert.equal(history(target).scopeChanged,false);
 assert.deepEqual(history(target).versions[1],prior.versions[0]);
 const current = () => f.program({operation:"month",entityId:f.entityId,month:"2026-06"}).items.find(item=>item.id===texas.id).filingProgress;
 assert.equal(current().reviewedDueOn,"2026-11-10");
 assert.deepEqual(current().gaps,[]);
 assert.equal(f.run({...updated,expected:2,requestId:crypto.randomUUID(),reviewedScopeRevision:undefined,
   evidence:{...updated.evidence,deadline:{...updated.evidence.deadline,on:"2026-11-11"}}}).version,3);
 assert.equal(current().summary,"Filing timing needs review");


});




test("Illinois audit evidence preserves the original deadline and regulator decision history",t=>{
 const f=fixture(t);
 const scope=complianceCaseWork(f.db,{type:"stateScope",input:{operation:"save",entityId:f.entityId,jurisdiction:"IL",expectedRevision:0,
   requestId:crypto.randomUUID(),facts:{activity:"Brokerage",lienScope:"First lien",companyEvidence:"Fictional Illinois license",
     officeEvidence:"",originatorEvidence:"",products:"",responsibility:"",reportingBasis:"",counselPacketReference:""}}},
   f.staff,f.staff.brokerage.id,[f.actor],"2026-11-11T12:00:00Z");
 assert.equal(scope.revision,1);
 const sourceKey="REQ-IL-REPORTING-ANNUAL-AUDIT";
 const draft={...f.draft,cadence:"Annual",annualStartMonth:1,applicability:"Required",reviewerEvidence:"Fictional audit review"};
 assert.equal(f.run(f.save({draft,stateReference:{jurisdiction:"IL",revision:1,sourceKey}})).revision,1);
 const period="2025-01";
 const original=f.run(f.generate({period})).occurrence;
 const target={entityId:f.entityId,id:f.id,period};
 const history={operation:"illinoisAuditHistory",...target};
 const listed=()=>f.run({operation:"occurrences",entityId:f.entityId,id:f.id}).items[0];
 assert.equal(listed().illinoisAudit,true);
 assert.equal(listed().audit,undefined);
 const save=(evidence,expected=0,changes={})=>({operation:"saveIllinoisAudit",...target,requestId:crypto.randomUUID(),expected,evidence,...changes});
 assert.equal(f.run(history).nominalDueOn,"2026-03-31");
 const evidence={originalDeadline:{on:"2026-03-31",reference:"Reviewed fiscal deadline"},
   extension:{request:{on:"2026-03-16",reference:"Dated written request receipt"},grounds:"Fictional circumstances beyond control"}};
 const initial=save(evidence);
 const first=f.run(initial);
 const work = f.run({operation:"planWork",...target,requestId:crypto.randomUUID()});
 assert.equal(f.progress(work.month).summary,"Past due");
 assert.ok(f.progress(work.month).gaps.includes("Verify the extension decision. The original deadline still applies."));
 assert.deepEqual(first.finding,{asOf:"2026-11-11",requestDueOn:"2026-03-16",dueOn:"2026-03-31",requestStatus:"On time",
   filingStatus:"Past due",extensionStatus:"Pending decision"});
 assert.deepEqual(f.run(initial),first);
 assert.deepEqual(listed().audit,{dueOn:"2026-03-31",extensionStatus:"Pending decision",filingStatus:"Past due"});
 assert.equal(listed().auditEvidence,undefined);
 assert.ok(f.run({...history,entityId:crypto.randomUUID()}).error);
 assert.ok(f.run(history,f.staff,[]).error);
 const filing={on:"2026-04-30",reference:"IDFPR filing receipt"};
 const denial={...evidence,filing,extension:{...evidence.extension,decision:{result:"Denied",on:"2026-03-25",reference:"Written denial"}}};
 assert.match(f.run(save(denial,1)).error,/reason/);
 assert.equal(f.run(save(denial,1,{correction:"Record regulator denial"})).finding.filingStatus,"Filed late");
 const grant={...denial,extension:{...evidence.extension,request:{...evidence.extension.request,on:"2026-03-17"},
   decision:{result:"Granted",on:"2026-03-25",dueOn:"2026-04-30",reference:"Corrected written regulator decision"}}};
 const corrected=save(grant,2,{correction:"Correct request date and regulator decision"});
 assert.equal(f.run(corrected).finding.filingStatus,"Filed on time");
 assert.deepEqual(listed().audit,{dueOn:"2026-04-30",extensionStatus:"Granted",filingStatus:"Filed on time"});
 assert.match(f.run(save(grant,2,{correction:"Conflicting correction"})).error,/changed/);
 const versions=f.run(history).versions;
 assert.deepEqual(versions.map(item=>item.finding.extensionStatus),["Granted","Denied","Pending decision"]);
 assert.equal(versions[0].finding.requestStatus,"Late");
 assert.equal(versions[0].finding.dueOn,"2026-04-30");
 assert.deepEqual(f.run({...history,before:3}).versions.map(item=>item.version),[2,1]);
 assert.equal(f.run(f.generate({period})).occurrence.snapshot,original.snapshot);
});

test("linked reporting work retains the saved Michigan scope and flags a later version",t=>{
  const f=fixture(t);
  const now="2026-11-12T12:00:00Z", jurisdiction="MI";
  const stateSources={operation:"stateSources",entityId:f.entityId};
  assert.deepEqual(f.run(stateSources).items.filter(item => item.jurisdiction !== "US"),[]);
  const saveScope=expectedRevision=>complianceCaseWork(f.db,{type:"stateScope",input:{operation:"save",entityId:f.entityId,jurisdiction,
    expectedRevision,requestId:crypto.randomUUID(),facts:{activity:"Brokerage",lienScope:"First lien",companyEvidence:"Fictional license",
      officeEvidence:"",originatorEvidence:"",products:"",responsibility:"",reportingBasis:"",counselPacketReference:""}}},
    f.staff,f.staff.brokerage.id,[f.actor],now);
  const license = { operation: "saveLicense", id: crypto.randomUUID(), requestId: crypto.randomUUID(), entityId: f.entityId,
    revision: 0, jurisdiction, licenseType: "Fictional broker authority", licenseNumber: "FICTIONAL-001",
    status: "Active", effectiveOn: null, expiresOn: null, evidence: "Fictional register evidence" };
  const saveLicense = input => complianceCaseWork(f.db, { type: "program", input }, f.staff, f.staff.brokerage.id, [f.actor], now);
  assert.equal(saveLicense(license).kind, "programLicenses");
  assert.equal(saveScope(0).revision,1);
  const sources=f.run(stateSources).items;
  const source=sources.find(item=>item.sourceKey==="REQ-MI-REPORTING-RMLA");
  const reference={jurisdiction,revision:1,sourceKey:source.sourceKey};
  assert.ok(sources.every(item=>item.jurisdiction===jurisdiction || item.jurisdiction==="US"));
  assert.ok(f.run(f.save({stateReference:{...reference,jurisdiction:"OH"}})).error);
  assert.ok(f.run(f.save({stateReference:{...reference,sourceKey:"REQ-MI-LICENSING-FIRST"}})).error);
  const save=f.save({stateReference:reference,draft:{...f.draft,cadence:"Quarterly",applicability:"Required",reviewerEvidence:"Fictional internal review"}});
  assert.equal(f.run(save).revision,1);
  const list={operation:"list",entityId:f.entityId};
  const first=f.run(list).items[0];
  assert.equal(first.draft.sourceUrl,source.sourceUrl);
  assert.equal(first.draft.authority,source.authority);
  assert.equal(first.stateBasisChanged,false);
  const firstQuarter=f.generate({period:"2024-01"});
  const occurrence=f.run(firstQuarter).occurrence;
  assert.equal(occurrence.status,"Internal preparation planned");
  const snapshot=JSON.parse(occurrence.snapshot);
  assert.equal(snapshot.stateBasis.revision,1);
  assert.equal(snapshot.reportingBasis.nominalDueOn,"2024-05-15");
  assert.equal(JSON.parse(snapshot.stateBasis.snapshot).key,source.sourceKey);
  assert.equal(saveLicense({ ...license, revision: 1, requestId: crypto.randomUUID(), status: "Expired" }).kind, "programLicenses");
  assert.deepEqual(f.run(stateSources).items.filter(item => item.jurisdiction !== "US"), []);
  assert.equal(f.run(list).items[0].stateBasisChanged, true);
  const licenseGap = f.run(f.generate({ period: "2024-04" })).occurrence;
  assert.equal(licenseGap.status, "Applicability review gap");
  assert.equal(JSON.parse(licenseGap.snapshot).stateBasisChanged, true);
  assert.equal(saveScope(1).revision,2);
  assert.equal(f.run(list).items[0].stateBasisChanged,true);
  assert.equal(f.run(save).revision,1);
  assert.ok(f.run(f.save({expectedRevision:1,stateReference:reference})).error);
  const gap=f.run(f.generate({period:"2024-04"})).occurrence;
  assert.equal(gap.status,"Applicability review gap");
  assert.equal(JSON.parse(gap.snapshot).stateBasisChanged,true);
  assert.equal(f.run(firstQuarter).occurrence.snapshot,occurrence.snapshot);
  const planned=f.run({operation:"planWork",entityId:f.entityId,id:f.id,period:"2024-04",requestId:crypto.randomUUID()});
  assert.equal(planned.kind,"obligationWorkPlanned");
  assert.match(f.sql.prepare("SELECT instructions FROM compliance_program_items").get().instructions,/State scope version 1, REQ-MI-REPORTING-RMLA/);
  assert.equal(f.run(f.save({expectedRevision:1,stateReference:{...reference,revision:2}})).revision,2);
  assert.equal(f.run(list).items[0].stateBasisChanged,false);
  assert.equal(f.run(list).items[0].stateBasis.revision,2);
  const scopeRow = f.sql.prepare("SELECT sourceSnapshots FROM compliance_state_scope_versions WHERE revision=2").get();
  const outdatedSources = JSON.parse(scopeRow.sourceSnapshots).filter(saved => JSON.parse(saved).key !== source.sourceKey);
  f.sql.prepare("UPDATE compliance_state_scope_versions SET sourceSnapshots=? WHERE revision=2").run(JSON.stringify(outdatedSources));
  assert.equal(f.run(stateSources).items.some(item => item.sourceKey === source.sourceKey), false);
  assert.equal(f.run(list).items[0].stateBasisChanged, true);
  const history = f.run({ operation: "occurrences", entityId: f.entityId, id: f.id });
  assert.equal(history.items.find(item => item.period === "2024-01").stateBasis.revision, 1);
  assert.equal(history.items.find(item => item.period === "2024-04").stateBasisChanged, true);
});

test("a catalog-only refresh keeps counsel decisions and planned work for an unchanged source", t => {
  const f = fixture(t);
  const { entityId, id } = f;
  const jurisdiction = "FL", now = "2026-11-12T12:00:00Z";
  const facts = { activity: "Brokerage", lienScope: "First lien", companyEvidence: "Fictional license",
    officeEvidence: "", originatorEvidence: "", products: "Purchase", responsibility: "", reportingBasis: "", counselPacketReference: "" };
  const work = (type, input) => complianceCaseWork(f.db, { type, input: { ...input, entityId, jurisdiction } },
    f.staff, f.staff.brokerage.id, [f.actor], now);
  const save = (expectedRevision, scopeFacts = facts) =>
    ({ operation: "save", expectedRevision, requestId: crypto.randomUUID(), facts: scopeFacts });
  const original = work("stateScope", save(0));
  const sourceKey = "REQ-FL-REPORTING-MCR";
  const added = "REQ-FL-LICENSING-MLO-RENEW";
  const decision = { counsel: "Counsel advised applicable", counselEvidence: "Fictional counsel decision",
    control: "Control tested internally", controlEvidence: "Fictional test evidence", nextAction: "Review prior release" };
  assert.equal(work("stateReadiness", { operation: "save", scopeRevision: 1, sourceKey, expectedRevision: 0,
    requestId: crypto.randomUUID(), facts: decision }).kind, "stateReadinessSaved");
  const oldSources = JSON.parse(original.savedBasis.sources).filter(snapshot => JSON.parse(snapshot).key !== added);
  f.sql.prepare("UPDATE compliance_state_scope_versions SET sourceSnapshots=?,sourceHash='older-catalog' WHERE entityId=?")
    .run(JSON.stringify(oldSources), entityId);
  const list = { operation: "list", entityId }, sources = { operation: "stateSources", entityId };
  assert.ok(!f.run(sources).items.some(source => source.sourceKey === added));
  assert.equal(f.run(f.save({ stateReference: { jurisdiction, revision: 1, sourceKey },
    draft: { ...f.draft, cadence: "Quarterly", applicability: "Required", reviewerEvidence: "Fictional evidence" } })).kind, "obligationSaved");
  const period = "2026-01";
  const originalPeriod = f.run(f.generate({ period })).occurrence;
  const plan = { operation: "planWork", entityId, id, period, requestId: crypto.randomUUID() };
  const originalWork = f.run(plan);
  assert.equal(originalWork.kind, "obligationWorkPlanned");
  const refresh = save(1);
  assert.equal(work("stateScope", refresh).revision, 2);
  assert.equal(work("stateScope", refresh).revision, 2);
  const reviews = revision => new Map(work("stateReadiness", { operation: "read", scopeRevision: revision })
    .items.map(item => [item.key, item.recorded]));
  assert.deepEqual(reviews(2).get(sourceKey).facts, { ...decision, control: "Open", controlEvidence: "", nextAction: "" });
  assert.equal(reviews(2).get(sourceKey).carriedFromScope, 1);
  assert.equal(reviews(2).get(sourceKey).carriedFromRevision, 1);
  assert.equal(reviews(2).get(added), null);
  assert.deepEqual(reviews(1).get(sourceKey).facts, decision);
  assert.ok(f.run(sources).items.some(source => source.sourceKey === added));
  assert.equal(f.run(list).items[0].stateBasisChanged, false);
  assert.equal(f.run(f.generate({ period })).occurrence.snapshot, originalPeriod.snapshot);
  assert.equal(f.run({ ...plan, requestId: crypto.randomUUID() }).workId, originalWork.workId);
  assert.equal(JSON.parse(f.run(f.generate({ period: "2026-04" })).occurrence.snapshot).stateBasisChanged, false);
  assert.equal(work("stateScope", save(2, { ...facts, products: "Refinance" })).revision, 3);
  assert.equal(reviews(3).get(sourceKey), null);
  assert.equal(f.run(list).items[0].stateBasisChanged, true);
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

test("California reporting links DRE, CFL and CRMLA obligations with distinct filing calendars",t=>{
 const f=fixture(t);
 const now="2026-11-12T12:00:00Z",jurisdiction="CA";
 const scope=complianceCaseWork(f.db,{type:"stateScope",input:{operation:"save",entityId:f.entityId,jurisdiction,
  expectedRevision:0,requestId:crypto.randomUUID(),facts:{activity:"Brokerage",lienScope:"First lien",companyEvidence:"Fictional license",
   officeEvidence:"",originatorEvidence:"",products:"",responsibility:"",reportingBasis:"",counselPacketReference:""}}},
  f.staff,f.staff.brokerage.id,[f.actor],now);
 assert.equal(scope.revision,1);
 const sources=f.run({operation:"stateSources",entityId:f.entityId}).items;
 const save=(suffix,draft,area="REPORTING")=>{
  const id=crypto.randomUUID();
  const sourceKey=`REQ-CA-${area}-${suffix}`;
  assert(sources.some(item=>item.sourceKey===sourceKey));
  const saved=f.run(f.save({id,stateReference:{jurisdiction,revision:1,sourceKey},draft:{...f.draft,...draft}}));
  assert.equal(saved.revision,1);
  return id;
 };
 const generate=(id,period)=>f.run(f.generate({id,period}));
 const call=save("DRE-MCR",{cadence:"Quarterly"});
 const filingDate = (id,period) => JSON.parse(generate(id,period).occurrence.snapshot).reportingBasis.nominalDueOn;
 for (const authority of ["DRE-FC","CFL-FC"]) {
  const annualFc = save(authority,{cadence:"Annual",annualStartMonth:1});
  assert.equal(filingDate(annualFc,"2026-01"),"2027-03-31");
  assert.equal(filingDate(annualFc,"2025-01"),null);
  assert.equal(filingDate(save(authority,{cadence:"Quarterly"}),"2026-04"),null);
 }
 assert.equal(filingDate(save("CRMLA-FC",{cadence:"Quarterly"}),"2026-04"),null);
 assert.equal(JSON.parse(generate(call,"2025-01").occurrence.snapshot).reportingBasis.nominalDueOn,"2025-05-15");
 const annual={cadence:"Annual",applicability:"Required",reviewerEvidence:"Fictional review"};
 const renewal=save("DRE-RENEW",annual,"LICENSING");
 assert.equal(JSON.parse(generate(renewal,"2026-01").occurrence.snapshot).reportingBasis.nominalDueOn,"2026-12-31");
 const fiscalQuarter={...annual,cadence:"Fiscal quarterly",annualStartMonth:7};
 for (const suffix of ["DRE-TRUST-Q","DRE-MULTI-Q"]) {
  const trust=save(suffix,fiscalQuarter);
  assert.equal(JSON.parse(generate(trust,"2025-07").occurrence.snapshot).reportingBasis.nominalDueOn,"2025-10-30");
  assert.equal(generate(trust,"2026-04").occurrence.status,"Applicability review gap");
  assert.equal(JSON.parse(generate(trust,"2026-04").occurrence.snapshot).reportingBasis.nominalDueOn,null);
 }
 const noTrust=save("DRE-RE854",fiscalQuarter);
 assert.equal(JSON.parse(generate(noTrust,"2025-07").occurrence.snapshot).reportingBasis.nominalDueOn,"2025-10-30");
 assert.equal(JSON.parse(generate(noTrust,"2026-04").occurrence.snapshot).reportingBasis.nominalDueOn,null);
 for (const [month,date] of [[1,"2027-05-31"],[2,"2027-05-31"],[3,"2027-05-31"],[4,"2027-06-29"],[12,"2028-05-31"]]) {
  const trust=save("DRE-TAR",{...annual,annualStartMonth:month});
  const period=`2026-${String(month).padStart(2,"0")}`;
  assert.equal(JSON.parse(generate(trust,period).occurrence.snapshot).reportingBasis.nominalDueOn,date);
 }
 const bar=save("BAR",{...annual,annualStartMonth:7});
 assert.match(generate(bar,"2025-01").error,/first month/);
 const report=generate(bar,"2025-07").occurrence;
 assert.equal(report.internalTarget,"2026-06-30");
 assert.equal(JSON.parse(report.snapshot).reportingBasis.nominalDueOn,"2026-09-28");
 assert.equal(f.run({operation:"occurrences",entityId:f.entityId,id:bar}).items[0].through,"2026-06-30");
 assert.equal(f.run({operation:"planWork",entityId:f.entityId,id:bar,period:"2025-07",requestId:crypto.randomUUID()}).kind,"obligationWorkPlanned");
 assert.match(f.sql.prepare("SELECT instructions FROM compliance_program_items").get().instructions,/Nominal date: 2026-09-28/);
 const unresolvedBar=save("BAR",annual);
 assert.equal(generate(unresolvedBar,"2025-01").occurrence.status,"Applicability review gap");
 const cfl=save("CFLANNUAL",annual);
 const cflPeriod=JSON.parse(generate(cfl,"2025-01").occurrence.snapshot);
 assert.equal(cflPeriod.reportingBasis.nominalDueOn,"2026-03-15");
 assert.equal(cflPeriod.reportingBasis.route,"DFPI self-service portal");
 const mismatched=save("CFLANNUAL",{...annual,annualStartMonth:7});
 assert.equal(generate(mismatched,"2025-07").occurrence.status,"Applicability review gap");
 const cflActivity=save("CFL-MCR",{...annual,cadence:"Quarterly"});
 const cflActivityBasis=JSON.parse(generate(cflActivity,"2026-10").occurrence.snapshot).reportingBasis;
 assert.equal(cflActivityBasis.route,"NMLS Residential Mortgage Loan Activity");
 assert.equal(cflActivityBasis.nominalDueOn,"2027-02-14");
 assert.match(cflActivityBasis.review,/Review Financial Condition separately/);
 assert.equal(generate(save("CFL-MCR",annual),"2026-01").occurrence.status,"Applicability review gap");
 const assessment=save("CFL-ASSESS",annual,"LICENSING");
 const assessmentBasis=JSON.parse(generate(assessment,"2026-01").occurrence.snapshot).reportingBasis;
 assert.equal(assessmentBasis.route,"DFPI annual assessment payment per invoice");
 assert.equal(assessmentBasis.nominalDueOn,"2026-10-31");
 assert.equal(generate(save("CFL-ASSESS",{...annual,annualStartMonth:7},"LICENSING"),"2026-07").occurrence.status,"Applicability review gap");
 assert.equal(f.run({operation:"planWork",entityId:f.entityId,id:assessment,period:"2026-01",requestId:crypto.randomUUID()}).kind,"obligationWorkPlanned");
 assert.match(f.sql.prepare("SELECT instructions FROM compliance_program_items WHERE instructions LIKE '%CFL-ASSESS%'").get().instructions,
  /DFPI annual assessment payment per invoice.*2026-10-31/);
 const crmla=save("CRMLA-ANNUAL",annual);
 assert.deepEqual(JSON.parse(generate(crmla,"2025-01").occurrence.snapshot).reportingBasis, {
  route:"DFPI self-service portal",nominalDueOn:"2026-03-01",
  review:"Confirm CRMLA authority, the current annual schedules, attestation and applicable no-activity instructions.",
 });
 const holden=save("HOLDEN",annual);
 const holdenPeriod=JSON.parse(generate(holden,"2025-01").occurrence.snapshot);
 assert.equal(holdenPeriod.reportingBasis.route,"DFPI Holden Act submission");
 assert.equal(holdenPeriod.reportingBasis.nominalDueOn,"2026-03-31");
 assert.match(holdenPeriod.reportingBasis.review,/signed response for HMDA reporting or inactivity/);
 const mcr=save("CRMLA-MCR",{...annual,cadence:"Quarterly"});
 assert.equal(JSON.parse(generate(mcr,"2026-04").occurrence.snapshot).reportingBasis.nominalDueOn,"2026-08-14");
 const audit=save("CRMLA-AUDIT",{...annual,annualStartMonth:7});
 const auditPeriod=JSON.parse(generate(audit,"2025-07").occurrence.snapshot);
 assert.equal(auditPeriod.reportingBasis.route,"NMLS audited financial statement upload");
 assert.equal(auditPeriod.reportingBasis.nominalDueOn,"2026-10-13");
 const auditUnresolved=save("CRMLA-AUDIT",annual);
 assert.equal(generate(auditUnresolved,"2025-01").occurrence.status,"Applicability review gap");
 assert.equal(f.run({operation:"planWork",entityId:f.entityId,id:audit,period:"2025-07",requestId:crypto.randomUUID()}).kind,"obligationWorkPlanned");
 const work=f.sql.prepare("SELECT instructions FROM compliance_program_items WHERE instructions LIKE '%CRMLA-AUDIT%'").get();
 assert.match(work.instructions,/NMLS audited financial statement upload.*2026-10-13/);
 const scopeUpdate = (activity, expectedRevision) => complianceCaseWork(f.db,{type:"stateScope",input:{operation:"save",entityId:f.entityId,
  jurisdiction,expectedRevision,requestId:crypto.randomUUID(),
  facts:{activity,lienScope:"First lien",companyEvidence:"Fictional licenses",officeEvidence:"",
    originatorEvidence:"",products:"",responsibility:"",reportingBasis:"",counselPacketReference:""}}},
  f.staff,f.staff.brokerage.id,[f.actor],now);
 assert.equal(scopeUpdate("Brokerage and servicing",1).revision,2);
 const scopedFiling = (suffix,cadence,period,revision) => {
  const id = crypto.randomUUID();
  const sourceKey = "REQ-CA-REPORTING-" + suffix;
  assert.equal(f.run(f.save({id,draft:{...f.draft,cadence},stateReference:{jurisdiction,revision,sourceKey}})).revision,1);
  return filingDate(id,period);
 };
 for (const suffix of ["DRE-FC","CFL-FC","CRMLA-FC"]) {
  assert.equal(scopedFiling(suffix,"Quarterly","2026-04",2),"2026-08-14");
  assert.equal(scopedFiling(suffix,"Annual","2026-01",2),null);
 }
 assert.equal(scopeUpdate("Multiple or unresolved",2).revision,3);
 assert.equal(scopedFiling("CFL-FC","Quarterly","2026-04",3),null);
});

test("priority state reporting uses distinct periods and leaves unverified dates open",t=>{
 const f=fixture(t);
 for (const jurisdiction of ["CA","FL","TX","NY","CO","IL","MI"]) {
  const scope=complianceCaseWork(f.db,{type:"stateScope",input:{operation:"save",entityId:f.entityId,jurisdiction,
   expectedRevision:0,requestId:crypto.randomUUID(),facts:{activity:"Brokerage",lienScope:"First lien",companyEvidence:"Fictional license",
    officeEvidence:"",originatorEvidence:"",products:"",responsibility:"",reportingBasis:"",counselPacketReference:""}}},
   f.staff,f.staff.brokerage.id,[f.actor],"2026-11-12T12:00:00Z");
  assert.equal(scope.revision,1,jurisdiction);
 }
 const sources=f.run({operation:"stateSources",entityId:f.entityId}).items;
 const check=(jurisdiction,suffix,cadence,period,route,due,annualStartMonth,area="REPORTING")=>{
  const sourceKey=`REQ-${jurisdiction}-${area}-${suffix}`, id=crypto.randomUUID();
  assert(sources.some(item=>item.sourceKey===sourceKey),sourceKey);
  const draft={...f.draft,cadence,applicability:"Required",reviewerEvidence:"Fictional review",
   ...(annualStartMonth === undefined ? {} : {annualStartMonth})};
  assert.equal(f.run(f.save({id,draft,stateReference:{jurisdiction,sourceKey,revision:1}})).revision,1,sourceKey);
  const occurrence=f.run(f.generate({id,period})).occurrence;
  const basis=JSON.parse(occurrence.snapshot).reportingBasis;
  assert.equal(basis.route,route,sourceKey);
  assert.equal(basis.nominalDueOn,due,sourceKey);
  assert.equal(occurrence.status,due ? "Internal preparation planned" : "Applicability review gap",sourceKey);
  return {id,basis};
 };
 for (const [state,suffix,route,review] of [
  ["CA","DRE-MLO-RNW","NMLS DRE individual MU4 endorsement renewal",/November 1.*following year/],
  ["CA","DFPI-MLO-RNW","NMLS DFPI individual MLO renewal",/DFPI sponsor/],
  ["FL","MLO-RENEW","NMLS Florida individual loan originator renewal",/before March 1/],
  ["TX","MLO-RENEW","NMLS Texas SML individual RMLO renewal",/sponsor's renewal/],
  ["NY","MLO-RENEW","NMLS New York individual MLO renewal",/statutory annual expiration/],
  ["CO","MLO-RENEW","NMLS Colorado individual MLO renewal",/NMLS only for the 2026 cycle/],
  ["IL","MLO-RENEW","NMLS Illinois individual MLO renewal",/last day of February/],
 ]) {
  const renewal=check(state,suffix,"Annual","2026-01",route,"2026-12-31",1,"LICENSING");
  assert.match(renewal.basis.review,review);
  const work=f.run({operation:"planWork",entityId:f.entityId,id:renewal.id,period:"2026-01",requestId:crypto.randomUUID()});
  const item=f.sql.prepare("SELECT category,instructions FROM compliance_program_items WHERE id=?").get(work.workId);
  assert.equal(item.category,"License review",state);
  assert.ok(item.instructions.includes(route),state);
  check(state,suffix,"Annual","2025-01",route,null,1,"LICENSING");
  check(state,suffix,"Annual","2026-07",route,null,7,"LICENSING");
  if (state==="CO" || suffix==="DRE-MLO-RNW") check(state,suffix,"Annual","2027-01",route,null,1,"LICENSING");
 }
 check("FL","MCR","Quarterly","2025-01","NMLS Residential Mortgage Loan Activity","2025-05-15");
 check("FL","BROKER-FC","Annual","2025-01","NMLS Financial Condition","2026-03-31");
 check("FL","BROKER-FC","Annual","2024-01","NMLS Financial Condition",null);
 check("FL","BROKER-FC","Annual","2025-07","NMLS Financial Condition",null,7);
 check("FL","LENDER-FC","Quarterly","2025-07","NMLS Financial Condition","2025-11-14");
 const floridaAudit=check("FL","LENDER-AUDIT","Annual","2025-07","Florida Office of Financial Regulation","2026-10-28",7);
 assert.match(floridaAudit.basis.review,/unchanged year/);
 check("FL","LENDER-AUDIT","Annual","2025-01","Florida Office of Financial Regulation",null);
 const transition=check("FL","AUDIT-CHANGE","Annual","2025-07","Florida Office of Financial Regulation",null,7);
 assert.match(transition.basis.review,/prior audit submission date/);
 const planned=f.run({operation:"planWork",entityId:f.entityId,id:transition.id,period:"2025-07",requestId:crypto.randomUUID()});
 assert.equal(planned.kind,"obligationWorkPlanned");
 const month=complianceCaseWork(f.db,{type:"program",input:{operation:"month",entityId:f.entityId,month:planned.month}},
   f.staff,f.staff.brokerage.id,[f.actor],"2026-11-12T12:00:00Z");
 assert.deepEqual(month.items.find(item=>item.id===planned.workId).obligation.reportingBasis,transition.basis);
 const transitionWork=f.sql.prepare("SELECT instructions FROM compliance_program_items WHERE instructions LIKE '%AUDIT-CHANGE%'").get().instructions;
 assert.match(transitionWork,/Applicability review gap.*prior audit submission date/);
 assert.doesNotMatch(transitionWork,/Nominal date:/);
 check("TX","MCR","Quarterly","2026-01","NMLS Residential Mortgage Loan Activity","2026-05-15");
 check("TX","FC","Annual","2025-01","NMLS Financial Condition","2026-03-31");
 check("TX","FC","Quarterly","2026-04","NMLS Financial Condition",null);
 check("TX","SSSF","Quarterly","2025-10","NMLS State-Specific Supplemental Form",null);
 check("TX","SSSF","Quarterly","2026-01","NMLS State-Specific Supplemental Form","2026-05-15");
 const occc=check("TX","OCCC-ANNUAL","Annual","2025-01","Texas OCCC annual reporting portal","2026-05-01");
 assert.match(occc.basis.review,/partial-year, no-activity and same-entity/);
 check("TX","OCCC-ANNUAL","Annual","2024-01","Texas OCCC annual reporting portal",null);
 check("TX","OCCC-ANNUAL","Annual","2025-07","Texas OCCC annual reporting portal",null,7);
 check("TX","CO-RENEW","Annual","2026-01","NMLS company renewal","2026-12-31",1,"LICENSING");
 check("TX","BANKER-RENEW","Annual","2026-01","NMLS company renewal","2026-12-31",1,"LICENSING");
 check("TX","CO-RENEW","Annual","2025-01","NMLS company renewal",null,1,"LICENSING");
 check("NY","MCR","Quarterly","2026-01","NMLS Mortgage Call Report","2026-05-15");
 check("NY","QRES","Quarterly","2026-01","Mail to New York DFS Mortgage Banking","2026-04-30");
 check("NY","QRES","Quarterly","2025-04","Mail to New York DFS Mortgage Banking",null);
 check("NY","VOOR","Annual","2025-01","New York DFS VOOR portal or mail","2026-06-22");
 check("NY","VOOR","Annual","2026-01","New York DFS VOOR portal or mail",null);
 check("NY","BANKER-VOOR","Annual","2025-01","New York DFS VOOR portal or mail","2026-06-22");
 check("NY","BANKER-VOOR","Annual","2026-01","New York DFS VOOR portal or mail",null);
 check("NY","BANKER-QFS","Fiscal quarterly","2025-11","New York DFS quarterly financial report","2026-03-17",2);
 check("NY","BANKER-QFS","Quarterly","2026-01","New York DFS quarterly financial report",null);
 check("NY","BANKER-AUDIT","Annual","2025-02","New York DFS audited financial statement","2026-05-01",2);
 check("NY","VOSR","Quarterly","2026-01","New York DFS VOSR portal","2026-04-30");
 check("NY","VOSR","Fiscal quarterly","2026-02","New York DFS VOSR portal",null,2);
 check("NY","SERVICER-QFS","Fiscal quarterly","2026-02","New York DFS quarterly financial report","2026-06-14",2);
 check("NY","SERVICER-AUD","Annual","2025-02","New York DFS audited financial statement","2026-05-01",2);
 assert.ok(f.run(f.save({draft:{...f.draft,cadence:"Fiscal quarterly"}})).error);
 check("CO","MCR","Quarterly","2026-04","NMLS Mortgage Call Report","2026-08-14");
 check("CO","STD-FC","Annual","2025-07","NMLS Financial Condition",null,7);
 check("CO","QUARTER-FC","Quarterly","2026-04","NMLS Financial Condition",null);
 const coloradoScope = (activity, expectedRevision) => complianceCaseWork(f.db, { type: "stateScope", input: {
   operation: "save", entityId: f.entityId, jurisdiction: "CO", expectedRevision, requestId: crypto.randomUUID(),
   facts: { activity, lienScope: "First lien", companyEvidence: "Fictional license", officeEvidence: "",
     originatorEvidence: "", products: "", responsibility: "", reportingBasis: "", counselPacketReference: "" },
 } }, f.staff, f.staff.brokerage.id, [f.actor], "2026-11-12T12:00:00Z");
 const quarterlySource = "REQ-CO-REPORTING-QUARTER-FC";
 const quarterlyDraft = { ...f.draft, cadence: "Quarterly", applicability: "Required", reviewerEvidence: "Fictional review" };
 const quarterlyObligation = revision => {
   const id = crypto.randomUUID();
   assert.equal(f.run(f.save({ id, draft: quarterlyDraft,
     stateReference: { jurisdiction: "CO", revision, sourceKey: quarterlySource } })).revision, 1);
   return id;
 };
 const coloradoPeriod = (id, period) => JSON.parse(f.run(f.generate({ id, period })).occurrence.snapshot);
 assert.equal(coloradoScope("Brokerage and lending", 1).revision, 2);
 const lending = quarterlyObligation(2);
 assert.equal(coloradoPeriod(lending, "2026-04").reportingBasis.nominalDueOn, "2026-08-14");
 assert.equal(coloradoPeriod(lending, "2025-10").reportingBasis.nominalDueOn, null);
 assert.equal(coloradoScope("Brokerage and servicing", 2).revision, 3);
 const servicing = quarterlyObligation(3);
 assert.equal(coloradoPeriod(servicing, "2026-07").reportingBasis.nominalDueOn, "2026-11-14");
 assert.equal(coloradoScope("Multiple or unresolved", 3).revision, 4);
 assert.equal(coloradoPeriod(quarterlyObligation(4), "2026-07").reportingBasis.nominalDueOn, null);
 assert.equal(coloradoPeriod(servicing, "2026-10").reportingBasis.nominalDueOn, null);
 assert.equal(coloradoPeriod(servicing, "2026-07").reportingBasis.nominalDueOn, "2026-11-14");
 check("IL","ACTIVITY","Quarterly","2026-01","NMLS Mortgage Call Report","2026-05-15");
 check("IL","ACTIVITY","Annual","2025-01","NMLS Mortgage Call Report",null);
 check("MI","FC","Annual","2025-01","NMLS Financial Condition","2026-03-31");
 const mismatched = check("MI","FC","Quarterly","2026-04","NMLS Financial Condition",null);
 check("MI","FC","Annual","2025-07","NMLS Financial Condition",null,7);
 check("MI","GAAP","Annual","2025-07","NMLS financial statement upload","2026-09-28",7);
 const saved = f.sql.prepare("SELECT snapshot FROM compliance_obligation_occurrences WHERE obligationId=?").get(mismatched.id);
 const legacy = JSON.parse(saved.snapshot);
 legacy.reportingBasis.nominalDueOn = "2026-08-14";
 const historicalSnapshot = JSON.stringify(legacy);
 f.sql.prepare("UPDATE compliance_obligation_occurrences SET snapshot=?,status=? WHERE obligationId=?")
   .run(historicalSnapshot,"Internal preparation planned",mismatched.id);
 const target = { entityId: f.entityId, id: mismatched.id, period: "2026-04" };
 const [occurrence] = f.run({ operation: "occurrences", entityId: f.entityId, id: mismatched.id }).items;
 assert.equal(occurrence.status, "Applicability review gap");
 assert.equal(occurrence.reportingBasis.nominalDueOn, null);
 assert.equal(occurrence.snapshot, historicalSnapshot);
 const history = f.run({ operation: "michiganFilingHistory", ...target });
 assert.equal(history.nominalDueOn, null);
 assert.equal(history.scopeChanged, true);
 const cadencePlan = f.run({ operation: "planWork", ...target, requestId: crypto.randomUUID() });
 const work = f.program({ operation: "month", entityId: f.entityId, month: cadencePlan.month }).items.find(item => item.id === cadencePlan.workId);
 assert.equal(work.obligation.reportingBasis.nominalDueOn, null);
 assert.match(work.filingProgress.gaps[0], /cadence conflicts/);
 for (const [jurisdiction, activity] of [["MI", "Brokerage and lending"], ["TX", "Brokerage and servicing"]]) {
   const revised = complianceCaseWork(f.db, { type: "stateScope", input: { operation: "save", entityId: f.entityId, jurisdiction,
     expectedRevision: 1, requestId: crypto.randomUUID(), facts: { activity, lienScope: "First lien", companyEvidence: "Fictional license",
       officeEvidence: "", originatorEvidence: "", products: "", responsibility: "", reportingBasis: "", counselPacketReference: "" } } },
   f.staff, f.staff.brokerage.id, [f.actor], "2026-11-12T12:00:00Z");
   assert.equal(revised.revision, 2);
   for (const [cadence, period, due] of [["Quarterly", "2026-04", "2026-08-14"], ["Annual", "2026-01", null]]) {
     const id = crypto.randomUUID();
     assert.equal(f.run(f.save({ id, draft: { ...f.draft, cadence }, stateReference: { jurisdiction, sourceKey: `REQ-${jurisdiction}-REPORTING-FC`, revision: 2 } })).revision, 1);
     const generated = f.run(f.generate({ id, period })).occurrence;
     assert.equal(JSON.parse(generated.snapshot).reportingBasis.nominalDueOn, due);
   }
 }
});

test("Michigan company renewal preserves the filing target, expiration context and late-target review",t=>{
 const f=fixture(t);
 const scope=complianceCaseWork(f.db,{type:"stateScope",input:{operation:"save",entityId:f.entityId,jurisdiction:"MI",
  expectedRevision:0,requestId:crypto.randomUUID(),facts:{activity:"Brokerage",lienScope:"First and secondary liens",companyEvidence:"Fictional authority",
   officeEvidence:"",originatorEvidence:"",products:"",responsibility:"",reportingBasis:"",counselPacketReference:""}}},
  f.staff,f.staff.brokerage.id,[f.actor],"2026-11-12T12:00:00Z");
 assert.equal(scope.revision,1);
 const sources=f.run({operation:"stateSources",entityId:f.entityId}).items;
 const record=(license,targetDay,period="2026-01",annualStartMonth=1)=>{
  const id=crypto.randomUUID(),sourceKey=`REQ-MI-LICENSING-${license}-RENEW`;
  assert(sources.some(item=>item.sourceKey===sourceKey));
  const draft={...f.draft,cadence:"Annual",annualStartMonth,internalTargetDay:targetDay,
   applicability:"Required",reviewerEvidence:"Fictional company authority evidence"};
  assert.equal(f.run(f.save({id,draft,stateReference:{jurisdiction:"MI",revision:1,sourceKey}})).revision,1);
  const occurrence=f.run(f.generate({id,period})).occurrence;
  return {id,occurrence,basis:JSON.parse(occurrence.snapshot).reportingBasis};
 };
 const first=record("FIRST",14);
 assert.equal(first.occurrence.internalTarget,"2026-12-14");
 assert.equal(first.occurrence.status,"Internal preparation planned");
 assert.equal(first.basis.nominalDueOn,"2026-12-15");
 assert.match(first.basis.review,/expires December 31 unless renewed/);
 assert.equal(record("SECOND",15).occurrence.status,"Internal preparation planned");
 const secondary=record("SECOND",16);
 assert.equal(secondary.occurrence.status,"Applicability review gap");
 assert.match(secondary.basis.review,/internal target falls after/);
 assert.equal(record("FIRST",14,"2024-01").basis.nominalDueOn,null);
 assert.equal(record("SECOND",14,"2026-07",7).basis.nominalDueOn,null);
 const individual=record("MLO",15);
 assert.equal(individual.basis.nominalDueOn,"2026-12-31");
 assert.equal(individual.basis.route,"NMLS individual MLO renewal");
 assert.match(individual.basis.review,/education before the request/);
 assert.equal(record("MLO",15,"2025-01").basis.nominalDueOn,null);
 assert.equal(record("MLO",15,"2026-07",7).basis.nominalDueOn,null);
 assert.equal(f.run({operation:"planWork",entityId:f.entityId,id:individual.id,period:"2026-01",requestId:crypto.randomUUID()}).kind,"obligationWorkPlanned");
 const mloWork=f.sql.prepare("SELECT category,instructions FROM compliance_program_items").get();
 assert.equal(mloWork.category,"License review");
 assert.match(mloWork.instructions,/NMLS individual MLO renewal.*2026-12-31.*education before the request/);
 const key={entityId:f.entityId,id:individual.id,period:"2026-01",originatorNmls:"12345"};
 const renewalHistory={...key,operation:"michiganMloRenewalHistory"};
 const request={on:"2026-11-10",reference:"NMLS submission receipt"};
 const education={route:"Continuing education",on:request.on,reference:"NMLS education history"};
 const evidence={request,education};
 const saveRenewal={...key,operation:"saveMichiganMloRenewal",expected:0,requestId:crypto.randomUUID(),evidence};
 const saved=f.run(saveRenewal);
 assert.equal(saved.finding.educationStatus,"Verify same-day sequence");
 assert.equal(saved.finding.regulatorStatus,"No regulator status recorded");
 assert.deepEqual(f.run(saveRenewal),saved);
 assert.ok(f.run({...saveRenewal,requestId:crypto.randomUUID()}).error);
 assert.ok(f.run(renewalHistory,f.staff,[]).error);
 assert.ok(f.run({...renewalHistory,id:secondary.id}).error);
 assert.deepEqual(f.run({...renewalHistory,originatorNmls:"67890"}).versions,[]);
 const regulatorStatus={status:"Renewed",on:"2026-11-11",reference:"Regulator renewal record"};
 const update={...saveRenewal,expected:1,requestId:crypto.randomUUID(),correction:"Matched education and status timestamps",
  evidence:{request,regulatorStatus,education:{...education,sameDaySequenceReference:"Course completion timestamp preceded the request"}}};
 assert.ok(f.run({...update,correction:undefined}).error);
 assert.ok(f.run({...update,evidence:{...update.evidence,regulatorStatus:{...regulatorStatus,on:"2026-11-12"}}}).error);
 assert.equal(f.run(update).finding.educationStatus,"Education documented before request");
 assert.equal(f.progress("2026-12").summary,"1 of 1 recorded originators show renewed status");
 const history=f.run(renewalHistory);
 assert.equal(history.currentFinding.regulatorStatus,"Renewed");
 assert.equal(history.versions[1].finding.regulatorStatus,"No regulator status recorded");
 assert.deepEqual(f.run({...renewalHistory,before:2}).versions.map(version=>version.version),[1]);
 const firstYear={route:"First-year exception",on:"2026-08-02",reference:"Prelicensure coursework",
  issued:{on:"2026-09-07",reference:"Michigan license issued"}};
 assert.equal(f.run({...saveRenewal,originatorNmls:"67890",requestId:crypto.randomUUID(),evidence:{request,education:firstYear}})
  .finding.educationStatus,"First-year exception documented");

 assert.equal(f.run({operation:"planWork",entityId:f.entityId,id:secondary.id,period:"2026-01",requestId:crypto.randomUUID()}).kind,"obligationWorkPlanned");
 assert.ok(f.sql.prepare("SELECT instructions FROM compliance_program_items").all()
  .some(item=>/Nominal date: 2026-12-15.*internal target falls after/.test(item.instructions)));
 const receipt = { operation:"recordFilingReceipt", entityId:f.entityId, id:first.id, period:"2026-01",
  requestId:crypto.randomUUID(), expectedVersion:0, status:"Submitted", confirmation:"SAMPLE-MI-RENEW-1",
  confirmedOn:"2026-11-10", documentReference:"Fictional renewal receipt", note:"" };
 assert.equal(f.run(receipt).items[0].confirmation,receipt.confirmation);
 assert.deepEqual(f.run(receipt).items.map(item=>item.version),[1]);
 const archive=f.run({operation:"filingArchive",filters:{entityId:f.entityId,year:"2026",confirmation:receipt.confirmation}});
 assert.equal(archive.items[0].period,receipt.period);
 assert.equal(archive.items[0].basis.report,undefined);
 const individualReceipt={...receipt,id:individual.id,requestId:crypto.randomUUID(),confirmation:"SAMPLE-MI-MLO-1"};
 assert.equal(f.run(individualReceipt).items[0].confirmation,individualReceipt.confirmation);
 const individualArchive=f.run({operation:"filingArchive",filters:{entityId:f.entityId,year:"2026",confirmation:individualReceipt.confirmation}});
 assert.equal(individualArchive.items[0].basis.obligationId,individual.id);
 assert.equal(individualArchive.items[0].period,"2026-01");
 f.run(f.save());
 f.run(f.generate());
 assert.ok(f.run({...receipt,id:f.id,period:"2024-02",requestId:crypto.randomUUID()}).error);
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


test("recorded quarterly work opens its exact monthly item and retains the original preparation basis", t => {
  const f = fixture(t);
  const reportDraft = { ...f.draft, cadence: "Quarterly", preparation: "Mortgage Call Report" };
  assert.ok(f.run(f.save({ draft: { ...reportDraft, cadence: "Annual" } })).error);
  assert.equal(f.run(f.save({ draft: reportDraft })).revision, 1);
  const period = "2026-07";
  assert.equal(f.run(f.generate({ period })).kind, "obligationOccurrence");
  const request = { operation: "planWork", entityId: f.entityId, id: f.id, period, requestId: crypto.randomUUID() };
  const planned = f.run(request);
  assert.equal(planned.month, "2026-09");
  assert.equal(f.run(f.save({ expectedRevision: 1, draft: { ...f.draft, sourceUrl: "https://example.test/revised" } })).revision, 2);
  const history = f.run({ operation: "occurrences", entityId: f.entityId, id: f.id });
  const target = history.items[0].review;
  assert.deepEqual(target, { entityId: f.entityId, month: "2026-09", itemId: planned.workId });
  const read = month => complianceCaseWork(f.db, { type: "program", input: { operation: "month", entityId: target.entityId, month } },
    f.staff, f.staff.brokerage.id, [f.actor], "2026-11-11T12:00:00Z");
  assert.deepEqual(read(period).items, []);
  const item = read(target.month).items.find(item => item.id === target.itemId);
  assert.equal(item.obligation.version, 1);
  assert.equal(item.obligation.sourceUrl, f.draft.sourceUrl);
  assert.deepEqual(item.obligation.report, { year: "2026", quarter: 3 });
  assert.equal(f.run({ ...request, requestId: crypto.randomUUID() }).workId, target.itemId);
});


test("external filing confirms one exact recorded quarter and preserves receipt history across retries", t => {
  const f = fixture(t);
  const draft = { ...f.draft, cadence: "Quarterly", preparation: "Mortgage Call Report" };
  const period = "2026-07";
  assert.equal(f.run(f.save({ draft })).revision, 1);
  assert.equal(f.run(f.generate({ period })).kind, "obligationOccurrence");
  const read = { operation: "filingReceipts", entityId: f.entityId, id: f.id, period };
  assert.deepEqual(f.run(read).items, []);
  assert.ok(f.run({ ...read, period: "2026-04" }).error);
  assert.ok(f.run({ ...read, entityId: crypto.randomUUID() }).error);
  assert.ok(f.run(read, f.staff, []).error);
  const officer = { ...f.actor, role: "LO" };
  assert.ok(f.run(read, { ...f.staff, brokerage: { ...f.staff.brokerage, role: "LO" } }, [officer]).error);

  const record = { ...read, operation: "recordFilingReceipt", requestId: crypto.randomUUID(), expectedVersion: 0,
    status: "Submitted", confirmation: "EXAMPLE-RECEIPT-1", confirmedOn: "2026-10-28",
    documentReference: "", note: "" };
  assert.ok(f.run({ ...record, confirmedOn: "2026-11-12" }).error);
  assert.equal(f.run(record).items[0].version, 1);
  assert.equal(f.run(record).items.length, 1);
  assert.ok(f.run({ ...record, confirmation: "Different confirmation" }).error);
  assert.match(f.run({ ...record, requestId: crypto.randomUUID() }).error, /changed/);

  const accepted = { ...record, expectedVersion: 1, requestId: crypto.randomUUID(), status: "Accepted",
    confirmation: "EXAMPLE-RECEIPT-2", confirmedOn: "2026-11-01", documentReference: "Fictional acceptance receipt",
    note: "Recorded the later acceptance." };
  assert.ok(f.run({ ...accepted, note: "" }).error);
  f.sql.exec("CREATE TRIGGER fail_filing_audit BEFORE INSERT ON compliance_obligation_events BEGIN SELECT RAISE(ABORT,'audit failed'); END");
  assert.throws(() => f.run(accepted), /audit failed/);
  assert.equal(f.run(read).items.length, 1);
  f.sql.exec("DROP TRIGGER fail_filing_audit");
  assert.deepEqual(f.run(accepted).items.map(item => [item.version, item.status, item.confirmation]),
    [[2, "Accepted", "EXAMPLE-RECEIPT-2"], [1, "Submitted", "EXAMPLE-RECEIPT-1"]]);
  assert.equal(f.run(record).items[0].version, 2);
  assert.equal(f.run({ operation: "occurrences", entityId: f.entityId, id: f.id }).items[0].filingStatus, "Accepted");
  const archive = (filters = {}, staff = f.staff, roster = [f.actor]) =>
    f.run({ operation: "filingArchive", filters: { year: "", entityId: "", confirmation: "", ...filters } }, staff, roster);
  const original = archive({ confirmation: "example-receipt-1", year: "2026", entityId: f.entityId });
  assert.deepEqual(original.items.map(row => [row.matchedVersion, row.version, row.status, row.period]), [[1, 2, "Accepted", period]]);
  assert.deepEqual(original.items[0].matched, { status: "Submitted", confirmation: record.confirmation, confirmedOn: record.confirmedOn, hasReceiptReference: false });
  assert.equal(original.items[0].basis.report.quarter, 3);
  assert.equal(archive().items[0].matchedVersion, 2);
  assert.deepEqual(f.run({ operation: "filingArchive", filters: { year: "", entityId: "", confirmation: "" }, offset: 25 }).items, []);
  assert.deepEqual(archive({ year: "2025" }).items, []);
  assert.deepEqual(archive({ confirmation: "%" }).items, []);
  assert.deepEqual(archive({ entityId: crypto.randomUUID() }).items, []);
  const other = { ...f.staff, brokerage: { ...f.staff.brokerage, id: crypto.randomUUID() } };
  assert.deepEqual(archive({}, other), { kind: "filingArchive", entities: [], items: [], more: false });
  assert.ok(archive({}, { ...f.staff, brokerage: { ...f.staff.brokerage, role: "LO" } }, [officer]).error);
  const add = { ...read, operation: "addFilingReceiptReference", requestId: crypto.randomUUID(), version: 1,
    location: "Fictional reporting folder / submission receipt" };
  assert.ok(f.run({ ...add, period: "2026-04" }).error);
  assert.ok(f.run({ ...add, version: 3 }).error);
  assert.ok(f.run({ ...add, version: 2 }).error);
  assert.ok(f.run(add, other).error);
  assert.ok(f.run(add, { ...f.staff, brokerage: { ...f.staff.brokerage, role: "LO" } }, [officer]).error);
  f.sql.exec("CREATE TRIGGER fail_reference_audit BEFORE INSERT ON compliance_obligation_events BEGIN SELECT RAISE(ABORT,'audit failed'); END");
  assert.throws(() => f.run(add), /audit failed/);
  assert.equal(f.run(read).items[1].addedReceiptReference, undefined);
  f.sql.exec("DROP TRIGGER fail_reference_audit");
  const updated = f.run(add);
  assert.deepEqual(f.run(add), updated);
  assert.ok(f.run({ ...add, location: "Conflicting receipt location" }).error);
  assert.ok(f.run({ ...add, requestId: crypto.randomUUID() }).error);
  assert.equal(updated.items.length, 2);
  assert.equal(updated.items[0].status, "Accepted");
  assert.equal(updated.items[1].documentReference, "");
  assert.equal(updated.items[1].addedReceiptReference.location, add.location);
  assert.equal(updated.items[1].addedReceiptReference.recordedBy, f.actor.email);
  assert.equal(archive({ confirmation: record.confirmation }).items[0].matched.hasReceiptReference, true);
  assert.equal(f.sql.prepare("SELECT count(*) AS count FROM compliance_program_items").get().count, 0);
});

test("New York employment reporting preserves separate prompt notices and quarterly mailing evidence", t => {
  const f = fixture(t);
  const jurisdiction = "NY";
  const scope = complianceCaseWork(f.db, { type: "stateScope", input: { operation: "save", entityId: f.entityId,
    jurisdiction, expectedRevision: 0, requestId: crypto.randomUUID(),
    facts: { activity: "Brokerage", lienScope: "First lien", companyEvidence: "Fictional DFS registration", officeEvidence: "",
      originatorEvidence: "", products: "", responsibility: "", reportingBasis: "", counselPacketReference: "" } } },
    f.staff, f.staff.brokerage.id, [f.actor], "2026-11-11T12:00:00Z");
  const stateReference = { jurisdiction, revision: scope.revision, sourceKey: "REQ-NY-REPORTING-QRES" };
  assert.equal(f.run(f.save({ stateReference, draft: { ...f.draft, cadence: "Quarterly" } })).revision, 1);
  const period = "2026-07";
  assert.equal(f.run(f.generate({ period })).kind, "obligationOccurrence");
  const target = { entityId: f.entityId, id: f.id, period };
  const separation = { originatorNmls: "12345", kind: "Resignation", event: { on: "2026-09-30", reference: "Fictional separation record" } };
  const evidence = { rosterReference: "Fictional roster reconciliation", temporaryAuthorityReference: "Fictional Temporary Authority review",
    activity: "Reportable activity", separations: [separation] };
  const first = { ...target, operation: "saveNewYorkEmployment", expected: 0, requestId: crypto.randomUUID(), evidence };
  assert.ok(f.run(first, f.staff, []).error);
  assert.ok(f.run({ ...first, evidence: { ...evidence, activity: "No reportable activity" } }).error);
  const initial = f.run(first);
  const work = f.run({operation:"planWork",...target,requestId:crypto.randomUUID()});
  assert.ok(f.progress(work.month).gaps.includes("Verify missing individual departure notices."));
  assert.equal(initial.finding.dueOn, "2026-10-30");
  assert.equal(initial.finding.entityNoticesMissing, 1);
  assert.equal(initial.finding.individualNoticesMissing, 1);
  assert.deepEqual(f.run(first), initial);
  const request = { ...first, expected: 1, correction: "Fictional evidence update", requestId: crypto.randomUUID() };
  const mailed = { on: "2026-10-30", reference: "Fictional mailing receipt" };
  assert.ok(f.run({ ...request, evidence: { ...evidence, mailed } }).error);
  const complete = { ...evidence, mailed, notarizedReport: { on: "2026-10-28", reference: "Fictional notarized report" },
    separations: [{ ...separation, entityNotice: { on: "2026-10-01", reference: "Fictional DFS entity notice" } }] };
  assert.ok(f.run({ ...request, evidence: { ...complete, separations: [{ ...separation, event: { ...separation.event, on: "2026-10-01" } }] } }).error);
  const filed = f.run({ ...request, evidence: complete });
  assert.equal(filed.finding.filingStatus, "Mailing recorded by nominal date");
  assert.equal(filed.finding.entityNoticesMissing, 0);
  assert.equal(filed.finding.individualNoticesMissing, 1);
  assert.equal(filed.finding.verifyNoticeTiming, true);
  const history = f.run({ ...target, operation: "newYorkEmploymentHistory" });
  assert.equal(history.versions.length, 2);
  assert.deepEqual(history.versions[1].finding, initial.finding);
  assert.ok(f.run({ ...target, id: crypto.randomUUID(), operation: "newYorkEmploymentHistory" }).error);
  const workpaper = version => f.run({ ...target, operation: "newYorkEmploymentWorkpaper", version });
  assert.match(workpaper(2).gaps.join(" "), /reconcile the quarter's filing rows/);
  const hire = { legalName: "Fictional Hire", originatorNmls: "67890", hiredOn: "2026-08-01", temporaryAuthority: false,
    evidenceReference: "Fictional hire record" };
  const departure = { legalName: "Fictional Departing Officer", originatorNmls: "12345", departedOn: "2026-09-30",
    dismissalForCause: "No", departureReason: "Fictional voluntary resignation", temporaryAuthority: false,
    evidenceReference: "Fictional separation record" };
  const temporary = { legalName: "Fictional Temporary Authority Officer", originatorNmls: "98765", temporaryAuthority: true,
    evidenceReference: "Fictional Temporary Authority record" };
  const update = { ...request, expected: 2, requestId: crypto.randomUUID() };
  assert.ok(f.run({ ...update, evidence: { ...complete, workpaperRows: [hire, hire] } }).error);
  assert.ok(f.run({ ...update, evidence: { ...complete, workpaperRows: [{ ...hire, hiredOn: "2026-10-01" }] } }).error);
  assert.equal(f.run({ ...update, evidence: { ...complete, workpaperRows: [hire, departure, temporary] } }).version, 3);
  const exported = workpaper(3);
  assert.equal(exported.kind, "newYorkEmploymentWorkpaper");
  assert.equal(exported.entity.id, f.entityId);
  assert.equal(exported.dueOn, "2026-10-30");
  assert.deepEqual(exported.rows, [hire, departure, temporary]);
  assert.deepEqual(exported.gaps, [
    "Review missing individual notice evidence for NMLS 12345.",
    "Verify the originating entity's legal name and NMLS ID.",
  ]);
  assert.deepEqual(exported.period, { from: "2026-07-01", through: "2026-09-30" });
  assert.deepEqual(exported.obligation, { id: f.id, scopeRevision: scope.revision, sourceKey: "REQ-NY-REPORTING-QRES" });
  assert.equal(exported.recorded.actor, f.staff.email);
  assert.equal(exported.recorded.correction, request.correction);
  assert.deepEqual(exported.filingEvidence.mailed, mailed);
  assert.deepEqual(exported.filingEvidence.notarizedReport, complete.notarizedReport);
  assert.deepEqual(exported.filingEvidence.separations, complete.separations);
  assert.equal(exported.recordedFinding.individualNoticesMissing, 1);
  assert.equal(workpaper(1).filingEvidence.mailed, undefined);
  assert.equal(workpaper(1).recordedFinding.entityNoticesMissing, 1);
  assert.equal(workpaper(2).rows.length, 0);
  assert.ok(workpaper(4).error);
  const unresolved = { ...complete,
    separations: [...complete.separations, { ...separation, kind: "Dismissal for cause" }],
    workpaperRows: [departure, { ...hire, originatorNmls: departure.originatorNmls, hiredOn: "2026-08-02" }],
  };
  assert.equal(f.run({ ...update, requestId: crypto.randomUUID(), expected: 3, evidence: unresolved }).version, 4);
  const unresolvedGaps = workpaper(4).gaps.join(" ");
  assert.match(unresolvedGaps, /different legal names/);
  assert.match(unresolvedGaps, /dismissal for cause/);
  assert.match(unresolvedGaps, /multiple departures/);
  assert.match(unresolvedGaps, /missing brokerage notice/);
  assert.match(unresolvedGaps, /missing individual notice/);
  assert.deepEqual(workpaper(3).gaps, exported.gaps);
  assert.ok(f.run({ ...target, operation: "newYorkEmploymentWorkpaper", version: 3 }, f.staff, []).error);

});

test("Colorado company renewal preserves receipt gaps and the regulator outcome separately", t => {
 const f = fixture(t);
 const jurisdiction = "CO";
 const scope = complianceCaseWork(f.db,{type:"stateScope",input:{operation:"save",entityId:f.entityId,jurisdiction,
   expectedRevision:0,requestId:crypto.randomUUID(),facts:{activity:"Brokerage",lienScope:"First lien",companyEvidence:"Fictional Colorado registration",
    officeEvidence:"",originatorEvidence:"",products:"",responsibility:"",reportingBasis:"",counselPacketReference:""}}},
   f.staff,f.staff.brokerage.id,[f.actor],"2026-11-11T12:00:00Z");
 assert.equal(f.run(f.save({draft:{...f.draft,cadence:"Annual"},stateReference:{jurisdiction,revision:scope.revision,
   sourceKey:"REQ-CO-LICENSING-CO-RENEW"}})).revision,1);
 const target={entityId:f.entityId,id:f.id,period:"2026-01"};
 assert.equal(f.run(f.generate({period:target.period})).kind,"obligationOccurrence");
 const receipt={component:"Mortgage Call Report",period:"2025-10",disposition:{status:"Filed",
   receipt:{on:"2026-02-15",reference:"Fictional late call report receipt"}}};
 const evidence={classification:"Broker only",classificationReference:"Fictional brokerage review",
   filingInventoryReference:"Fictional NMLS inventory",receipts:[receipt]};
 const save={...target,operation:"saveColoradoCompanyRenewal",requestId:crypto.randomUUID(),expected:0,evidence};
 assert.ok(f.run(save,f.staff,[]).error);
 assert.ok(f.run({...save,evidence:{...evidence,receipts:[receipt,receipt]}}).error);
 const first=f.run(save);
 assert.equal(first.finding.rows.length,5);
 assert.equal(first.finding.rows[0].timing,"Receipt after nominal date");
 assert.equal(first.finding.rows.at(-1).timing,"Verify fiscal year and filing date");
 assert.equal(first.finding.renewalStatus,"No regulator status recorded");
 assert.deepEqual(f.run(save),first);
 const changed={...save,expected:1,requestId:crypto.randomUUID(),correction:"Fictional corrected evidence",
   evidence:{...evidence,priorFiscalYearEnd:"2025-12-31",renewalRequest:{on:"2026-11-09",reference:"Fictional NMLS request"},
   regulatorStatus:{status:"Pending",on:"2026-11-10",reference:"Fictional regulator status"}}};
 const second=f.run(changed);
 assert.equal(second.finding.renewalStatus,"Pending");
 const work = f.run({operation:"planWork",...target,requestId:crypto.randomUUID()});
 assert.ok(f.progress(work.month).gaps.includes("Verify the regulator's renewal status."));
 assert.equal(second.finding.rows.at(-1).nominalDueOn,"2026-03-31");
 assert.equal(second.finding.rows.at(-1).timing,"Nominal date passed without receipt");
 const historicalItem={itemReference:"Fictional 2024 Q2 deficiency",identified:{on:"2025-03-03",reference:"Fictional NMLS notice"}};
 const update={...changed,expected:2,requestId:crypto.randomUUID()};
 const corrected={...historicalItem,clearance:{on:"2026-11-10",reference:"Fictional NMLS clearance"}};
 assert.ok(f.run({...update,evidence:{...changed.evidence,olderDeficiencies:[historicalItem,
   {...historicalItem,itemReference:historicalItem.itemReference.toUpperCase()}]}}).error);
 assert.ok(f.run({...update,evidence:{...changed.evidence,olderDeficiencies:[{...corrected,clearance:{...corrected.clearance,on:"2025-03-01"}}]}}).error);
 const third=f.run({...update,evidence:{...changed.evidence,olderDeficiencies:[historicalItem]}});
 assert.equal(third.finding.olderDeficiencies[0].finding,"Clearance evidence needed");
 assert.equal(third.finding.renewalStatus,"Pending");
 const fourth=f.run({...update,expected:3,requestId:crypto.randomUUID(),evidence:{...changed.evidence,olderDeficiencies:[corrected]}});
 assert.equal(fourth.finding.olderDeficiencies[0].finding,"Clearance evidence recorded");
 const history=f.run({...target,operation:"coloradoCompanyRenewalHistory"});
 assert.equal(history.versions.length,4);
 assert.equal(history.versions[1].finding.olderDeficiencies[0].finding,"Clearance evidence needed");
 assert.deepEqual(history.versions[3].finding,JSON.parse(JSON.stringify(first.finding)));
 assert.ok(f.run({...target,entityId:crypto.randomUUID(),operation:"coloradoCompanyRenewalHistory"}).error);
});

test("New York annual VOOR tracks deadlines and versioned filing evidence", t => {
 const f = fixture(t);
 const scope = complianceCaseWork(f.db, {type:"stateScope", input:{operation:"save", entityId:f.entityId,
   jurisdiction:"NY", expectedRevision:0, requestId:crypto.randomUUID(),
   facts:{activity:"Brokerage",lienScope:"First lien",companyEvidence:"Fictional NY registration",
     officeEvidence:"",originatorEvidence:"",products:"",responsibility:"",reportingBasis:"",counselPacketReference:""}}},
   f.staff, f.staff.brokerage.id, [f.actor], "2026-11-11T12:00:00Z");
 assert.equal(scope.revision, 1);
 const stateReference = {jurisdiction:"NY", revision:1, sourceKey:"REQ-NY-REPORTING-VOOR"};
 const draft = {...f.draft, cadence:"Annual", annualStartMonth:1};
 assert.equal(f.run(f.save({draft,stateReference})).revision, 1);
 const period = "2025-01";
 assert.equal(JSON.parse(f.run(f.generate({period})).occurrence.snapshot).reportingBasis.nominalDueOn, "2026-06-22");
 const target = {entityId:f.entityId,id:f.id,period};
 const history = {operation:"newYorkVoorHistory",...target};
 const work = f.run({operation:"planWork",...target,requestId:crypto.randomUUID()});
 const month = () => f.program({operation:"month",entityId:f.entityId,month:work.month});
 const ownerRow = () => f.program({operation:"ownerHome"}).reviews.items.find(item => item.id === work.workId);
 assert.equal(month().items[0].filingProgress.summary,"Filing evidence needed");
 assert.deepEqual(ownerRow().filing, { summary: "Filing evidence needed", gapCount: month().items[0].filingProgress.gaps.length });
 const prior = month();
 const monthlyReview = f.program({operation:"reviewMonth",entityId:f.entityId,month:work.month,
   fingerprint:prior.fingerprint,requestId:crypto.randomUUID(),note:"Fictional initial filing review"});
 assert.equal(monthlyReview.reviews[0].current,true);
 const savedSnapshot = monthlyReview.reviews[0].snapshot;
 const recordedItem = JSON.parse(savedSnapshot).items[0];
 assert.equal(recordedItem.obligation.obligationId,f.id);
 assert.equal(recordedItem.obligation.version,1);
 assert.deepEqual(recordedItem.obligation.periodBounds,{from:"2025-01-01",through:"2025-12-31"});
 assert.equal(recordedItem.obligation.stateBasis.sourceKey,"REQ-NY-REPORTING-VOOR");
 assert.equal(recordedItem.obligation.stateBasis.revision,1);
 assert.equal(recordedItem.obligation.reportingBasis.nominalDueOn,"2026-06-22");

 const save = (evidence, expected = 0) => ({operation:"saveNewYorkVoor",...target,requestId:crypto.randomUUID(),
   expected,evidence,...(expected ? {correction:"Fictional record updated"} : {})});
 assert.equal(f.run(history).reportYear, 2025);
 assert.ok(f.run({...history,period:"2024-01"}).error);
 const reviewedInstructions = {url:"https://www.dfs.ny.gov/apps_and_licensing/mortgage_companies/volume_of_operations_report",
   deadline:"2026-06-22",reference:"Reviewed 2025 broker instructions"};
 const reconciliation = {activity:"No New York applications or closings",reference:"Fictional no-activity reconciliation"};
 const attestation = {on:"2026-06-21",reference:"Fictional signed attestation",capacity:"Owner",
   authorityReference:"Fictional officer appointment"};
 const original = {on:"2026-06-22",route:"DFS Portal",reference:"Fictional DFS receipt"};
 const evidence = {reviewedInstructions,reconciliation,attestation,original};
 const amendment = {on:"2026-06-23",route:"DFS Portal",reference:"Fictional amendment receipt",reason:"Fictional correction",
   attestationReference:"Fictional amended report attestation"};
 assert.ok(f.run(save({...evidence,original:undefined,amendment})).error);
 assert.ok(f.run(save({...evidence,attestation:{...attestation,on:"2026-06-23"}})).error);
 const firstRequest = save(evidence);
 const first = f.run(firstRequest);
 assert.equal(month().reviews[0].current,false);
 assert.equal(month().reviews[0].snapshot,savedSnapshot);
 assert.equal(JSON.parse(month().reviews[0].snapshot).items[0].filingProgress.summary,"Filing evidence needed");
 assert.match(month().items[0].filingProgress.gaps[0],/Application Owner/);
 assert.equal(first.finding.initialTiming,"On or before recorded deadline");
 assert.match(first.finding.gaps[0],/Application Owner/);
 assert.deepEqual(f.run(firstRequest),first);
 assert.ok(f.run(save(evidence)).error);
 const second = f.run(save({...evidence,attestation:{...attestation,dfsApplicationOwnerReference:"Fictional DFS role"},amendment},1));
 assert.equal(second.version,2);
 assert.deepEqual(second.finding.gaps,[]);
 assert.deepEqual(month().items[0].filingProgress.gaps,[]);
 assert.deepEqual(ownerRow().filing, { summary: month().items[0].filingProgress.summary, gapCount: 0 });
 assert.equal(f.run({...history,before:2}).versions[0].evidence.original.on,"2026-06-22");
 assert.equal(f.run(history).versions[0].evidence.amendment.on,"2026-06-23");
 assert.ok(f.run({...history,entityId:crypto.randomUUID()}).error);
 assert.ok(f.run(history,f.staff,[]).error);
 const third = f.run(save({...evidence,original:{...original,route:"Mail",on:"2026-06-23"}},2));
 assert.equal(third.finding.initialTiming,"After recorded deadline");
 assert.ok(month().items[0].filingProgress.gaps.includes("Review the late initial submission."));
 assert.match(third.finding.gaps[0],/notarized affidavit/);
 const laterPeriod = "2026-01";
 assert.equal(JSON.parse(f.run(f.generate({period:laterPeriod})).occurrence.snapshot).reportingBasis.nominalDueOn,null);
 assert.equal(f.run({...history,period:laterPeriod}).nominalDueOn,null);
 assert.equal(f.run({operation:"occurrences",entityId:f.entityId,id:f.id}).items[0].newYorkVoor,true);
});

test("Michigan reporting receipts remain scoped to the filing component and period", t => {
 const f = fixture(t);
 const scope = complianceCaseWork(f.db, {type:"stateScope",input:{operation:"save",entityId:f.entityId,jurisdiction:"MI",
   expectedRevision:0,requestId:crypto.randomUUID(),facts:{activity:"Brokerage",lienScope:"First lien",
     companyEvidence:"Fictional Michigan license",officeEvidence:"",originatorEvidence:"",products:"",responsibility:"",
     reportingBasis:"",counselPacketReference:""}}},f.staff,f.staff.brokerage.id,[f.actor],"2026-11-11T12:00:00Z");
 assert.equal(scope.revision,1);
 const record = (suffix,cadence,period,annualStartMonth) => {
   const id = crypto.randomUUID();
   const stateReference = {jurisdiction:"MI",revision:1,sourceKey:"REQ-MI-REPORTING-"+suffix};
   const draft = {...f.draft,cadence,annualStartMonth};
   assert.equal(f.run(f.save({id,draft,stateReference})).revision,1);
   assert.equal(f.run(f.generate({id,period})).kind,"obligationOccurrence");
   return {entityId:f.entityId,id,period};
 };
 const activity = record("RMLA","Quarterly","2026-07");
 const financialCondition = record("FC","Annual","2025-01",1);
 const fiscalStatement = record("GAAP","Annual","2025-07",7);
 const history = target => f.run({operation:"michiganFilingHistory",...target});
 const save = (target,evidence,expected=0) => ({operation:"saveMichiganFiling",...target,
   requestId:crypto.randomUUID(),expected,evidence,...(expected ? {correction:"Fictional update to the filing record"} : {})});
 assert.equal(history(activity).nominalDueOn,"2026-11-14");
 assert.equal(history(financialCondition).nominalDueOn,"2026-03-31");
 assert.equal(history(fiscalStatement).nominalDueOn,"2026-09-28");
 assert.ok(history(record("RMLA","Annual","2025-01",1)).error);
 const work = f.run({operation:"planWork",...activity,requestId:crypto.randomUUID()});
 assert.equal(f.progress(work.month).summary,"Filing evidence needed");
 const reconciliation = {reference:"Fictional reconciliation",activity:"No reportable activity"};
 const deadline = {on:"2026-11-14",reference:"Fictional reviewed NMLS deadline"};
 const submission = {on:"2026-11-10",reference:"Fictional original NMLS receipt"};
 const evidence = {deadline,reconciliation,submission};
 assert.ok(f.run(save(financialCondition,evidence)).error);
 assert.ok(f.run(save(activity,{submission:{...submission,on:"2026-09-30"}})).error);
 assert.ok(f.run(save(activity,{submission:{...submission,on:"2026-11-12"}})).error);
 assert.ok(f.run(save(activity,{amendment:{...submission,reason:"Fictional amendment"}})).error);
 const request = save(activity,evidence);
 const saved = f.run(request);
 assert.deepEqual(saved.finding.gaps,[]);
 assert.deepEqual(f.run(request),saved);
 assert.ok(f.run(save(activity,evidence)).error);
 assert.equal(f.progress(work.month).summary,"Receipt by recorded date");
 assert.deepEqual(history(financialCondition).versions,[]);
 assert.deepEqual(history(fiscalStatement).versions,[]);
 const amendment = {on:"2026-11-11",reference:"Fictional amendment receipt",reason:"Fictional workpaper correction"};
 assert.equal(f.run(save(activity,{...evidence,amendment},1)).version,2);
 assert.equal(history(activity).versions[1].evidence.submission.on,"2026-11-10");
 const earlierAmendment = {...amendment,on:"2026-11-10",reference:"Fictional same-day amendment"};
 assert.match(f.run(save(activity,{...evidence,amendments:[amendment,earlierAmendment]},2)).error,/dates and order/);
 assert.match(f.run(save(activity,{...evidence,amendments:[amendment,amendment]},2)).error,/each amendment receipt once/);
 assert.equal(f.run(save(activity,{...evidence,amendments:[earlierAmendment,amendment]},2)).version,3);
 assert.equal(history(activity).versions[0].evidence.amendments.length,2);
 assert.deepEqual(history(activity).versions[1].evidence.amendment,amendment);
 const oldActivity = record("RMLA","Quarterly","2024-07");
 const oldReceipt = {on:"2024-10-15",reference:"Fictional original filing receipt"};
 const cutoffAmendment = {...amendment,on:"2026-09-30"};
 const lateAmendment = {...amendment,on:"2026-10-01"};
 const cutoff = f.run(save(oldActivity,{submission:oldReceipt,amendments:[cutoffAmendment]}));
 assert.ok(!cutoff.finding.gaps.some(gap=>gap.includes("two-year")));
 const late = f.run(save(oldActivity,{submission:oldReceipt,amendments:[cutoffAmendment,lateAmendment]},1));
 assert.ok(late.finding.gaps.some(gap=>gap.includes("two-year")));
 assert.ok(history({...activity,entityId:crypto.randomUUID()}).error);
 assert.ok(f.run({operation:"michiganFilingHistory",...activity},f.staff,[]).error);
 assert.equal(f.run(save(fiscalStatement,{submission:{on:"2026-10-01",reference:"Fictional statement receipt"}})).finding.summary,
   "Receipt after recorded date");
});
