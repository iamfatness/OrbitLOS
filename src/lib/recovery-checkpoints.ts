import {compareCheckpointImpact} from "./recovery-checkpoint-impact";
import {createHash} from "node:crypto";
import {checkpointArea,checkpointCreate,type CheckpointManifest,type CheckpointSummary,type CheckpointComparison} from "./recovery-checkpoint-model";
import type {Store} from "./store";
import type {WorkspaceStaff} from "./staff-store";
import {maintenanceAdmin,maintenanceState,pendingRecoveryReplay,pendingWorkspaceRestore,recordMaintenanceEvent} from "./workspace-maintenance";
export function initializeRecoveryCheckpoints(db:Store){db.exec(`CREATE TABLE IF NOT EXISTS brokerage_recovery_checkpoints (
  id TEXT PRIMARY KEY,brokerageId TEXT NOT NULL,cycle TEXT NOT NULL,label TEXT NOT NULL,actor TEXT NOT NULL,actorEmail TEXT NOT NULL,
  at TEXT NOT NULL,expiresAt TEXT NOT NULL,bookmark TEXT NOT NULL,manifest TEXT NOT NULL,commandDigest TEXT NOT NULL
); CREATE TABLE IF NOT EXISTS brokerage_checkpoint_parts (
  checkpointId TEXT NOT NULL REFERENCES brokerage_recovery_checkpoints(id),part INTEGER NOT NULL,kind TEXT NOT NULL,content TEXT NOT NULL,
  PRIMARY KEY(checkpointId,part)
); CREATE INDEX IF NOT EXISTS recovery_checkpoints_recent ON brokerage_recovery_checkpoints(brokerageId,at DESC,id DESC);`);}
export function checkpointAccess(db:Store,staff:WorkspaceStaff,emails:string[],revision?:number){
  const state=maintenanceState(db,staff.brokerage.id);
  if(!maintenanceAdmin(db,staff,emails)||state.mode!=="Paused"||!state.startedAt||
    (revision!==undefined&&state.revision!==revision)||pendingRecoveryReplay(db,staff.brokerage.id)||pendingWorkspaceRestore(db,staff.brokerage.id))
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
  return db.transaction(()=>persistCheckpoint(db,staff,emails,raw,capture,now));
}
export function persistCheckpoint(db:Store,staff:WorkspaceStaff,emails:string[],raw:unknown,capture:{bookmark:string;manifest:CheckpointManifest;at:string},now=new Date().toISOString()){
    checkpointAccess(db,staff,emails);
    const prior=priorCheckpoint(db,staff,raw);if(prior)return prior;
    const input=checkpointCreate.parse(raw),state=checkpointAccess(db,staff,emails,input.revision);
    if(!capture.bookmark || capture.bookmark.length>200 || !Number.isFinite(Date.parse(capture.at)) || Date.parse(capture.at)>Date.parse(now) || Date.parse(now)-Date.parse(capture.at)>60000)
      throw new Error("Checkpoint capture expired. Refresh and capture it again.");
    if(Number(db.prepare("SELECT COUNT(*) AS n FROM brokerage_recovery_checkpoints WHERE brokerageId=?").get(staff.brokerage.id)?.n)>=100)
      throw new Error("This pilot has reached its 100-checkpoint limit. Existing checkpoints remain available for review.");
    const expiresAt=new Date(Date.parse(capture.at)+30*86400000).toISOString();
    db.prepare("INSERT INTO brokerage_recovery_checkpoints VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(input.id,staff.brokerage.id,state.startedAt!,input.label,staff.name,staff.email,capture.at,expiresAt,capture.bookmark,JSON.stringify(checkpointManifestHeader(capture.manifest)),digest(input));
    const parts=checkpointManifestParts(capture.manifest);
    parts.forEach((part,index)=>db.prepare("INSERT INTO brokerage_checkpoint_parts VALUES (?,?,?,?)").run(input.id,index,part.kind,JSON.stringify(part.items)));
    recordMaintenanceEvent(db,staff.brokerage.id,{...state,revision:state.revision+1,reviewedAt:null,reviewedBy:null,checks:[false,false,false]},"Saved recovery checkpoint",staff.name,input.label,now);
    return {id:input.id,label:input.label,actor:staff.name,at:capture.at,expiresAt,tables:capture.manifest.tables.length,rows:capture.manifest.tables.reduce((sum,table)=>sum+table.rows,0)};
}
export function compareCheckpoint(db:Store,staff:WorkspaceStaff,emails:string[],id:string,revision:number,current:CheckpointManifest,now=new Date().toISOString(),offset=0):CheckpointComparison {
  checkpointAccess(db,staff,emails,revision);
  const row=db.prepare("SELECT * FROM brokerage_recovery_checkpoints WHERE id=? AND brokerageId=?").get(id,staff.brokerage.id);
  if(!row)throw new Error("Checkpoint unavailable in this workspace.");
  if(String(row.expiresAt)<=now)throw new Error("This checkpoint is outside the 30-day recovery window. Create a new checkpoint.");
  const before=readCheckpointManifest(db,row);
  if(before.version!==current.version)throw new Error("Checkpoint format changed. This comparison needs operator review.");
  const old=new Map(before.tables.map(table=>[table.name,table])),next=new Map(current.tables.map(table=>[table.name,table]));
  const changed:CheckpointComparison["changed"]=[];let unchanged=0;
  for(const name of [...new Set([...old.keys(),...next.keys()])].sort()){
    const a=old.get(name),b=next.get(name);
    if(a&&b&&a.digest===b.digest&&a.rows===b.rows){unchanged++;continue;}
    changed.push({name,area:checkpointArea(name),before:a?.rows??0,now:b?.rows??0,change:!a?"Added":!b?"Removed":"Changed"});
  }
  return {checkpoint:summary(row),at:now,revision,changed,unchanged,schemaChanged:before.schema!==current.schema,
    kvChanged:before.kv.digest!==current.kv.digest||before.kv.keys!==current.kv.keys,alarmChanged:before.alarm!==current.alarm,impact:compareCheckpointImpact(before.impact,current.impact,offset)};
}

function checkpointManifestParts(manifest:CheckpointManifest){
  const parts:{kind:"records"|"rows";items:unknown[]}[]=[];
  if(manifest.impact)for(const kind of ["records","rows"] as const){
    const entries=manifest.impact[kind];for(let i=0;i<entries.length;i+=250)parts.push({kind,items:entries.slice(i,i+250)});
  }
  return parts;
}
function checkpointManifestHeader(manifest:CheckpointManifest):CheckpointManifest{
  return manifest.impact?{...manifest,impact:{version:1,records:[],rows:[],parts:checkpointManifestParts(manifest).length}}:manifest;
}
export function readCheckpointManifest(db:Store,row:Record<string,unknown>):CheckpointManifest{
  const manifest=JSON.parse(String(row.manifest)) as CheckpointManifest;
  if(manifest.impact?.parts!==undefined){
    const parts=db.prepare("SELECT part,kind,content FROM brokerage_checkpoint_parts WHERE checkpointId=? ORDER BY part").all(String(row.id));
    if(parts.length!==manifest.impact.parts)throw new Error("Checkpoint record evidence is incomplete. Do not restore this checkpoint.");
    for(const [index,part] of parts.entries()){
      if(part.part!==index || !["records","rows"].includes(String(part.kind)))throw new Error("Checkpoint record evidence is incomplete. Do not restore this checkpoint.");
      const items=JSON.parse(String(part.content));if(!Array.isArray(items))throw new Error("Checkpoint record evidence is invalid.");
      manifest.impact[part.kind as "records"|"rows"].push(...items);
    }
    delete manifest.impact.parts;
  }
  return manifest;
}
