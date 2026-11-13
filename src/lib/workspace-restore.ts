import {createHash} from "node:crypto";
import type {Store} from "./store";
import type {WorkspaceStaff} from "./staff-store";
import type {CheckpointManifest} from "./recovery-checkpoint-model";
import {checkpointAccess,compareCheckpoint,persistCheckpoint,readCheckpointManifest} from "./recovery-checkpoints";
import {maintenanceAdmin,maintenanceState,pendingWorkspaceRestore,recordMaintenanceEvent} from "./workspace-maintenance";
import {restoreStartInput,type RestoreStartInput,type RestoreJob,type RestorePreview} from "./workspace-restore-model";

const hash=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
// Alarm timing is rebuilt during reviewed reopening, not used as restore proof.
export function restoreStateHash(manifest:CheckpointManifest){return hash({version:manifest.version,schema:manifest.schema,tables:manifest.tables,kv:manifest.kv});}
export function restoreSourceMatches(before:CheckpointManifest,current:CheckpointManifest){return restoreStateHash(before)===restoreStateHash(current)&&hash(before.files)===hash(current.files);}
export function restoreFingerprint(id:string,before:CheckpointManifest,current:CheckpointManifest){return hash([id,restoreStateHash(before),restoreStateHash(current),before.files,current.files]);}
export function processorRestoreBlockers(before: CheckpointManifest, current: CheckpointManifest) {
  const changed = (table: string) => before.tables.find(({ name }) => name === table)?.digest !==
    current.tables.find(({ name }) => name === table)?.digest;
  const accessChanged = before.processorAccessDigest && current.processorAccessDigest
    ? before.processorAccessDigest !== current.processorAccessDigest : changed("loan_processing");
  const blockers: string[] = [];
  if (accessChanged) blockers.push("This checkpoint may change who has processor access. Choose a checkpoint that preserves the current assignments.");
  if (changed("processor_assignment_receipts")) blockers.push("Processor assignment receipts changed. Choose a checkpoint that retains those receipts.");
  return blockers;
}

export function restoreBlockers(before:CheckpointManifest,current:CheckpointManifest){
  const result:string[]=[];
  if(!before.impact||!before.files)result.push("This checkpoint predates record or document recovery evidence. Save a new checkpoint.");
  if(before.schema!==current.schema)result.push("Database structure changed. This checkpoint requires a separate migration and recovery review.");
  const previous=new Map(before.tables.map(item=>[item.name,item]));
  // Borrower/realtor portal authorization is enforced by the unrestored shared
  // directory. Local upload grants and staff credentials have no such exemption.
  const protectedTable=(name:string)=>/^(uwm_|staff_sessions$|staff_google_attempts$|staff_email_codes$|borrower_upload_access$|pilot_support_grant(?:s|_reads)$|realtor_financing_)/.test(name);
  if(current.tables.some(item=>protectedTable(item.name)&&previous.get(item.name)?.digest!==item.digest)||before.tables.some(item=>protectedTable(item.name)&&!current.tables.some(next=>next.name===item.name)))
    result.push("Lender evidence or access records changed. Reconcile those records before restoring; Orbit will not rewind them automatically.");
  if(before.activeLoanHolds || current.activeLoanHolds)
    result.push("A loan has an active retention hold. Keep the workspace paused and use the incident recovery review.");
  const programTables=["compliance_program_entities","compliance_program_licenses","compliance_program_items","compliance_program_events","compliance_program_reviews","compliance_state_scope_versions","compliance_state_readiness_versions",
    "compliance_scope_reviews","compliance_obligation_versions","compliance_obligation_occurrences","compliance_obligation_events","compliance_obligation_work","compliance_filing_receipts","compliance_filing_receipt_references",
    "compliance_learning_versions","compliance_learning_assignments","compliance_learning_events","compliance_trid_evidence",
    "compliance_broker_agreement_versions","compliance_refinance_benefit_versions","compliance_kansas_notice_versions",
    "compliance_michigan_loan_practices_versions","compliance_advertising_versions","compliance_california_mlds_versions"];
  if(programTables.some(name=>previous.get(name)?.digest!==current.tables.find(item=>item.name===name)?.digest))
    result.push("Compliance program records changed. Reconcile entity profiles, work and review evidence before restoring.");
  if(["settlement_imports", "settlement_feed_receipts", "settlement_feed_corrections"].some(name=>previous.get(name)?.digest!==current.tables.find(item=>item.name===name)?.digest))
    result.push("Imported settlement evidence changed. Choose a checkpoint that retains its source records.");
  const retentionTables=["loan_retention_holds","loan_retention_objects","loan_retention_policies","loan_retention_reviews","michigan_retention_reviews",
    "california_dre_recordkeeping_reviews","california_dfpi_recordkeeping_reviews","crmla_register_versions"];
  if(retentionTables.some(name=>previous.get(name)?.digest!==current.tables.find(item=>item.name===name)?.digest))
    result.push("Loan retention evidence changed. This checkpoint requires a separate retention review.");
  result.push(...processorRestoreBlockers(before,current));
  return result;
}
export function restoreCheckpoint(db:Store,brokerageId:string,id:string,now=new Date().toISOString()){
  const row=db.prepare("SELECT * FROM brokerage_recovery_checkpoints WHERE id=? AND brokerageId=?").get(id,brokerageId);
  if(!row)throw new Error("Checkpoint unavailable in this workspace.");
  if(String(row.expiresAt)<=now)throw new Error("Checkpoint expired. Restore remains blocked.");
  return {bookmark:String(row.bookmark),manifest:readCheckpointManifest(db,row)};
}
export function previewRestore(db:Store,staff:WorkspaceStaff,emails:string[],id:string,revision:number,current:CheckpointManifest):RestorePreview{
  const before=restoreCheckpoint(db,staff.brokerage.id,id).manifest;
  return {comparison:compareCheckpoint(db,staff,emails,id,revision,current),fingerprint:restoreFingerprint(id,before,current),
    blockers:restoreBlockers(before,current),documents:before.files?.items.length??0,unretained:before.files?.unretained??0};
}
export function restoreAccess(db:Store,staff:WorkspaceStaff,emails:string[]){
  const state=maintenanceState(db,staff.brokerage.id);
  if(!maintenanceAdmin(db,staff,emails)||state.mode!=="Paused"||!state.startedAt)throw new Error("A current pilot admin and fully paused workspace are required.");
  return state;
}
export function readRestoreJob(db:Store,brokerageId:string,id?:string):RestoreJob|null{
  const columns="id,checkpointId,sourceCheckpointId,state,actor,note,at,finishedAt,message,cycle";
  return (id?db.prepare(`SELECT ${columns} FROM brokerage_restore_jobs WHERE brokerageId=? AND id=?`).get(brokerageId,id):
    db.prepare(`SELECT ${columns} FROM brokerage_restore_jobs WHERE brokerageId=? ORDER BY rowid DESC LIMIT 1`).get(brokerageId)) as RestoreJob|null??null;
}
export function priorRestore(db:Store,staff:WorkspaceStaff,emails:string[],raw:unknown){
  const input=restoreStartInput.parse(raw),state=restoreAccess(db,staff,emails);
  const row=db.prepare("SELECT * FROM brokerage_restore_jobs WHERE id=?").get(input.id);
  if(!row)return null;
  if(row.brokerageId!==staff.brokerage.id||row.actorEmail!==staff.email||row.commandDigest!==hash(input)||row.cycle!==state.startedAt)
    throw new Error("This restore request belongs to a different review.");
  return readRestoreJob(db,staff.brokerage.id,input.id)!;
}
export function reserveRestore(db:Store,staff:WorkspaceStaff,emails:string[],raw:RestoreStartInput,capture:{bookmark:string;manifest:CheckpointManifest;at:string}){
  return db.transaction(()=>{
    const input=restoreStartInput.parse(raw),prior=priorRestore(db,staff,emails,input);if(prior)return prior;
    const state=checkpointAccess(db,staff,emails,input.revision),target=restoreCheckpoint(db,staff.brokerage.id,input.checkpointId);
    if(input.confirmation!==db.prepare("SELECT name FROM brokerages WHERE id=?").get(staff.brokerage.id)?.name)throw new Error("Enter this brokerage’s exact name to confirm.");
    if(restoreFingerprint(input.checkpointId,target.manifest,capture.manifest)!==input.fingerprint)throw new Error("Workspace evidence changed. Preview this restore again.");
    const blockers=restoreBlockers(target.manifest,capture.manifest);if(blockers.length)throw new Error(blockers.join(" "));
    persistCheckpoint(db,staff,emails,{id:input.id,revision:input.revision,label:"Automatically saved before workspace restore"},capture);
    db.prepare("INSERT INTO brokerage_restore_jobs VALUES (?,?,?,?,?,'Requested',?,?,?,?,?,NULL,?,NULL)")
      .run(input.id,staff.brokerage.id,input.checkpointId,input.id,state.startedAt!,staff.name,staff.email,input.note,hash(input),capture.at,"Restore reserved. Check the outcome before reopening.");
    return readRestoreJob(db,staff.brokerage.id,input.id)!;
  });
}
export function authorizedRestore(db:Store,staff:WorkspaceStaff,emails:string[],id:string){
  const state=restoreAccess(db,staff,emails),job=readRestoreJob(db,staff.brokerage.id,id);
  if(!job||job.cycle!==state.startedAt)throw new Error("Restore request unavailable in this maintenance cycle.");
  return {job,target:restoreCheckpoint(db,staff.brokerage.id,job.checkpointId),source:restoreCheckpoint(db,staff.brokerage.id,job.sourceCheckpointId)};
}
export function recordRestoreOutcome(db:Store,staff:WorkspaceStaff,emails:string[],id:string,outcome:"Armed"|"Restored"|"Needs review",message:string,undoBookmark?:string){
  return db.transaction(()=>{
    const state=restoreAccess(db,staff,emails),job=readRestoreJob(db,staff.brokerage.id,id);
    if(!job||job.cycle!==state.startedAt)throw new Error("Restore request unavailable.");
    if(job.state==="Restored"||job.state===outcome)return job;
    if(!pendingWorkspaceRestore(db,staff.brokerage.id))throw new Error("No restore is pending.");
    const at=new Date().toISOString();
    db.prepare("UPDATE brokerage_restore_jobs SET state=?,message=?,finishedAt=?,undoBookmark=COALESCE(?,undoBookmark) WHERE id=?")
      .run(outcome,message,outcome==="Restored"?at:null,undoBookmark??null,id);
    recordMaintenanceEvent(db,staff.brokerage.id,{...state,revision:state.revision+1,reviewedAt:null,reviewedBy:null,checks:[false,false,false]},
      outcome==="Restored"?"Verified workspace restore":outcome==="Armed"?"Workspace restore armed":"Workspace restore needs review",staff.name,message,at);
    return readRestoreJob(db,staff.brokerage.id,id)!;
  });
}
