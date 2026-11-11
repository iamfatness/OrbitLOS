import { createHash } from "node:crypto";
import type { Store } from "./store";
import { inspectionPageSize, maintenanceInspectionInput, type InspectionDocument, type InspectionPage,
  type InspectionRequest, type MaintenanceInspection } from "./maintenance-inspection-model";

// This inspection deliberately does not initialize schemas or execute recovery.
// Missing/older stores remain unavailable instead of being interpreted as empty.
const inventories = [["Loans","loans"],["Applications","applications"],["Co-borrower applications","joint_applications"],
  ["Loan tasks","tasks"],["Contacts","contacts"],["Document requests","document_requests"],
  ["Accepted document revisions","document_acceptances"],["Loan audit entries","loan_audit"]] as const;
const documents = [
  {name:"Current loan documents",sql:`SELECT 'current:' || requestId AS reference, requests.kind AS label, requests.loanId AS recordId,
    requests.revision AS revision, files.objectId FROM document_files files JOIN document_requests requests ON requests.id=files.requestId WHERE files.objectId IS NOT NULL`},
  {name:"Accepted document revisions",sql:`SELECT 'accepted:' || acceptance.requestId || ':' || acceptance.revision AS reference,
    requests.kind || ' · accepted revision' AS label, requests.loanId AS recordId, acceptance.revision, retained.objectId
    FROM document_acceptances acceptance JOIN document_requests requests ON requests.id=acceptance.requestId
    LEFT JOIN document_accepted_files retained ON retained.requestId=acceptance.requestId AND retained.revision=acceptance.revision`},
  {name:"Linked condition evidence",sql:`SELECT 'evidence:' || evidence.id AS reference, evidence.kind || ' · linked evidence' AS label,
    requests.loanId AS recordId, evidence.revision, evidence.objectId FROM condition_document_sources evidence
    JOIN document_requests requests ON requests.id=evidence.requestId WHERE evidence.objectId IS NOT NULL`},
  {name:"Lead documents",sql:`SELECT 'lead:' || id AS reference, kind || ' · lead document' AS label, leadId AS recordId, revision, objectId
    FROM lead_document_requests WHERE objectId IS NOT NULL`},
  {name:"Lender package documents",sql:`SELECT 'package:' || files.shareId || ':' || files.slot AS reference,
    files.label || ' · lender package' AS label, links.loanId AS recordId, files.documentRevision AS revision, files.objectId
    FROM lender_package_files files JOIN lender_package_links links ON links.id=files.shareId WHERE files.objectId IS NOT NULL`},
];
const requests = [
  {name:"UWM request history",sql:`SELECT 'request:' || id AS reference, 'UWM request' AS source, loanId AS recordId,
    action, state, updatedAt AS at, environment, json_array(digest,result) AS basis FROM uwm_live_requests WHERE state IN ('Dispatching','Unknown','Acknowledged') AND action <> 'reconcile-request'`},
  {name:"UWM operation history",sql:`SELECT 'operation:' || id AS reference, 'UWM operation' AS source, loanId AS recordId,
    kind AS action, state, updatedAt AS at, environment, json_array(requestDigest,transactionId,receiptId) AS basis FROM uwm_operations WHERE state IN ('Prepared','Dispatching','Acknowledged','Unknown')`},
  {name:"Pending loan uploads",sql:`SELECT 'upload:' || requestId AS reference, 'Document upload' AS source, requests.loanId AS recordId,
    requests.kind AS action, 'Pending upload' AS state, CAST(attemptedAt AS TEXT) AS at, COALESCE(uploadMode,'Unknown') AS environment, pendingId AS basis
    FROM document_files files JOIN document_requests requests ON requests.id=files.requestId WHERE pendingId IS NOT NULL`},
  {name:"Pending lead uploads",sql:`SELECT 'lead-upload:' || id AS reference, 'Lead upload' AS source, leadId AS recordId,
    kind AS action, 'Pending upload' AS state, CAST(attemptedAt AS TEXT) AS at, 'mock' AS environment, pendingId AS basis FROM lead_document_requests WHERE pendingId IS NOT NULL`},
];
function readableSources(db:Store,sources:{name:string;sql:string}[],unavailable:string[]) {
  return sources.filter(source=>{try{db.prepare(`SELECT * FROM (${source.sql}) LIMIT 0`).all();return true;}
    catch{unavailable.push(source.name);return false;}}).map(source=>source.sql);
}
function page<T>(db:Store,queries:string[],offset:number):InspectionPage<T> {
  if(!queries.length)return {items:[],total:0,offset,next:null};
  const sql=queries.join(" UNION ALL ");
  const total=Number(db.prepare(`SELECT count(*) AS count FROM (${sql})`).get()!.count);
  if(offset>0 && offset>=total)throw new Error("Inspection page changed. Refresh the inspection.");
  const items=db.prepare(`SELECT * FROM (${sql}) ORDER BY reference LIMIT ? OFFSET ?`).all(inspectionPageSize,offset) as unknown as T[];
  return {items,total,offset,next:offset+items.length<total?offset+items.length:null};
}
export async function inspectMaintenanceStore(db:Store,raw:unknown,head:(objectId:string)=>Promise<{size:number;etag?:string}|null>):Promise<MaintenanceInspection> {
  const input=maintenanceInspectionInput.parse(raw), unavailable:string[]=[];
  const records=inventories.map(([label,table])=>{
    try{return {label,count:Number(db.prepare(`SELECT count(*) AS count FROM ${table}`).get()!.count)};}
    catch{unavailable.push(label);return {label,count:null};}
  });
  const files=page<{reference:string;label:string;recordId:string;revision:number|null;objectId:string|null}>(db,readableSources(db,documents,unavailable),input.documents);
  const work=page<Omit<InspectionRequest,"fingerprint"|"decisions"> & {basis:string}>(db,readableSources(db,requests,unavailable),input.requests);
  const names=new Map<string,string>();
  function recordName(id:string) {
    if(names.has(id))return names.get(id)!;
    let name="Record name unavailable";
    try{const loan=db.prepare("SELECT contacts.name FROM loans JOIN contacts ON contacts.id=loans.contactId WHERE loans.id=?").get(id);
      if(loan?.name)name=String(loan.name);}catch{/* An old schema stays read-only. */}
    if(name==="Record name unavailable")try{const lead=db.prepare("SELECT name FROM referral_leads WHERE id=?").get(id);
      if(lead?.name)name=String(lead.name);}catch{/* Report still provides its reference. */}
    names.set(id,name);return name;
  }
  const fingerprint=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const namedWork={...work,items:work.items.map(({basis,...item})=>({...item,recordName:recordName(item.recordId),
    fingerprint:fingerprint({...item,basis}),decisions:[]}))};
  // Bounded page and deduplication keep checks inexpensive. Never return storage
  // keys, request payloads, signed URLs, borrower answers or provider tokens.
  const checks=new Map<string,Promise<{availability:InspectionDocument["availability"];bytes:number|null;etag?:string}>>();
  const items=await Promise.all(files.items.map(async ({objectId,...item})=>{
    if(!objectId)return {...item,recordName:recordName(item.recordId),availability:"No retained file" as const,bytes:null,
      fingerprint:fingerprint({...item,objectId}),decisions:[]};
    if(!checks.has(objectId))checks.set(objectId,(async()=>{
      // Object IDs are generated UUIDs. Refuse path-like values from old/corrupt records.
      if(!/^[a-f0-9-]{36}$/i.test(objectId))return {availability:"Check unavailable" as const,bytes:null};
      try{const object=await head(objectId);return object?{availability:"Available" as const,bytes:object.size,etag:object.etag}:{availability:"Missing" as const,bytes:null};}
      catch{return {availability:"Check unavailable" as const,bytes:null};}
    })());
    const {etag,...checked}=await checks.get(objectId)!;
    return {...item,recordName:recordName(item.recordId),...checked,fingerprint:fingerprint({...item,objectId,...checked,etag}),decisions:[]};
  }));
  return {revision:input.revision,inspectedAt:new Date().toISOString(),records,unavailable:[...new Set(unavailable)],
    documents:{...files,items},requests:namedWork};
}
