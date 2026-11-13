import { readTexasRecordkeepingExport } from "./texas-recordkeeping";
import { readFloridaRecordkeepingExport } from "./florida-recordkeeping";
import { readColoradoRecordkeepingExport } from "./colorado-recordkeeping";
import { readCaliforniaDfpiExport } from "./california-dfpi-recordkeeping";
import { readCaliforniaDreRecordkeepingExport } from "./california-dre-recordkeeping";
import { createHash } from "node:crypto";
import { strToU8, zipSync } from "fflate";
import { z } from "zod";
import { documentKey } from "./document-files-model";
import { readMichiganRetentionExport } from "./michigan-retention";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { accessEvent } from "./workspace-access";

export const retentionExportPath = "/api/loan-retention/export";
export const retentionExportName = "orbit-loan-retention.zip";
export const retentionExportLoanId = z.string().min(1).max(200);
const maxFiles = 100;
const maxBytes = 32 * 1024 * 1024;
const maxEntries = 1000;
const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

type Version = { requestId: string; kind: string; objectId: string; source: string; revision: number | null; holdId: string | null };
type Hold = { id: string; reference: string; placedAt: string; placedBy: string; releaseReference: string | null;
  releasedAt: string | null; releasedBy: string | null };
type Snapshot = { loan: { id: string; borrower: string; stage: string }; holds: Hold[]; versions: Version[];
  unmappedAcceptedRevisions: { requestId: string; kind: string; revision: number }[];
  michiganRetention: ReturnType<typeof readMichiganRetentionExport>;
  californiaDfpi?: ReturnType<typeof readCaliforniaDfpiExport>;
  californiaDreRecordkeeping?: ReturnType<typeof readCaliforniaDreRecordkeepingExport>;
  coloradoRecordkeeping?: ReturnType<typeof readColoradoRecordkeepingExport>;
  floridaRecordkeeping?: ReturnType<typeof readFloridaRecordkeepingExport>;
  texasRecordkeeping?: ReturnType<typeof readTexasRecordkeepingExport> };
export type RetentionExportReview = { snapshot: Snapshot; fingerprint: string } | { status: 404 | 413; error: string };

function review(db: Store, staff: WorkspaceStaff, workspaceId: string, loanId: string): RetentionExportReview {
  const unavailable = { status: 404, error: "This retention export is unavailable." } as const;
  if (staff.brokerage.id !== workspaceId || staff.brokerage.role !== "Admin" || !staff.brokerage.pilot || !retentionExportLoanId.safeParse(loanId).success)
    return unavailable;
  const loan = db.prepare(`SELECT loan.id, contact.name AS borrower, loan.stage FROM loans loan
    JOIN contacts contact ON contact.id=loan.contactId WHERE loan.id=?`).get(loanId) as Snapshot["loan"] | undefined;
  if (!loan) return unavailable;
  const holds = db.prepare(`SELECT id,reference,placedAt,placedBy,releaseReference,releasedAt,releasedBy
    FROM loan_retention_holds WHERE loanId=? ORDER BY placedAt,id LIMIT ?`).all(loanId,maxEntries+1) as Hold[];
  const versions = db.prepare(`WITH requests AS (
    SELECT id,kind,revision FROM document_requests WHERE loanId=?
  ), versions AS (
    SELECT r.id AS requestId,r.kind,f.objectId,'Current' AS source,r.revision,NULL AS holdId
      FROM requests r JOIN document_files f ON f.requestId=r.id WHERE f.objectId IS NOT NULL
    UNION ALL SELECT r.id,r.kind,f.objectId,'Accepted',f.revision,NULL
      FROM requests r JOIN document_accepted_files f ON f.requestId=r.id
    UNION ALL SELECT r.id,r.kind,f.objectId,'Condition evidence',f.revision,NULL
      FROM requests r JOIN condition_document_sources f ON f.requestId=r.id WHERE f.objectId IS NOT NULL
    UNION ALL SELECT f.requestId,coalesce(r.kind,'Checklist document'),f.objectId,'Active hold',NULL,h.id
      FROM loan_retention_holds h JOIN loan_retention_objects f ON f.holdId=h.id
      LEFT JOIN requests r ON r.id=f.requestId WHERE h.loanId=? AND h.releasedAt IS NULL
  ) SELECT * FROM versions ORDER BY requestId,objectId,source,revision,holdId LIMIT ?`)
    .all(loanId,loanId,maxEntries+1) as Version[];
  const unmappedAcceptedRevisions = db.prepare(`SELECT r.id AS requestId,r.kind,a.revision
    FROM document_requests r JOIN document_acceptances a ON a.requestId=r.id
    LEFT JOIN document_accepted_files f ON f.requestId=a.requestId AND f.revision=a.revision
    WHERE r.loanId=? AND f.objectId IS NULL ORDER BY r.id,a.revision LIMIT ?`)
    .all(loanId,maxEntries+1) as Snapshot["unmappedAcceptedRevisions"];
  const michiganRetention = readMichiganRetentionExport(db,loanId,maxEntries+1);
  const californiaDreRecordkeeping = readCaliforniaDreRecordkeepingExport(db,workspaceId,loanId,maxEntries+1);
  const californiaDfpi = readCaliforniaDfpiExport(db,workspaceId,loanId,maxEntries+1);
  const coloradoRecordkeeping = readColoradoRecordkeepingExport(db,workspaceId,loanId,maxEntries+1);
  const floridaRecordkeeping = readFloridaRecordkeepingExport(db,workspaceId,loanId,maxEntries+1);
  const texasRecordkeeping = readTexasRecordkeepingExport(db,workspaceId,loanId,maxEntries+1);
  if (texasRecordkeeping.length>maxEntries || floridaRecordkeeping.length>maxEntries || coloradoRecordkeeping.length>maxEntries || californiaDreRecordkeeping.length>maxEntries || californiaDfpi.length>maxEntries || holds.length>maxEntries || versions.length>maxEntries || unmappedAcceptedRevisions.length>maxEntries ||
    michiganRetention.length>maxEntries || new Set(versions.map(row=>row.objectId)).size>maxFiles)
    return { status:413, error:"This loan exceeds the retention export limit. Orbit did not create a partial archive." };
  const snapshot = { loan, holds, versions, unmappedAcceptedRevisions, michiganRetention,
    ...(californiaDreRecordkeeping.length ? {californiaDreRecordkeeping} : {}), ...(californiaDfpi.length ? {californiaDfpi} : {}),
    ...(coloradoRecordkeeping.length ? {coloradoRecordkeeping} : {}),
    ...(floridaRecordkeeping.length ? {floridaRecordkeeping} : {}),
    ...(texasRecordkeeping.length ? {texasRecordkeeping} : {}) };
  return { snapshot, fingerprint:digest(JSON.stringify(snapshot)) };
}

export function reviewRetentionExport(db: Store, staff: WorkspaceStaff, workspaceId: string, loanId: string) {
  return db.transaction(() => review(db,staff,workspaceId,loanId));
}

export function auditRetentionExport(db: Store, staff: WorkspaceStaff, workspaceId: string, loanId: string, fingerprint: string) {
  return db.transaction(() => {
    const current = review(db,staff,workspaceId,loanId);
    if ("error" in current || current.fingerprint!==fingerprint) return false;
    accessEvent(db,staff,"Prepared loan retention export",loanId,new Date().toISOString());
    return true;
  });
}

const headers = { "Cache-Control":"private, no-store", "X-Content-Type-Options":"nosniff",
  "Content-Security-Policy":"default-src 'none'; sandbox" };

export async function retentionExportResponse(bucket: R2Bucket | undefined, workspaceId: string, reviewed: RetentionExportReview,
  confirm: (fingerprint: string) => Promise<boolean>) {
  const problem = (status:number,error:string) => Response.json({error},{status,headers});
  if ("error" in reviewed) return problem(reviewed.status,reviewed.error);
  const { snapshot, fingerprint } = reviewed;
  const ids = [...new Set(snapshot.versions.map(row=>row.objectId))];
  if (!bucket && ids.length) return problem(503,"Private document storage is unavailable. Try again shortly.");
  const entries: Record<string,Uint8Array> = {};
  const files: { path: string; bytes: number; sha256: string; versions: Omit<Version, "objectId">[] }[] = [];
  let totalBytes = 0;
  for (const objectId of ids) {
    if (!z.uuid().safeParse(objectId).success) return problem(409,"A saved document reference is invalid. Review the loan before exporting.");
    const object = await bucket?.get(documentKey(workspaceId,objectId));
    if (!object) return problem(409,"A saved PDF is missing. Orbit did not create a partial archive.");
    if (!Number.isSafeInteger(object.size) || object.size<5 || totalBytes+object.size>maxBytes) {
      await object.body.cancel();
      return problem(413,"The saved PDFs exceed the 32 MB export limit or contain an invalid file.");
    }
    const bytes = new Uint8Array(await object.arrayBuffer());
    totalBytes += bytes.length;
    const sha256 = digest(bytes);
    const checksum = object.checksums?.sha256;
    if (bytes.length!==object.size || new TextDecoder().decode(bytes.subarray(0,5))!=="%PDF-" ||
      (checksum && Buffer.from(checksum).toString("hex")!==sha256))
      return problem(409,"A saved PDF did not pass verification. Orbit did not create a partial archive.");
    const path = `documents/${String(files.length+1).padStart(3,"0")}.pdf`;
    entries[path] = bytes;
    files.push({ path, bytes:bytes.length, sha256,
      versions:snapshot.versions.filter(row=>row.objectId===objectId).map(({requestId,kind,source,revision,holdId})=>({requestId,kind,source,revision,holdId})) });
  }
  entries["manifest.json"] = strToU8(JSON.stringify({ format:1, exportedAt:new Date().toISOString(), loan:snapshot.loan,
    holdHistory:snapshot.holds, unmappedAcceptedRevisions:snapshot.unmappedAcceptedRevisions, files,
    ...(snapshot.californiaDreRecordkeeping?.length ? {californiaDreRecordkeeping:snapshot.californiaDreRecordkeeping} : {}),
    ...(snapshot.coloradoRecordkeeping?.length ? {coloradoRecordkeeping:snapshot.coloradoRecordkeeping} : {}),
    ...(snapshot.floridaRecordkeeping?.length ? {floridaRecordkeeping:snapshot.floridaRecordkeeping} : {}),
    ...(snapshot.texasRecordkeeping?.length ? {texasRecordkeeping:snapshot.texasRecordkeeping} : {}),
    ...(snapshot.californiaDfpi?.length ? {californiaDfpi:snapshot.californiaDfpi} : {}),
    ...(snapshot.michiganRetention.length ? { michiganRetention:snapshot.michiganRetention } : {}) },null,2)+"\n");
  const zip = zipSync(entries,{level:0});
  if (!await confirm(fingerprint)) return problem(409,"Loan records or your access changed while preparing the export. Refresh and try again.");
  return new Response(zip,{ headers:{ ...headers, "Content-Type":"application/zip",
    "Content-Disposition":`attachment; filename="${retentionExportName}"`, "Content-Length":String(zip.byteLength) } });
}
