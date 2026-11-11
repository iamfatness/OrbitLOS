import {createHash} from "node:crypto";
import type {Store} from "./store";
import type {CheckpointFiles} from "./recovery-checkpoint-model";
const objectId=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const sources=["SELECT objectId FROM document_files WHERE objectId IS NOT NULL","SELECT objectId FROM document_accepted_files WHERE objectId IS NOT NULL",
  "SELECT objectId FROM condition_document_sources WHERE objectId IS NOT NULL","SELECT objectId FROM lead_document_requests WHERE objectId IS NOT NULL",
  "SELECT objectId FROM lender_package_files WHERE objectId IS NOT NULL",
  "SELECT objectId FROM loan_retention_objects JOIN loan_retention_holds ON id=holdId WHERE releasedAt IS NULL"];
export type CheckpointFileReader=(id:string)=>Promise<{size:number;arrayBuffer():Promise<ArrayBuffer>}|null>;
export function pendingCheckpointUploads(db:Store){
  return Number(db.prepare("SELECT (SELECT COUNT(*) FROM document_files WHERE pendingId IS NOT NULL)+(SELECT COUNT(*) FROM lead_document_requests WHERE pendingId IS NOT NULL) AS n").get()?.n??0);
}
export async function captureCheckpointFiles(db:Store,get:CheckpointFileReader):Promise<CheckpointFiles>{
  if(pendingCheckpointUploads(db))throw new Error("Finish or resolve pending document uploads before saving a recovery checkpoint.");
  const union=sources.join(" UNION ALL "),references=Number(db.prepare(`SELECT COUNT(*) AS n FROM (${union})`).get()?.n??0);
  const objects=db.prepare(`SELECT DISTINCT objectId FROM (${union}) ORDER BY objectId LIMIT 101`).all();
  if(objects.length>100)throw new Error("This pilot exceeds the 100-file recovery inspection limit.");
  const unretained=Number(db.prepare(`SELECT COUNT(*) AS n FROM document_acceptances a LEFT JOIN document_accepted_files f ON f.requestId=a.requestId AND f.revision=a.revision WHERE f.objectId IS NULL`).get()?.n??0);
  const items:CheckpointFiles["items"]=[];let total=0;
  for(const row of objects){
    const id=String(row.objectId);if(!objectId.test(id))throw new Error("A document reference is invalid. Inspect saved work before checkpointing.");
    const file=await get(id);if(!file)throw new Error("A referenced document file is missing. Inspect saved work before checkpointing.");
    if(!Number.isSafeInteger(file.size)||file.size<0||(total+=file.size)>32*1024*1024)throw new Error("This pilot exceeds the 32 MB document recovery inspection limit.");
    const bytes=await file.arrayBuffer();if(bytes.byteLength!==file.size)throw new Error("Document bytes changed during checkpoint inspection.");
    items.push({objectId:id,bytes:file.size,sha256:createHash("sha256").update(new Uint8Array(bytes)).digest("hex")});
  }
  return {references,unretained,items};
}
export async function verifyCheckpointFiles(files:CheckpointFiles|undefined,get:CheckpointFileReader){
  if(!files)throw new Error("This checkpoint predates document recovery evidence. Save a new checkpoint before using operator restore.");
  let total=0;
  if(files.items.length>100)throw new Error("Checkpoint document evidence exceeds the inspection limit.");
  for(const expected of files.items){
    if(!Number.isSafeInteger(expected.bytes)||expected.bytes<0||!/^[a-f0-9]{64}$/.test(expected.sha256)||!objectId.test(expected.objectId)||(total+=expected.bytes)>32*1024*1024)throw new Error("Checkpoint document evidence is invalid.");
    const actual=await get(expected.objectId);
    if(!actual||actual.size!==expected.bytes)throw new Error("A checkpoint document is missing or changed. Restore remains blocked.");
    const bytes=await actual.arrayBuffer();
    if(bytes.byteLength!==expected.bytes||createHash("sha256").update(new Uint8Array(bytes)).digest("hex")!==expected.sha256)
      throw new Error("A checkpoint document no longer matches its saved contents. Restore remains blocked.");
  }
  return {verified:files.items.length,unretained:files.unretained};
}
