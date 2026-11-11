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
