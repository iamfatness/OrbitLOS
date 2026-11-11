import { createHash } from "node:crypto";
import type { Store } from "./store";
import type { WorkspaceStaff } from "./staff-store";
import { activeBrokerages } from "./brokerages";
import { demoBrokerageId } from "./brokerage-model";
import { loanAccess } from "./workspace-access";
import { recoveryDeadlineCommand,recoveryIntent,recoveryDocument,recoveryProof,expectedRecoveryDocument,sameRecoveryDocument,
  type RecoveryIntent,type RecoveryEdit,type RecoveryProof,type RecoveryDocument,type RecoveryEditInspection } from "./recovery-edit-model";

export const recoveryHash=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function initializeRecoveryEdits(db:Store,directory:boolean) {
  db.exec(`CREATE TABLE IF NOT EXISTS recovery_edit_proofs (id TEXT PRIMARY KEY,beforeState TEXT NOT NULL,afterState TEXT NOT NULL,at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS recovery_replay_proofs (id TEXT PRIMARY KEY,editId TEXT NOT NULL,result TEXT NOT NULL,at TEXT NOT NULL)`);
  if(directory)db.exec(`CREATE TABLE IF NOT EXISTS brokerage_recovery_edits (
    id TEXT PRIMARY KEY,brokerageId TEXT NOT NULL REFERENCES brokerages(id),actor TEXT NOT NULL,actorEmail TEXT NOT NULL,
    at TEXT NOT NULL,command TEXT NOT NULL,beforeState TEXT NOT NULL,recordName TEXT NOT NULL,label TEXT NOT NULL,
    state TEXT NOT NULL,proof TEXT,reviewNote TEXT,reviewer TEXT,reviewedAt TEXT
  ); CREATE INDEX IF NOT EXISTS brokerage_recovery_edits_recent ON brokerage_recovery_edits(brokerageId,at DESC,id DESC);`);
}
export function recoveryWriter(db:Store,staff:WorkspaceStaff,emails:string[]) {
  const current=activeBrokerages(db,staff.email,emails).find(row=>row.id===staff.brokerage.id);
  return !!current&&current.id!==demoBrokerageId&&current.pilot&&current.role===staff.brokerage.role&&current.accessRevision===staff.brokerage.accessRevision;
}
export function readRecoveryDocument(db:Store,loanId:string,requestId:string):RecoveryDocument|null {
  const row=db.prepare("SELECT id,revision,deadlineRevision,dueOn,status FROM document_requests WHERE loanId=? AND id=?").get(loanId,requestId);
  return row?recoveryDocument.parse(row):null;
}
export function recoveryDeadlineIntent(db:Store,staff:WorkspaceStaff,input:unknown):RecoveryIntent|null {
  const parsed=recoveryDeadlineCommand.safeParse(input);
  if(!parsed.success || !staff.brokerage.pilot || staff.brokerage.id===demoBrokerageId || !loanAccess(db,staff,parsed.data.loanId))return null;
  const command=parsed.data,before=readRecoveryDocument(db,command.loanId,command.requestId);
  if(!before || !["Requested","Needs replacement"].includes(before.status) || before.revision!==command.revision ||
    before.deadlineRevision!==command.deadlineRevision || before.dueOn===command.dueOn)return null;
  const loan=db.prepare("SELECT contacts.name FROM loans JOIN contacts ON contacts.id=loans.contactId WHERE loans.id=?").get(command.loanId);
  const request=db.prepare("SELECT kind FROM document_requests WHERE id=?").get(command.requestId);
  return {command,before,recordName:String(loan?.name??"Fictional loan"),label:String(request?.kind??"Document")};
}
function decode(row:Record<string,unknown>):RecoveryEdit {
  return {id:String(row.id),actor:String(row.actor),actorEmail:String(row.actorEmail),at:String(row.at),
    command:recoveryDeadlineCommand.parse(JSON.parse(String(row.command))),before:recoveryDocument.parse(JSON.parse(String(row.beforeState))),
    recordName:String(row.recordName),label:String(row.label),state:row.state as RecoveryEdit["state"],
    proof:row.proof?recoveryProof.parse(JSON.parse(String(row.proof))):null,
    review:row.reviewedAt?{note:String(row.reviewNote),actor:String(row.reviewer),at:String(row.reviewedAt)}:null};
}
export function beginRecoveryEdit(db:Store,staff:WorkspaceStaff,emails:string[],raw:unknown):RecoveryEdit {
  if(!recoveryWriter(db,staff,emails))throw new Error("Recovery receipt access changed. Refresh before saving.");
  const intent=recoveryIntent.parse(raw),{command,before}=intent;
  if(before.id!==command.requestId || before.revision!==command.revision || before.deadlineRevision!==command.deadlineRevision ||
    before.dueOn===command.dueOn || !["Requested","Needs replacement"].includes(before.status))throw new Error("Recovery receipt does not match the edit.");
  const id=recoveryHash([staff.brokerage.id,staff.email,crypto.randomUUID(),command]);
  db.prepare(`INSERT INTO brokerage_recovery_edits(id,brokerageId,actor,actorEmail,at,command,beforeState,recordName,label,state)
    VALUES (?,?,?,?,?,?,?,?,?,'Pending')`).run(id,staff.brokerage.id,staff.name,staff.email,new Date().toISOString(),JSON.stringify(command),JSON.stringify(before),intent.recordName,intent.label);
  return decode(db.prepare("SELECT * FROM brokerage_recovery_edits WHERE id=?").get(id)!);
}
export function readRecoveryProof(db:Store,id:string):RecoveryProof|null {
  const row=db.prepare("SELECT * FROM recovery_edit_proofs WHERE id=?").get(id);
  return row?recoveryProof.parse({id,before:JSON.parse(String(row.beforeState)),after:JSON.parse(String(row.afterState)),at:row.at}):null;
}
// Called inside the same transaction as the document update and its history.
export function recordRecoveryProof(db:Store,edit:RecoveryEdit,before:RecoveryDocument|null,after:RecoveryDocument|null,at:string) {
  if(readRecoveryProof(db,edit.id))return;
  if(!sameRecoveryDocument(before,edit.before)||!sameRecoveryDocument(after,expectedRecoveryDocument(edit)))
    throw new Error("Document changed while preparing its recovery receipt. Refresh and try again.");
  db.prepare("INSERT INTO recovery_edit_proofs VALUES (?,?,?,?)").run(edit.id,JSON.stringify(before),JSON.stringify(after),at);
}
export function validRecoveryProof(edit:RecoveryEdit,proof:RecoveryProof|null) {
  return !!proof&&proof.id===edit.id&&sameRecoveryDocument(proof.before,edit.before)&&sameRecoveryDocument(proof.after,expectedRecoveryDocument(edit));
}
export function finishRecoveryEdit(db:Store,staff:WorkspaceStaff,emails:string[],id:string,raw:unknown,rejected:boolean) {
  if(!recoveryWriter(db,staff,emails))throw new Error("Recovery receipt access changed.");
  const row=db.prepare("SELECT * FROM brokerage_recovery_edits WHERE id=? AND brokerageId=? AND actorEmail=?").get(id,staff.brokerage.id,staff.email);
  if(!row)throw new Error("Recovery receipt unavailable.");
  const edit=decode(row),proof=raw===null?null:recoveryProof.parse(raw);
  if(edit.state!=="Pending")return;
  if(proof&&!validRecoveryProof(edit,proof))throw new Error("Recovery evidence differs from the recorded intent.");
  if(proof||rejected)db.prepare("UPDATE brokerage_recovery_edits SET state=?,proof=? WHERE id=? AND state='Pending'")
    .run(proof?"Recorded":"Rejected",proof?JSON.stringify(proof):null,id);
}
export function recoveryEditRows(db:Store,brokerageId:string,offset:number) {
  const total=Number(db.prepare("SELECT count(*) AS n FROM brokerage_recovery_edits WHERE brokerageId=?").get(brokerageId)!.n);
  if(offset>0&&offset>=total)throw new Error("Edit history changed. Refresh the first page.");
  const items=db.prepare("SELECT * FROM brokerage_recovery_edits WHERE brokerageId=? ORDER BY at DESC,id DESC LIMIT 25 OFFSET ?").all(brokerageId,offset).map(decode);
  return {offset,total,next:offset+items.length<total?offset+items.length:null,items};
}
export function inspectRecoveryEdit(db:Store,edit:RecoveryEdit):RecoveryEditInspection["items"][number] {
  const current=readRecoveryDocument(db,edit.command.loanId,edit.command.requestId),sourceProof=readRecoveryProof(db,edit.id);
  const finding=!current?"Record unavailable":sameRecoveryDocument(current,expectedRecoveryDocument(edit))?"Saved revision present":
    sameRecoveryDocument(current,edit.before)?"Original revision present":"Different revision present";
  return {...edit,current,sourceProof,finding,fingerprint:recoveryHash([edit,current,sourceProof]),canConfirm:edit.state==="Pending"&&validRecoveryProof(edit,sourceProof),replay:null,
    canReplay:["Recorded","Reviewed"].includes(edit.state)&&validRecoveryProof(edit,edit.proof)&&!sourceProof&&sameRecoveryDocument(current,edit.before)};
}

export function readRecoveryEdit(db:Store,brokerageId:string,id:string):RecoveryEdit|null {
  const row=db.prepare("SELECT * FROM brokerage_recovery_edits WHERE brokerageId=? AND id=?").get(brokerageId,id);
  return row?decode(row):null;
}
