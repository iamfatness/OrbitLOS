import {createHash} from "node:crypto";
import {checkpointArea,checkpointCreate,type CheckpointManifest,type CheckpointSummary,type CheckpointComparison} from "./recovery-checkpoint-model";
import type {Store} from "./store";
import type {WorkspaceStaff} from "./staff-store";
import {maintenanceAdmin,maintenanceState,pendingRecoveryReplay,recordMaintenanceEvent} from "./workspace-maintenance";
export function initializeRecoveryCheckpoints(db:Store){db.exec(`CREATE TABLE IF NOT EXISTS brokerage_recovery_checkpoints (
  id TEXT PRIMARY KEY,brokerageId TEXT NOT NULL,cycle TEXT NOT NULL,label TEXT NOT NULL,actor TEXT NOT NULL,actorEmail TEXT NOT NULL,
  at TEXT NOT NULL,expiresAt TEXT NOT NULL,bookmark TEXT NOT NULL,manifest TEXT NOT NULL,commandDigest TEXT NOT NULL
); CREATE INDEX IF NOT EXISTS recovery_checkpoints_recent ON brokerage_recovery_checkpoints(brokerageId,at DESC,id DESC);`);}
export function checkpointAccess(db:Store,staff:WorkspaceStaff,emails:string[],revision?:number){
  const state=maintenanceState(db,staff.brokerage.id);
  if(!maintenanceAdmin(db,staff,emails)||state.mode!=="Paused"||!state.startedAt||
    (revision!==undefined&&state.revision!==revision)||pendingRecoveryReplay(db,staff.brokerage.id))
    throw new Error("Pause the workspace, resolve pending recovery, and refresh its status before managing checkpoints.");
  return state;
}
const digest=(input:unknown)=>createHash("sha256").update(JSON.stringify(input)).digest("hex");
function summary(row:Record<string,unknown>):CheckpointSummary {
  const manifest=JSON.parse(String(row.manifest)) as CheckpointManifest;
  return {id:String(row.id),label:String(row.label),actor:String(row.actor),at:String(row.at),expiresAt:String(row.expiresAt),
    tables:manifest.tables.length,rows:manifest.tables.reduce((sum,table)=>sum+table.rows,0)};
}
export function checkpointList(db:Store,staff:WorkspaceStaff,emails:string[],revision:number){
  checkpointAccess(db,staff,emails,revision);
  return db.prepare("SELECT * FROM brokerage_recovery_checkpoints WHERE brokerageId=? ORDER BY at DESC,id DESC LIMIT 100").all(staff.brokerage.id).map(summary);
}
export function priorCheckpoint(db:Store,staff:WorkspaceStaff,raw:unknown){
  const input=checkpointCreate.parse(raw),row=db.prepare("SELECT * FROM brokerage_recovery_checkpoints WHERE id=?").get(input.id);
  if(!row)return null;
  if(row.brokerageId!==staff.brokerage.id || row.actorEmail!==staff.email || row.commandDigest!==digest(input) || row.cycle!==maintenanceState(db,staff.brokerage.id).startedAt)
    throw new Error("This checkpoint request belongs to a different maintenance review.");
  return summary(row);
}
export function saveCheckpoint(db:Store,staff:WorkspaceStaff,emails:string[],raw:unknown,capture:{bookmark:string;manifest:CheckpointManifest;at:string},now=new Date().toISOString()){
  return db.transaction(()=>{
    checkpointAccess(db,staff,emails);
    const prior=priorCheckpoint(db,staff,raw);if(prior)return prior;
    const input=checkpointCreate.parse(raw),state=checkpointAccess(db,staff,emails,input.revision);
    if(!capture.bookmark || capture.bookmark.length>200 || !Number.isFinite(Date.parse(capture.at)) || Date.parse(capture.at)>Date.parse(now) || Date.parse(now)-Date.parse(capture.at)>60000)
      throw new Error("Checkpoint capture expired. Refresh and capture it again.");
    if(Number(db.prepare("SELECT COUNT(*) AS n FROM brokerage_recovery_checkpoints WHERE brokerageId=?").get(staff.brokerage.id)?.n)>=100)
      throw new Error("This pilot has reached its 100-checkpoint limit. Existing checkpoints remain available for review.");
    const expiresAt=new Date(Date.parse(capture.at)+30*86400000).toISOString();
    db.prepare("INSERT INTO brokerage_recovery_checkpoints VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(input.id,staff.brokerage.id,state.startedAt!,input.label,staff.name,staff.email,capture.at,expiresAt,capture.bookmark,JSON.stringify(capture.manifest),digest(input));
    recordMaintenanceEvent(db,staff.brokerage.id,{...state,revision:state.revision+1,reviewedAt:null,reviewedBy:null,checks:[false,false,false]},"Saved recovery checkpoint",staff.name,input.label,now);
    return {id:input.id,label:input.label,actor:staff.name,at:capture.at,expiresAt,tables:capture.manifest.tables.length,rows:capture.manifest.tables.reduce((sum,table)=>sum+table.rows,0)};
  });
}
export function compareCheckpoint(db:Store,staff:WorkspaceStaff,emails:string[],id:string,revision:number,current:CheckpointManifest,now=new Date().toISOString()):CheckpointComparison {
  checkpointAccess(db,staff,emails,revision);
  const row=db.prepare("SELECT * FROM brokerage_recovery_checkpoints WHERE id=? AND brokerageId=?").get(id,staff.brokerage.id);
  if(!row)throw new Error("Checkpoint unavailable in this workspace.");
  if(String(row.expiresAt)<=now)throw new Error("This checkpoint is outside the 30-day recovery window. Create a new checkpoint.");
  const before=JSON.parse(String(row.manifest)) as CheckpointManifest;
  if(before.version!==current.version)throw new Error("Checkpoint format changed. This comparison needs operator review.");
  const old=new Map(before.tables.map(table=>[table.name,table])),next=new Map(current.tables.map(table=>[table.name,table]));
  const changed:CheckpointComparison["changed"]=[];let unchanged=0;
  for(const name of [...new Set([...old.keys(),...next.keys()])].sort()){
    const a=old.get(name),b=next.get(name);
    if(a&&b&&a.digest===b.digest&&a.rows===b.rows){unchanged++;continue;}
    changed.push({name,area:checkpointArea(name),before:a?.rows??0,now:b?.rows??0,change:!a?"Added":!b?"Removed":"Changed"});
  }
  return {checkpoint:summary(row),at:now,revision,changed,unchanged,schemaChanged:before.schema!==current.schema,
    kvChanged:before.kv.digest!==current.kv.digest||before.kv.keys!==current.kv.keys,alarmChanged:before.alarm!==current.alarm};
}
