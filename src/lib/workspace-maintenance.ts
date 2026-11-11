import { createHash } from "node:crypto";
import {recoveryEditReview,type RecoveryEditInspection} from "./recovery-edit-model";
import {validRecoveryProof} from "./recovery-edits";
import { maintenanceDecisionInput, type InspectionDecision, type MaintenanceDecisionInput } from "./maintenance-inspection-model";
import type { Store } from "./store";
import type { WorkspaceStaff } from "./staff-store";
import { activeBrokerages } from "./brokerages";
import { demoBrokerageId } from "./brokerage-model";
import { maintenanceInput, type MaintenanceState, type MaintenanceView } from "./workspace-maintenance-model";

export function initializeMaintenance(db: Store) {
  db.exec(`CREATE TABLE IF NOT EXISTS brokerage_restore_jobs (
    id TEXT PRIMARY KEY,brokerageId TEXT NOT NULL,checkpointId TEXT NOT NULL,sourceCheckpointId TEXT NOT NULL,cycle TEXT NOT NULL,state TEXT NOT NULL,
    actor TEXT NOT NULL,actorEmail TEXT NOT NULL,note TEXT NOT NULL,commandDigest TEXT NOT NULL,at TEXT NOT NULL,finishedAt TEXT,message TEXT NOT NULL,undoBookmark TEXT
  ); CREATE UNIQUE INDEX IF NOT EXISTS workspace_restore_pending ON brokerage_restore_jobs(brokerageId) WHERE state!='Restored';
  CREATE TABLE IF NOT EXISTS brokerage_recovery_replays (
    id TEXT PRIMARY KEY,brokerageId TEXT NOT NULL,editId TEXT NOT NULL,cycle TEXT NOT NULL,state TEXT NOT NULL,
    actor TEXT NOT NULL,note TEXT NOT NULL,at TEXT NOT NULL,finishedAt TEXT,result TEXT
  ); CREATE UNIQUE INDEX IF NOT EXISTS recovery_replay_cycle ON brokerage_recovery_replays(brokerageId,cycle,editId);
  CREATE UNIQUE INDEX IF NOT EXISTS recovery_replay_pending ON brokerage_recovery_replays(brokerageId) WHERE state='Pending';
  CREATE TABLE IF NOT EXISTS brokerage_maintenance (
    brokerageId TEXT PRIMARY KEY REFERENCES brokerages(id), mode TEXT NOT NULL, revision INTEGER NOT NULL,
    reason TEXT NOT NULL, startedAt TEXT, startedBy TEXT, reviewedAt TEXT, reviewedBy TEXT, review TEXT NOT NULL, checks TEXT NOT NULL
  ); CREATE TABLE IF NOT EXISTS brokerage_maintenance_history (
    id TEXT PRIMARY KEY, brokerageId TEXT NOT NULL REFERENCES brokerages(id), action TEXT NOT NULL, actor TEXT NOT NULL, at TEXT NOT NULL, note TEXT NOT NULL
  ); CREATE TABLE IF NOT EXISTS brokerage_maintenance_decisions (
    id TEXT PRIMARY KEY, brokerageId TEXT NOT NULL REFERENCES brokerages(id), cycle TEXT NOT NULL,
    reference TEXT NOT NULL, fingerprint TEXT NOT NULL, outcome TEXT NOT NULL, note TEXT NOT NULL,
    actor TEXT NOT NULL, actorEmail TEXT NOT NULL, at TEXT NOT NULL, commandDigest TEXT NOT NULL
  ); CREATE INDEX IF NOT EXISTS maintenance_decisions_reference ON brokerage_maintenance_decisions(brokerageId,cycle,reference,at DESC,id DESC);
  CREATE INDEX IF NOT EXISTS brokerage_maintenance_history_recent ON brokerage_maintenance_history(brokerageId,at DESC,id DESC);`);
}
export function maintenanceState(db: Store, id: string): MaintenanceState {
  const row = db.prepare("SELECT * FROM brokerage_maintenance WHERE brokerageId = ?").get(id);
  return row ? {mode:row.mode as MaintenanceState["mode"],revision:Number(row.revision),reason:String(row.reason),
    startedAt:row.startedAt as string|null,startedBy:row.startedBy as string|null,reviewedAt:row.reviewedAt as string|null,
    reviewedBy:row.reviewedBy as string|null,review:String(row.review),checks:JSON.parse(String(row.checks))} :
    {mode:"Open",revision:0,reason:"",startedAt:null,startedBy:null,reviewedAt:null,reviewedBy:null,review:"",checks:[false,false,false]};
}
export function maintenanceAdmin(db: Store, staff: WorkspaceStaff, emails: string[]) {
  const current=activeBrokerages(db,staff.email,emails).find(row=>row.id===staff.brokerage.id);
  return !!current && current.id!==demoBrokerageId && current.pilot===true && current.role==="Admin" &&
    staff.brokerage.role==="Admin" && current.accessRevision===staff.brokerage.accessRevision;
}
export function maintenanceView(db: Store, id: string, active: number): MaintenanceView {
  return {...maintenanceState(db,id),active,pendingRestore:pendingWorkspaceRestore(db,id),pendingEditRecovery:pendingRecoveryReplay(db,id),history:db.prepare(
    "SELECT action,actor,at,note FROM brokerage_maintenance_history WHERE brokerageId = ? ORDER BY at DESC,id DESC LIMIT 20"
  ).all(id) as unknown as MaintenanceView["history"]};
}
export function recordMaintenanceEvent(db: Store,id: string,state: MaintenanceState,action: string,actor: string,note: string,at: string) {
  db.prepare(`INSERT INTO brokerage_maintenance VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(brokerageId) DO UPDATE SET
    mode=excluded.mode,revision=excluded.revision,reason=excluded.reason,startedAt=excluded.startedAt,startedBy=excluded.startedBy,
    reviewedAt=excluded.reviewedAt,reviewedBy=excluded.reviewedBy,review=excluded.review,checks=excluded.checks`)
    .run(id,state.mode,state.revision,state.reason,state.startedAt,state.startedBy,state.reviewedAt,state.reviewedBy,state.review,JSON.stringify(state.checks));
  db.prepare("INSERT INTO brokerage_maintenance_history VALUES (?,?,?,?,?,?)").run(crypto.randomUUID(),id,action,actor,at,note);
}
export function changeMaintenance(db: Store, staff: WorkspaceStaff, emails: string[], input: unknown, now=new Date().toISOString()) {
  return db.transaction(()=>{
    if (!maintenanceAdmin(db,staff,emails)) return {error:"Only an active pilot workspace admin can manage maintenance."};
    const parsed=maintenanceInput.safeParse(input);
    if (!parsed.success) return {error:"Complete the maintenance fields and required checks."};
    const data=parsed.data,id=staff.brokerage.id,state=maintenanceState(db,id);
    if(pendingWorkspaceRestore(db,id))return {error:"Check the pending workspace restore before reviewing or reopening."};
    if(data.type!=="pause"&&pendingRecoveryReplay(db,id))return {error:"Resolve the pending internal edit recovery before reviewing or reopening."};
    if(data.revision!==state.revision) return {error:"Maintenance changed. Refresh its status before continuing."};
    const name=db.prepare("SELECT name FROM brokerages WHERE id = ?").get(id)?.name;
    if ("confirmation" in data && data.confirmation!==name) return {error:"Enter this brokerage’s exact name to confirm."};
    if(data.type==="pause") {
      if(state.mode!=="Open") return {error:"This workspace is already in maintenance. Refresh its status."};
      recordMaintenanceEvent(db,id,{...state,mode:"Pausing",revision:state.revision+1,reason:data.reason,startedAt:now,startedBy:staff.name,
        reviewedAt:null,reviewedBy:null,review:"",checks:[false,false,false]},"Started maintenance",staff.name,data.reason,now);
    } else if(data.type==="review") {
      if(state.mode!=="Paused") return {error:"Wait for active work to finish before recording the review."};
      recordMaintenanceEvent(db,id,{...state,revision:state.revision+1,reviewedAt:now,reviewedBy:staff.name,review:data.review,checks:data.checks},
        "Recorded reopening review",staff.name,data.review,now);
    } else {
      if(state.mode!=="Paused" || !state.reviewedAt || !state.checks.every(Boolean)) return {error:"Complete the reopening review before reopening the workspace."};
      recordMaintenanceEvent(db,id,{...state,mode:"Open",revision:state.revision+1},"Reopened workspace",staff.name,state.review,now);
    }
    return {state:maintenanceState(db,id)};
  });
}
export function markMaintenanceDrained(db: Store,id: string,revision: number) {
  return db.transaction(()=>{
    const state=maintenanceState(db,id);
    if(state.mode==="Pausing" && state.revision===revision) {
      recordMaintenanceEvent(db,id,{...state,mode:"Paused",revision:revision+1},"Workspace paused","Orbit","No active workspace requests remain. Review interrupted or unresolved requests before reopening.",new Date().toISOString());
    }
    return maintenanceState(db,id);
  });
}


const decisionDigest=(input:MaintenanceDecisionInput)=>createHash("sha256").update(JSON.stringify(input)).digest("hex");
export function maintenanceDecisions(db:Store,id:string,cycle:string,references:string[]) {
  return references.flatMap(reference=>db.prepare(`SELECT id,reference,fingerprint,outcome,note,actor,at FROM brokerage_maintenance_decisions
    WHERE brokerageId=? AND cycle=? AND reference=? ORDER BY rowid DESC LIMIT 5`).all(id,cycle,reference)) as InspectionDecision[];
}
export function priorMaintenanceDecision(db:Store,staff:WorkspaceStaff,input:MaintenanceDecisionInput):{error:string}|{decision:InspectionDecision}|null {
  const row=db.prepare("SELECT * FROM brokerage_maintenance_decisions WHERE id=?").get(input.id);
  if(!row)return null;
  const state=maintenanceState(db,staff.brokerage.id);
  if(row.brokerageId!==staff.brokerage.id || row.actorEmail!==staff.email || row.cycle!==state.startedAt ||
    row.commandDigest!==decisionDigest(input))return {error:"This decision reference belongs to a different review."};
  const {id,reference,fingerprint,outcome,note,actor,at}=row;
  return {decision:{id,reference,fingerprint,outcome,note,actor,at} as InspectionDecision};
}
export function recordMaintenanceDecision(db:Store,staff:WorkspaceStaff,emails:string[],raw:unknown,observedFingerprint:string,now=new Date().toISOString()):{error:string}|{decision:InspectionDecision} {
  return db.transaction(()=>{
    if(!maintenanceAdmin(db,staff,emails))return {error:"Only a current pilot admin can record inspection decisions."};
    const parsed=maintenanceDecisionInput.safeParse(raw);
    if(!parsed.success)return {error:"Choose an outcome and describe the evidence you reviewed."};
    const input=parsed.data,state=maintenanceState(db,staff.brokerage.id);
    if(state.mode!=="Paused" || !state.startedAt)return {error:"Pause and inspect the workspace before recording a decision."};
    if(pendingWorkspaceRestore(db,staff.brokerage.id))return {error:"Resolve the pending workspace restore first."};
    const prior=priorMaintenanceDecision(db,staff,input);if(prior)return prior;
    if(state.revision!==input.revision)return {error:"Maintenance changed. Refresh before recording your decision."};
    if(observedFingerprint!==input.fingerprint)return {error:"The inspected evidence changed. Inspect it again before deciding."};
    db.prepare("INSERT INTO brokerage_maintenance_decisions (id,brokerageId,cycle,reference,fingerprint,outcome,note,actor,actorEmail,at,commandDigest) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(input.id,staff.brokerage.id,state.startedAt,
      input.reference,input.fingerprint,input.outcome,input.note,staff.name,staff.email,now,decisionDigest(input));
    recordMaintenanceEvent(db,staff.brokerage.id,{...state,revision:state.revision+1,reviewedAt:null,reviewedBy:null,checks:[false,false,false]},
      "Recorded inspection decision",staff.name,`${input.reference} · ${input.outcome} · ${input.note}`,now);
    return {decision:{id:input.id,reference:input.reference,fingerprint:input.fingerprint,outcome:input.outcome,note:input.note,actor:staff.name,at:now}};
  });
}

export function recordRecoveryEditReview(db:Store,staff:WorkspaceStaff,emails:string[],raw:unknown,observed:RecoveryEditInspection["items"][number],now=new Date().toISOString()) {
  return db.transaction(()=>{
    const input=recoveryEditReview.parse(raw),state=maintenanceState(db,staff.brokerage.id);
    if(pendingWorkspaceRestore(db,staff.brokerage.id))throw new Error("Resolve the pending workspace restore first.");
    if(!maintenanceAdmin(db,staff,emails)||state.mode!=="Paused"||state.revision!==input.revision)
      throw new Error("Maintenance changed. Refresh before reviewing this edit.");
    if(observed.id!==input.id || observed.fingerprint!==input.fingerprint || !observed.canConfirm || !validRecoveryProof(observed,observed.sourceProof))
      throw new Error("This edit has no matching saved proof. Inspect it again; do not assume it completed.");
    const row=db.prepare("SELECT state FROM brokerage_recovery_edits WHERE id=? AND brokerageId=?").get(input.id,staff.brokerage.id);
    if(row?.state!=="Pending")throw new Error("The receipt changed. Refresh the edit inspection.");
    db.prepare("UPDATE brokerage_recovery_edits SET state='Reviewed',proof=?,reviewNote=?,reviewer=?,reviewedAt=? WHERE id=? AND brokerageId=?")
      .run(JSON.stringify(observed.sourceProof),input.note,staff.name,now,input.id,staff.brokerage.id);
    recordMaintenanceEvent(db,staff.brokerage.id,{...state,revision:state.revision+1,reviewedAt:null,reviewedBy:null,checks:[false,false,false]},
      "Verified internal edit",staff.name,`${observed.label} · ${input.note}`,now);
    return maintenanceView(db,staff.brokerage.id,0);
  });
}

export function pendingRecoveryReplay(db:Store,id:string) {return !!db.prepare("SELECT id FROM brokerage_recovery_replays WHERE brokerageId=? AND state='Pending' LIMIT 1").get(id);}

export function pendingWorkspaceRestore(db:Store,id:string){return !!db.prepare("SELECT id FROM brokerage_restore_jobs WHERE brokerageId=? AND state!='Restored' LIMIT 1").get(id);}
