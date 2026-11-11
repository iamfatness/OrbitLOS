import assert from "node:assert/strict";
import {registerHooks} from "node:module";
import {DatabaseSync} from "node:sqlite";
import test from "node:test";
registerHooks({resolve(specifier,context,next){try{return next(specifier,context);}catch(error){
  if(error.code!=="ERR_MODULE_NOT_FOUND"||!specifier.startsWith("./"))throw error;return next(`${specifier}.ts`,context);
}}});
const {initializeBrokerages}=await import("../src/lib/brokerages.ts");
const {initializeMaintenance,changeMaintenance,markMaintenanceDrained,maintenanceState,recordRecoveryEditReview}=await import("../src/lib/workspace-maintenance.ts");
const {initializeRecoveryEdits,beginRecoveryEdit,finishRecoveryEdit,recordRecoveryProof,readRecoveryProof,inspectRecoveryEdit,recoveryEditRows}=await import("../src/lib/recovery-edits.ts");
const {expectedRecoveryDocument}=await import("../src/lib/recovery-edit-model.ts");
function fixture(){
  const sqlite=new DatabaseSync(":memory:");
  const db={exec:q=>sqlite.exec(q),prepare:q=>sqlite.prepare(q),transaction:run=>{
    sqlite.exec("BEGIN");try{const value=run();sqlite.exec("COMMIT");return value;}catch(error){sqlite.exec("ROLLBACK");throw error;}
  }};
  initializeBrokerages(db);initializeMaintenance(db);initializeRecoveryEdits(db,true);
  db.exec("CREATE TABLE document_requests (id TEXT PRIMARY KEY,loanId TEXT,revision INTEGER,deadlineRevision INTEGER,dueOn TEXT,status TEXT)");
  const id=crypto.randomUUID();db.prepare("INSERT INTO brokerages VALUES (?, 'Fictional Recovery', 1)").run(id);
  db.prepare("INSERT INTO brokerage_members(brokerageId,email,name,role,status,accessRevision) VALUES (?,'owner@example.test','Owner','Admin','Active',1)").run(id);
  const staff={email:"owner@example.test",name:"Owner",brokerage:{id,name:"Fictional Recovery",role:"Admin",pilot:true,accessRevision:1}};
  const before={id:crypto.randomUUID(),revision:2,deadlineRevision:3,dueOn:"2030-01-01",status:"Requested"};
  const intent={recordName:"Fictional borrower",label:"Pay stub",before,command:{type:"setDocumentDeadline",loanId:crypto.randomUUID(),requestId:before.id,revision:2,deadlineRevision:3,dueOn:"2030-02-01"}};
  db.prepare("INSERT INTO document_requests VALUES (?,?,?,?,?,?)").run(before.id,intent.command.loanId,before.revision,before.deadlineRevision,before.dueOn,before.status);
  return {db,staff,intent,close:()=>sqlite.close()};
}
test("intent remains pending without atomic proof; matching current values alone cannot confirm it",()=>{
  const {db,staff,intent,close}=fixture();try{
    const edit=beginRecoveryEdit(db,staff,[],intent);
    assert.equal(edit.state,"Pending");assert.equal(inspectRecoveryEdit(db,edit).finding,"Original revision present");
    db.prepare("UPDATE document_requests SET deadlineRevision=4,dueOn='2030-02-01'").run();
    const observed=inspectRecoveryEdit(db,edit);assert.equal(observed.finding,"Saved revision present");assert.equal(observed.canConfirm,false);
    finishRecoveryEdit(db,staff,[],edit.id,null,false);assert.equal(recoveryEditRows(db,staff.brokerage.id,0).items[0].state,"Pending");
    assert.equal(recoveryEditRows(db,crypto.randomUUID(),0).total,0);
  }finally{close();}
});
test("atomic proof rolls back with the change and later confirms only its recorded intent",()=>{
  const {db,staff,intent,close}=fixture();try{
    const edit=beginRecoveryEdit(db,staff,[],intent),after=expectedRecoveryDocument(intent),at=new Date().toISOString();
    assert.throws(()=>db.transaction(()=>{db.prepare("UPDATE document_requests SET deadlineRevision=4,dueOn='2030-02-01'").run();
      recordRecoveryProof(db,edit,intent.before,after,at);throw Error("rollback");}),/rollback/);
    assert.equal(readRecoveryProof(db,edit.id),null);assert.equal(inspectRecoveryEdit(db,edit).finding,"Original revision present");
    db.transaction(()=>{db.prepare("UPDATE document_requests SET deadlineRevision=4,dueOn='2030-02-01'").run();recordRecoveryProof(db,edit,intent.before,after,at);});
    const proof=readRecoveryProof(db,edit.id);assert.equal(inspectRecoveryEdit(db,edit).canConfirm,true);
    assert.throws(()=>finishRecoveryEdit(db,staff,[],edit.id,{...proof,after:{...after,dueOn:"2030-03-01"}},false),/differs/);
    finishRecoveryEdit(db,staff,[],edit.id,proof,false);finishRecoveryEdit(db,staff,[],edit.id,proof,false);
    assert.equal(recoveryEditRows(db,staff.brokerage.id,0).items[0].state,"Recorded");
    assert.equal(recoveryEditRows(db,staff.brokerage.id,0,true).total,0);
  }finally{close();}
});
test("paused owner review verifies source proof and invalidates reopening; stale and revoked reviewers fail",()=>{
  const {db,staff,intent,close}=fixture();try{
    const edit=beginRecoveryEdit(db,staff,[],intent),after=expectedRecoveryDocument(intent);
    db.transaction(()=>{db.prepare("UPDATE document_requests SET deadlineRevision=4,dueOn='2030-02-01'").run();recordRecoveryProof(db,edit,intent.before,after,new Date().toISOString());});
    changeMaintenance(db,staff,[],{type:"pause",revision:0,reason:"Review a fictional interrupted edit.",confirmation:staff.brokerage.name});markMaintenanceDrained(db,staff.brokerage.id,1);
    changeMaintenance(db,staff,[],{type:"review",revision:2,review:"Earlier reopening review.",checks:[true,true,true]});
    const observed=inspectRecoveryEdit(db,edit),input={revision:3,offset:0,id:edit.id,fingerprint:observed.fingerprint,note:"Verified the atomic receipt and preserved the recorded edit without applying it again."};
    assert.throws(()=>recordRecoveryEditReview(db,staff,[],{...input,fingerprint:"0".repeat(64)},observed),/matching saved proof/);
    assert.throws(()=>recordRecoveryEditReview(db,{...staff,brokerage:{...staff.brokerage,role:"LO"}},[],input,observed),/Maintenance changed/);
    const view=recordRecoveryEditReview(db,staff,[],input,observed);assert.equal(view.revision,4);assert.equal(view.reviewedAt,null);assert.deepEqual(view.checks,[false,false,false]);
    assert.equal(recoveryEditRows(db,staff.brokerage.id,0).items[0].state,"Reviewed");
    assert.throws(()=>recordRecoveryEditReview(db,staff,[],input,observed),/Maintenance changed/);
    assert.equal(maintenanceState(db,staff.brokerage.id).revision,4);
    db.prepare("UPDATE brokerage_members SET status='Revoked'").run();assert.throws(()=>beginRecoveryEdit(db,staff,[],intent),/access changed/);
  }finally{close();}
});

const {reserveRecoveryReplay,applyRecoveryReplay,finishRecoveryReplay,recoveryReplay}=await import("../src/lib/recovery-replay.ts");
function replayFixture(){
  const f=fixture(),{db,staff,intent}=f;
  db.exec("ALTER TABLE document_requests ADD COLUMN kind TEXT DEFAULT 'Pay stub'");
  db.exec("CREATE TABLE loans(id TEXT PRIMARY KEY,officerEmail TEXT); CREATE TABLE activity(id TEXT,loanId TEXT,text TEXT,createdAt TEXT); CREATE TABLE workspace_access_history(id TEXT,email TEXT,action TEXT,subject TEXT,createdAt TEXT)");
  db.prepare("INSERT INTO loans VALUES (?,?)").run(intent.command.loanId,staff.email);
  const edit=beginRecoveryEdit(db,staff,[],intent),proof={id:edit.id,before:intent.before,after:expectedRecoveryDocument(intent),at:new Date().toISOString()};
  finishRecoveryEdit(db,staff,[],edit.id,proof,false);
  const confirmed=recoveryEditRows(db,staff.brokerage.id,0).items[0];
  changeMaintenance(db,staff,[],{type:"pause",revision:0,reason:"Recover a fictional checkpoint.",confirmation:staff.brokerage.name});markMaintenanceDrained(db,staff.brokerage.id,1);
  const observed=inspectRecoveryEdit(db,confirmed),input={id:edit.id,revision:2,offset:0,fingerprint:observed.fingerprint,note:"Recover only the confirmed due-date edit from its original revision."};
  return {...f,edit:confirmed,observed,input};
}
test("controlled replay blocks reopening while pending and retries the exact atomic outcome without duplicate history",()=>{
  const {db,staff,edit,observed,input,close}=replayFixture();try{
    assert.equal(observed.canReplay,true);
    assert.throws(()=>reserveRecoveryReplay(db,staff,[],{...input,fingerprint:"0".repeat(64)},observed),/evidence/);
    const replay=reserveRecoveryReplay(db,staff,[],input,observed),reservation={replay,edit};
    const state=maintenanceState(db,staff.brokerage.id);assert.equal(state.reviewedAt,null);
    assert.match(changeMaintenance(db,staff,[],{type:"review",revision:state.revision,review:"Cannot review pending work",checks:[true,true,true]}).error,/pending/);
    assert.match(changeMaintenance(db,staff,[],{type:"reopen",revision:state.revision,confirmation:staff.brokerage.name}).error,/pending/);
    db.exec("DROP TABLE recovery_replay_proofs"); // checkpoint from the prior receipt-only release
    const first=applyRecoveryReplay(db,staff,reservation);assert.equal(first.state,"Applied");
    assert.equal(db.prepare("SELECT count(*) AS n FROM activity").get().n,1);
    assert.deepEqual(applyRecoveryReplay(db,staff,reservation),first);
    assert.equal(db.prepare("SELECT count(*) AS n FROM activity").get().n,1);
    const view=finishRecoveryReplay(db,staff,[],reservation,first);assert.equal(view.reviewedAt,null);
    const repeated=finishRecoveryReplay(db,staff,[],reservation,first);assert.deepEqual(repeated,view);
    assert.equal(recoveryReplay(db,staff.brokerage.id,replay.cycle,edit.id).state,"Applied");
    assert.equal(inspectRecoveryEdit(db,edit).canReplay,false);
  }finally{close();}
});
test("replay refuses changed original records, uncertain receipts and non-admin reservations",()=>{
  const {db,staff,edit,observed,input,close}=replayFixture();try{
    const lo={...staff,brokerage:{...staff.brokerage,role:"LO"}};
    assert.throws(()=>reserveRecoveryReplay(db,lo,[],input,observed),/Maintenance changed/);
    assert.equal(inspectRecoveryEdit(db,{...edit,state:"Pending",proof:null}).canReplay,false);
    const replay=reserveRecoveryReplay(db,staff,[],input,observed);
    db.exec("UPDATE document_requests SET dueOn='2030-04-01',deadlineRevision=5");
    const result=applyRecoveryReplay(db,staff,{replay,edit});assert.equal(result.state,"Not applied");
    assert.equal(db.prepare("SELECT count(*) AS n FROM activity").get().n,0);
    db.prepare("UPDATE brokerage_members SET status='Revoked'").run();
    assert.throws(()=>finishRecoveryReplay(db,staff,[],{replay,edit},result),/access changed/);
    assert.equal(recoveryReplay(db,staff.brokerage.id,replay.cycle,edit.id).state,"Pending");
  }finally{close();}
});
