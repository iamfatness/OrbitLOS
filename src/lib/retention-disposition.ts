import { z } from "zod";
import { easternDate } from "./client-retention";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { accessEvent } from "./workspace-access";

const days = z.number().int().min(1).max(36500).nullable();
const reference = z.string().trim().min(4).max(240);
const offset = z.number().int().min(0).max(10000);
const outcomes = ["Continue retaining", "Recommend disposition"] as const;
export const dispositionRequest = z.discriminatedUnion("type", [
  z.object({type:z.literal("dispositionQueue"),offset}),
  z.object({type:z.literal("saveDispositionPolicy"),id:z.uuid(),expected:z.number().int().nonnegative(),
    fundedDays:days,closedDays:days,reference}),
  z.object({type:z.literal("saveDispositionReview"),id:z.uuid(),loanId:z.string().min(1).max(200),
    policyVersion:z.number().int().positive(),basis:z.string().max(150),previous:z.uuid().nullable(),
    outcome:z.enum(outcomes),reference,offset}),
]);
type Command = z.infer<typeof dispositionRequest>;
type Policy = {version:number; fundedDays:number|null; closedDays:number|null; reference:string; at:string; actor:string};
type Decision = {id:string; outcome:typeof outcomes[number]; reference:string; at:string; actor:string};
type Candidate = {id:string; borrower:string; category:string; eventDate:string; reviewOn:string; basis:string; decision:Decision|null};
export type DispositionQueue = {kind:"disposition"; policy:Policy|null; rows:Candidate[]; offset:number; next:number|null; message?:string};

export function initializeRetentionDisposition(db:Store) {
  if (!db.prepare("PRAGMA table_info(loans)").all().some(row=>row.name==="dispositionDate"))
    db.exec("ALTER TABLE loans ADD COLUMN dispositionDate TEXT");
  db.exec(`CREATE TABLE IF NOT EXISTS loan_retention_policies (
    version INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, fundedDays INTEGER, closedDays INTEGER,
    reference TEXT NOT NULL, at TEXT NOT NULL, actor TEXT NOT NULL, actorEmail TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS loan_retention_reviews (
    id TEXT PRIMARY KEY, loanId TEXT NOT NULL, policyVersion INTEGER NOT NULL, basis TEXT NOT NULL, previous TEXT,
    outcome TEXT NOT NULL, reference TEXT NOT NULL, at TEXT NOT NULL, actor TEXT NOT NULL, actorEmail TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS retention_reviews_by_loan ON loan_retention_reviews(loanId,policyVersion,basis);
  CREATE INDEX IF NOT EXISTS retention_closed_loans ON loans(disposition,dispositionDate,id)
    WHERE disposition IN ('Withdrawn','Lost') AND dispositionDate IS NOT NULL;`);
}

function candidates(db:Store, policy:Policy, today:string, loanId:string|null, offset:number):Candidate[] {
  const rows = db.prepare(`WITH outcome AS (
    SELECT l.id,c.name AS borrower,
      CASE WHEN f.fundingDate IS NOT NULL THEN 'Funded' ELSE l.disposition END AS category,
      coalesce(f.fundingDate,l.dispositionDate) AS eventDate,
      CASE WHEN f.fundingDate IS NOT NULL THEN ? ELSE ? END AS days,
      printf('%s/%s/%d/%d/%s/%s',l.disposition,coalesce(f.fundingDate,l.dispositionDate),
        coalesce(f.revision,0),l.dispositionRevision,coalesce(h.id,''),coalesce(h.releasedAt,'')) AS basis
    FROM loans l JOIN contacts c ON c.id=l.contactId LEFT JOIN closing_progress f ON f.loanId=l.id
    LEFT JOIN loan_retention_holds h ON h.id=(SELECT id FROM loan_retention_holds WHERE loanId=l.id ORDER BY placedAt DESC,rowid DESC LIMIT 1)
    WHERE (? IS NULL OR l.id=?) AND (
      (f.fundingDate IS NOT NULL AND l.stage IN ('Funded','Closed') AND l.disposition='Active')
      OR (f.fundingDate IS NULL AND l.disposition IN ('Withdrawn','Lost') AND l.dispositionDate IS NOT NULL))
      AND NOT EXISTS (SELECT 1 FROM loan_retention_holds active WHERE active.loanId=l.id AND active.releasedAt IS NULL)
  ), due AS (
    SELECT *, date(eventDate,'+' || days || ' days') AS reviewOn FROM outcome WHERE days IS NOT NULL
  )
  SELECT d.id,d.borrower,d.category,d.eventDate,d.reviewOn,d.basis,r.id AS decisionId,r.outcome,r.reference,r.at,r.actor
  FROM due d LEFT JOIN loan_retention_reviews r ON r.id=(
    SELECT id FROM loan_retention_reviews WHERE loanId=d.id AND policyVersion=? AND basis=d.basis ORDER BY rowid DESC LIMIT 1
  ) WHERE d.reviewOn<=? ORDER BY d.reviewOn,d.id LIMIT 16 OFFSET ?`)
    .all(policy.fundedDays,policy.closedDays,loanId,loanId,policy.version,today,offset);
  return rows.map(({decisionId,outcome,reference,at,actor,...row})=>({
    ...row,decision:decisionId ? {id:decisionId,outcome,reference,at,actor} : null,
  })) as Candidate[];
}

// Runs inside loanRetentionWork's owner-scoped transaction.
export function retentionDispositionWork(db:Store, data:Command, staff:WorkspaceStaff, now:string):DispositionQueue|{error:string} {
  const current = db.prepare("SELECT version,fundedDays,closedDays,reference,at,actor FROM loan_retention_policies ORDER BY version DESC LIMIT 1")
    .get() as Policy|undefined;
  const today = easternDate(new Date(now));
  function queue(policy:Policy|null, offset:number, message?:string):DispositionQueue {
    const rows = policy && (policy.fundedDays || policy.closedDays) ? candidates(db,policy,today,null,offset) : [];
    return {kind:"disposition",policy,rows:rows.slice(0,15),offset,next:rows.length>15?offset+15:null,message};
  }
  if (data.type==="dispositionQueue") return queue(current??null,data.offset);
  if (data.type==="saveDispositionPolicy") {
    const prior = db.prepare("SELECT * FROM loan_retention_policies WHERE id=?").get(data.id);
    if (prior) {
      if (prior.actorEmail!==staff.email || prior.version!==data.expected+1 || prior.fundedDays!==data.fundedDays ||
        prior.closedDays!==data.closedDays || prior.reference!==data.reference) return {error:"This request belongs to a different policy change."};
      return queue(current??null,0,"Retention policy saved.");
    }
    if ((current?.version??0)!==data.expected) return {error:"The policy changed. Refresh before saving."};
    const saved = {version:data.expected+1,fundedDays:data.fundedDays,closedDays:data.closedDays,reference:data.reference,at:now,actor:staff.name};
    db.prepare("INSERT INTO loan_retention_policies VALUES (?,?,?,?,?,?,?,?)")
      .run(saved.version,data.id,saved.fundedDays,saved.closedDays,saved.reference,now,staff.name,staff.email);
    accessEvent(db,staff,"Saved retention policy",String(saved.version),now);
    return queue(saved,0,"Retention policy saved.");
  }
  const prior = db.prepare("SELECT * FROM loan_retention_reviews WHERE id=?").get(data.id);
  if (prior) {
    if (prior.actorEmail!==staff.email || prior.loanId!==data.loanId || prior.policyVersion!==data.policyVersion ||
      prior.basis!==data.basis || prior.previous!==data.previous || prior.outcome!==data.outcome || prior.reference!==data.reference)
      return {error:"This request belongs to a different disposition review."};
    return queue(current??null,data.offset,"Disposition review recorded.");
  }
  if (!current || current.version!==data.policyVersion) return {error:"The policy changed. Refresh before recording a review."};
  const row = candidates(db,current,today,data.loanId,0)[0];
  if (!row || row.basis!==data.basis || (row.decision?.id??null)!==data.previous)
    return {error:"This loan changed or is no longer due for review. Refresh the queue."};
  db.prepare("INSERT INTO loan_retention_reviews VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(data.id,data.loanId,current.version,data.basis,data.previous,data.outcome,data.reference,now,staff.name,staff.email);
  accessEvent(db,staff,"Recorded retention disposition review",data.loanId,now);
  return queue(current,data.offset,"Disposition review recorded.");
}
