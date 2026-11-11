import { z } from "zod";
import { shiftReportDate } from "./report-date-range";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { accessEvent } from "./workspace-access";

const policyVersion = z.number().int().positive().nullable();
const before = z.number().int().positive().nullable();
const section = z.enum(["policies","decisions"]);
export const retentionAuditRequest = z.discriminatedUnion("type", [
  z.object({type:z.literal("retentionAudit"),section,policyVersion,before}),
  z.object({type:z.literal("exportRetentionAudit"),policyVersion}),
]);
type Command = z.infer<typeof retentionAuditRequest>;
export type AuditPolicy = {version:number;fundedDays:number|null;closedDays:number|null;reference:string;at:string;actor:string};
export type AuditDecision = {id:string;loanId:string;currentBorrower:string|null;policyVersion:number;previous:string|null;
  outcome:string;reference:string;at:string;actor:string;eventDate:string|null;reviewOn:string|null;category:string|null};
export type RetentionAudit = {kind:"retentionAudit";section:z.infer<typeof section>;latestVersion:number|null;
  policies:AuditPolicy[];decisions:AuditDecision[];next:number|null};
export type RetentionAuditResult = RetentionAudit | {kind:"retentionAuditExport";json:string} | {error:string};

const pageSize=20;
const exportLimit=1000;

function readPolicies(db:Store, version:number|null, before:number|null, limit:number) {
  return db.prepare(`SELECT version,fundedDays,closedDays,reference,at,actor FROM loan_retention_policies
    WHERE (? IS NULL OR version=?) AND (? IS NULL OR version<?) ORDER BY version DESC LIMIT ?`)
    .all(version,version,before,before,limit) as AuditPolicy[];
}

function readDecisions(db:Store, version:number|null, before:number|null, limit:number) {
  const rows = db.prepare(`SELECT r.rowid AS cursor,r.id,r.loanId,c.name AS currentBorrower,r.policyVersion,r.previous,r.outcome,
    r.reference,r.at,r.actor,r.basis,p.fundedDays,p.closedDays FROM loan_retention_reviews r
    LEFT JOIN loans l ON l.id=r.loanId LEFT JOIN contacts c ON c.id=l.contactId
    LEFT JOIN loan_retention_policies p ON p.version=r.policyVersion
    WHERE (? IS NULL OR r.policyVersion=?) AND (? IS NULL OR r.rowid<?)
    ORDER BY r.rowid DESC LIMIT ?`).all(version,version,before,before,limit);
  return rows.map(({cursor,basis,fundedDays,closedDays,...row})=>{
    const [outcome,date]=String(basis).split("/");
    const category=outcome==="Active"?"Funded":["Withdrawn","Lost"].includes(outcome)?outcome:null;
    const eventDate=z.iso.date().safeParse(date);
    const period=category==="Funded"?fundedDays:closedDays;
    return {cursor:Number(cursor),decision:{...row,category,eventDate:eventDate.success?eventDate.data:null,
      reviewOn:category && eventDate.success && typeof period==="number"?shiftReportDate(eventDate.data,period):null} as AuditDecision};
  });
}

// Policy versions and review rows are append-only. The enclosing transaction
// keeps the export and its access-history event on the same snapshot.
export function retentionAuditWork(db:Store, command:Command, staff:WorkspaceStaff, now:string):RetentionAuditResult {
  const latestVersion=db.prepare("SELECT max(version) AS version FROM loan_retention_policies").get()?.version as number|null;
  const version=command.policyVersion;
  if (version!==null && !db.prepare("SELECT 1 FROM loan_retention_policies WHERE version=?").get(version))
    return {error:"This policy version is unavailable. Choose a recorded version."};
  if (command.type==="exportRetentionAudit") {
    const policies=readPolicies(db,version,null,exportLimit+1);
    const reviews=readDecisions(db,version,null,exportLimit+1);
    if (policies.length>exportLimit || reviews.length>exportLimit)
      return {error:"This export exceeds 1,000 policy versions or decisions. Select a policy version to narrow the export."};
    const json=JSON.stringify({format:1,exportedAt:now,brokerageId:staff.brokerage.id,policyVersion:version,
      latestVersion,policies,decisions:reviews.map(row=>row.decision)},null,2);
    accessEvent(db,staff,"Prepared retention audit export",version===null?"All policies":`Policy version ${version}`,now);
    return {kind:"retentionAuditExport",json};
  }
  if (command.section==="policies") {
    const rows=readPolicies(db,version,command.before,pageSize+1);
    const policies=rows.slice(0,pageSize);
    return {kind:"retentionAudit",section:"policies",latestVersion,policies,decisions:[],
      next:rows.length>pageSize?policies[pageSize-1].version:null};
  }
  const rows=readDecisions(db,version,command.before,pageSize+1);
  return {kind:"retentionAudit",section:"decisions",latestVersion,policies:[],
    decisions:rows.slice(0,pageSize).map(row=>row.decision),next:rows.length>pageSize?rows[pageSize-1].cursor:null};
}
