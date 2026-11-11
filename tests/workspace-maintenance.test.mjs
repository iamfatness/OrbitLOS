import assert from "node:assert/strict";
import {registerHooks} from "node:module";
import {DatabaseSync} from "node:sqlite";
import test from "node:test";
registerHooks({resolve(specifier,context,next){try{return next(specifier,context);}catch(error){
  if(error.code!=="ERR_MODULE_NOT_FOUND"||!specifier.startsWith("./"))throw error;return next(`${specifier}.ts`,context);
}}});
const {initializeBrokerages}=await import("../src/lib/brokerages.ts");
const {initializeMaintenance,maintenanceState,changeMaintenance,markMaintenanceDrained,maintenanceView,recordMaintenanceDecision,maintenanceDecisions}=await import("../src/lib/workspace-maintenance.ts");
const {WorkspaceMaintenanceGate,guardWorkspaceMethods}=await import("../src/lib/workspace-maintenance-gate.ts");
function fixture() {
  const sqlite=new DatabaseSync(":memory:");
  const db={exec:q=>sqlite.exec(q),prepare:q=>sqlite.prepare(q),transaction:run=>{
    sqlite.exec("BEGIN");try{const result=run();sqlite.exec("COMMIT");return result;}catch(error){sqlite.exec("ROLLBACK");throw error;}
  }};
  initializeBrokerages(db);initializeMaintenance(db);
  const id="11111111-1111-4111-8111-111111111111",name="Fictional Maintenance QA";
  db.prepare("INSERT INTO brokerages VALUES (?,?,1)").run(id,name);
  db.prepare("INSERT INTO brokerage_members (brokerageId,email,name,role,status,accessRevision) VALUES (?,'owner@example.test','Owner','Admin','Active',2)").run(id);
  const staff={email:"owner@example.test",name:"Owner",brokerage:{id,name,role:"Admin",pilot:true,accessRevision:2}};
  return {db,staff,close:()=>sqlite.close()};
}
test("maintenance requires current admin, exact workspace and a completed review",()=>{
  const {db,staff,close}=fixture();try{
    const pause={type:"pause",revision:0,reason:"Investigate fictional missing document.",confirmation:staff.brokerage.name};
    for (const actor of [{...staff,email:"other@example.test"},{...staff,brokerage:{...staff.brokerage,role:"LO"}},
      {...staff,brokerage:{...staff.brokerage,accessRevision:1}}, {...staff,brokerage:{...staff.brokerage,id:"other"}}]) {
      assert.ok(changeMaintenance(db,actor,[],pause).error);
    }
    assert.ok(changeMaintenance(db,staff,[],{...pause,confirmation:"wrong"}).error);
    assert.equal(changeMaintenance(db,staff,[],pause).state.mode,"Pausing");
    assert.ok(changeMaintenance(db,staff,[],pause).error);
    assert.ok(changeMaintenance(db,staff,[],{type:"review",revision:1,review:"Checked all evidence.",checks:[true,true,true]}).error);
    assert.equal(markMaintenanceDrained(db,staff.brokerage.id,0).mode,"Pausing");
    assert.equal(markMaintenanceDrained(db,staff.brokerage.id,1).mode,"Paused");
    const id=staff.brokerage.id,cycle=maintenanceState(db,id).startedAt;
    const review={type:"review",revision:2,review:"Checked all evidence.",checks:[true,true,true]};
    db.prepare("INSERT INTO brokerage_restore_jobs VALUES ('restore',?,?,?,?,'Requested','Owner','owner@example.test','Fixture','digest',?,NULL,'Reserved',NULL)")
      .run(id,"target","source",cycle,cycle);
    assert.equal(maintenanceView(db,id,0).pendingRestore,true);
    assert.match(changeMaintenance(db,staff,[],review).error,/pending workspace restore/);
    db.prepare("UPDATE brokerage_restore_jobs SET state='Restored'").run();
    assert.equal(maintenanceView(db,id,0).pendingRestore,false);
    db.prepare("INSERT INTO brokerage_recovery_replays VALUES ('replay',?,'edit',?,'Pending','Owner','Fixture',?,NULL,NULL)").run(id,cycle,cycle);
    assert.equal(maintenanceView(db,id,0).pendingEditRecovery,true);
    assert.match(changeMaintenance(db,staff,[],review).error,/pending internal edit recovery/);
    db.prepare("UPDATE brokerage_recovery_replays SET state='Applied'").run();
    assert.equal(maintenanceView(db,id,0).pendingEditRecovery,false);
    assert.ok(changeMaintenance(db,staff,[],{type:"reopen",revision:2,confirmation:staff.brokerage.name}).error);
    assert.ok(changeMaintenance(db,staff,[],{type:"review",revision:2,review:"Missing provider evidence.",checks:[true,false,true]}).error);
    assert.equal(changeMaintenance(db,staff,[],{type:"review",revision:2,review:"Reviewed fictional work, access and mock requests.",checks:[true,true,true]}).state.revision,3);
    assert.ok(changeMaintenance(db,staff,[],{type:"reopen",revision:2,confirmation:staff.brokerage.name}).error);
    assert.equal(changeMaintenance(db,staff,[],{type:"reopen",revision:3,confirmation:staff.brokerage.name}).state.mode,"Open");
    assert.equal(maintenanceView(db,staff.brokerage.id,0).history.length,4);
    assert.equal(changeMaintenance(db,staff,[],{...pause,revision:4}).state.reviewedAt,null);
    assert.deepEqual(maintenanceState(db,staff.brokerage.id).checks,[false,false,false]);
  }finally{close();}
});
test("live brokerages and revoked admins cannot operate pilot maintenance",()=>{
  const {db,staff,close}=fixture();try{
    const pause={type:"pause",revision:0,reason:"Test maintenance controls.",confirmation:staff.brokerage.name};
    db.prepare("UPDATE brokerages SET pilot=0 WHERE id=?").run(staff.brokerage.id);
    assert.ok(changeMaintenance(db,staff,[],pause).error);
    db.prepare("UPDATE brokerages SET pilot=1 WHERE id=?").run(staff.brokerage.id);
    db.prepare("UPDATE brokerage_members SET status='Revoked'").run();
    assert.ok(changeMaintenance(db,staff,[],pause).error);
  }finally{close();}
});
test("pause refuses new methods while allowing a started promise to finish",async()=>{
  const gate=new WorkspaceMaintenanceGate();gate.apply(0,false);
  let finish;
  const pending=gate.run(()=>new Promise(resolve=>{finish=resolve;}));
  assert.equal(gate.active,1);gate.apply(1,true);
  assert.throws(()=>gate.run(()=>"unexpected"),/paused/);
  finish("saved");assert.equal(await pending,"saved");assert.equal(gate.active,0);
  gate.apply(0,false);assert.equal(gate.closed,true);
  gate.apply(2,false);assert.equal(gate.run(()=>"open"),"open");
  await assert.rejects(gate.run(()=>Promise.reject(new Error("failed"))),/failed/);assert.equal(gate.active,0);
  assert.throws(()=>gate.run(()=>{throw new Error("failed sync");}),/failed sync/);assert.equal(gate.active,0);
});
test("service guard covers inherited public calls and newly added methods",async()=>{
  class Workspace{read(){return "read";}futureWrite(){return "write";}async asyncWrite(){return "saved";}control(){return "control";}}
  class Derived extends Workspace{}
  const gate=new WorkspaceMaintenanceGate();
  guardWorkspaceMethods(Workspace.prototype,()=>gate,new Set(["control"]));
  const instance=new Derived();
  assert.throws(()=>instance.read(),/paused/);assert.throws(()=>instance.futureWrite(),/paused/);
  await assert.rejects(instance.asyncWrite(),/paused/);
  assert.equal(instance.control(),"control");gate.apply(0,false);assert.equal(instance.read(),"read");
});


test("inspection decisions are versioned, idempotent, and invalidate the prior reopening sign-off",()=>{
  const {db,staff,close}=fixture();try{
    changeMaintenance(db,staff,[],{type:"pause",revision:0,reason:"Fictional decision acceptance.",confirmation:staff.brokerage.name});
    markMaintenanceDrained(db,staff.brokerage.id,1);
    changeMaintenance(db,staff,[],{type:"review",revision:2,review:"Previous opening review.",checks:[true,true,true]});
    const input={id:crypto.randomUUID(),revision:3,documents:0,requests:0,reference:"accepted:fixture:2",fingerprint:"a".repeat(64),
      outcome:"Known sample limitation",note:"Older fictional sample has no retained PDF; no borrower upload or lender action occurred."};
    assert.ok(recordMaintenanceDecision(db,staff,[],input,"b".repeat(64)).error);
    const saved=recordMaintenanceDecision(db,staff,[],input,input.fingerprint);assert.equal(saved.decision.note,input.note);
    assert.equal(maintenanceState(db,staff.brokerage.id).reviewedAt,null);
    assert.deepEqual(maintenanceState(db,staff.brokerage.id).checks,[false,false,false]);
    assert.equal(maintenanceState(db,staff.brokerage.id).revision,4);
    assert.deepEqual(recordMaintenanceDecision(db,staff,[],input,input.fingerprint),saved);
    assert.equal(maintenanceState(db,staff.brokerage.id).revision,4);
    assert.ok(recordMaintenanceDecision(db,staff,[],{...input,note:"Changed payload under an existing decision reference."},input.fingerprint).error);
    assert.ok(recordMaintenanceDecision(db,staff,[],{...input,id:crypto.randomUUID()},input.fingerprint).error);
    const cycle=maintenanceState(db,staff.brokerage.id).startedAt;
    assert.equal(maintenanceDecisions(db,staff.brokerage.id,cycle,[input.reference]).length,1);
    assert.equal(maintenanceDecisions(db,"other",cycle,[input.reference]).length,0);
    assert.equal(maintenanceDecisions(db,staff.brokerage.id,"earlier-cycle",[input.reference]).length,0);
    assert.ok(changeMaintenance(db,staff,[],{type:"reopen",revision:4,confirmation:staff.brokerage.name}).error);
    const updated=recordMaintenanceDecision(db,staff,[],{...input,id:crypto.randomUUID(),revision:4,outcome:"Preserve observed result",note:"Compared the retained sample evidence; preserving the observed state without a retry."},input.fingerprint);
    assert.ok(updated.decision);
    const history=maintenanceDecisions(db,staff.brokerage.id,cycle,[input.reference]);
    assert.equal(history[0].id,updated.decision.id);assert.equal(history.length,2);
    db.prepare("UPDATE brokerage_members SET status='Revoked'").run();
    assert.ok(recordMaintenanceDecision(db,staff,[],input,input.fingerprint).error);
  }finally{close();}
});
