import type {Store} from "./store";
import type {WorkspaceStaff} from "./staff-store";
import {loanAccess} from "./workspace-access";
import {setClosingChecklistStatus,setDocumentDeadline} from "./deadline-actions";
import {recoveryEditReview,type RecoveryEdit,type RecoveryEditInspection,type RecoveryReplay} from "./recovery-edit-model";
import {inspectRecoveryEdit,readRecoveryState,recordRecoveryProof,validRecoveryProof} from "./recovery-edits";
import {maintenanceAdmin,maintenanceState,maintenanceView,pendingRecoveryReplay,pendingWorkspaceRestore,recordMaintenanceEvent} from "./workspace-maintenance";

export type ReplayReservation={replay:RecoveryReplay;edit:RecoveryEdit};
export type ReplayResult={state:"Applied"|"Not applied";message:string;at:string};
export function recoveryReplay(db:Store,brokerageId:string,cycle:string,editId:string):RecoveryReplay|null {
  return db.prepare("SELECT id,editId,cycle,state,actor,note,at,finishedAt,result FROM brokerage_recovery_replays WHERE brokerageId=? AND cycle=? AND editId=?")
    .get(brokerageId,cycle,editId) as RecoveryReplay|null??null;
}
export function reserveRecoveryReplay(db:Store,staff:WorkspaceStaff,emails:string[],raw:unknown,observed:RecoveryEditInspection["items"][number]) {
  return db.transaction(()=>{
    const input=recoveryEditReview.parse(raw),state=maintenanceState(db,staff.brokerage.id);
    if(!maintenanceAdmin(db,staff,emails)||state.mode!=="Paused"||state.revision!==input.revision||!state.startedAt)
      throw new Error("Maintenance changed. Refresh before recovering this edit.");
    if(observed.id!==input.id||observed.fingerprint!==input.fingerprint||!observed.canReplay||!validRecoveryProof(observed,observed.proof))
      throw new Error("The saved evidence or original revision changed. Inspect this edit again.");
    if(pendingWorkspaceRestore(db,staff.brokerage.id))throw new Error("Resolve the pending workspace restore first.");
    if(pendingRecoveryReplay(db,staff.brokerage.id))throw new Error("Resolve the pending internal recovery first.");
    if(recoveryReplay(db,staff.brokerage.id,state.startedAt,input.id))throw new Error("This edit already has a recovery outcome in this maintenance cycle.");
    const id=crypto.randomUUID(),at=new Date().toISOString();
    db.prepare("INSERT INTO brokerage_recovery_replays VALUES (?,?,?,?, 'Pending',?,?,?,NULL,NULL)")
      .run(id,staff.brokerage.id,input.id,state.startedAt,staff.name,input.note,at);
    recordMaintenanceEvent(db,staff.brokerage.id,{...state,revision:state.revision+1,reviewedAt:null,reviewedBy:null,checks:[false,false,false]},
      "Started internal edit recovery",staff.name,`${observed.label} · ${input.note}`,at);
    return recoveryReplay(db,staff.brokerage.id,state.startedAt,input.id)!;
  });
}
export function finishRecoveryReplay(db:Store,staff:WorkspaceStaff,emails:string[],reservation:ReplayReservation,result:ReplayResult) {
  return db.transaction(()=>{
    const state=maintenanceState(db,staff.brokerage.id),saved=recoveryReplay(db,staff.brokerage.id,reservation.replay.cycle,reservation.edit.id);
    if(!maintenanceAdmin(db,staff,emails)||state.mode!=="Paused"||state.startedAt!==reservation.replay.cycle||saved?.id!==reservation.replay.id)
      throw new Error("Recovery access changed. A current admin must check the pending outcome.");
    if(saved.state==="Pending"){
      db.prepare("UPDATE brokerage_recovery_replays SET state=?,result=?,finishedAt=? WHERE id=? AND state='Pending'")
        .run(result.state,result.message,result.at,saved.id);
      recordMaintenanceEvent(db,staff.brokerage.id,{...state,revision:state.revision+1,reviewedAt:null,reviewedBy:null,checks:[false,false,false]},
        result.state==="Applied"?"Recovered internal edit":"Internal recovery not applied",staff.name,`${reservation.edit.label} · ${result.message}`,result.at);
    }
    return maintenanceView(db,staff.brokerage.id,0);
  });
}
// One synchronous transaction includes the edit, ordinary loan history, original
// edit proof and replay outcome. A lost RPC acknowledgment can safely read it again.
export function applyRecoveryReplay(db:Store,staff:WorkspaceStaff,reservation:ReplayReservation):ReplayResult {
  return db.transaction(()=>{
    const {edit,replay}=reservation;
    // A restored checkpoint can predate this table while still containing the
    // covered edit schema. Create only this recovery receipt table, not normal
    // workspace migrations or background work, inside the recovery transaction.
    db.exec("CREATE TABLE IF NOT EXISTS recovery_replay_proofs (id TEXT PRIMARY KEY,editId TEXT NOT NULL,result TEXT NOT NULL,at TEXT NOT NULL)");
    const prior=db.prepare("SELECT editId,result FROM recovery_replay_proofs WHERE id=?").get(replay.id);
    if(prior){if(prior.editId!==edit.id)throw new Error("Recovery receipt identity differs.");return JSON.parse(String(prior.result)) as ReplayResult;}
    const observed=inspectRecoveryEdit(db,edit),at=new Date().toISOString();
    const {command,proof}=edit;
    let result:ReplayResult={state:"Not applied",message:"The original record revision is no longer available. No change was made.",at};
    if(staff.brokerage.role==="Admin"&&staff.brokerage.pilot&&loanAccess(db,staff,command.loanId)&&observed.canReplay&&proof){
      const changed=command.type==="completeClosingItem"
        ? setClosingChecklistStatus(db,command,at,proof.at)
        : setDocumentDeadline(db,command,staff,at);
      if("error" in changed)throw new Error(changed.error);
      recordRecoveryProof(db,edit,edit.before,readRecoveryState(db,command),proof.at);
      const label=command.type==="completeClosingItem"?"Closing checklist change":"Saved due-date change";
      result={state:"Applied",message:`${label} recovered. Complete a new reopening review.`,at};
    }
    db.prepare("INSERT INTO recovery_replay_proofs VALUES (?,?,?,?)").run(replay.id,edit.id,JSON.stringify(result),at);
    return result;
  });
}
