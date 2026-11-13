import { floridaDispositionEvidence, type FloridaDispositionEvidence } from "./florida-recordkeeping";
import { coloradoDispositionEvidence, type ColoradoDispositionEvidence } from "./colorado-recordkeeping";
import { coloradoLocalDate } from "./colorado-recordkeeping-model";
import { createHash } from "node:crypto";
import { californiaDreDispositionEvidence, californiaDreRetentionLocalDate, type CaliforniaDreDispositionEvidence } from "./california-dre-recordkeeping";
import { californiaDfpiDispositionEvidence, type CaliforniaDfpiDispositionEvidence } from "./california-dfpi-recordkeeping";
import { z } from "zod";
import { easternDate } from "./client-retention";
import { michiganDispositionEvidence, michiganLoanState, type MichiganDispositionEvidence } from "./michigan-retention";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { accessEvent } from "./workspace-access";

const days = z.number().int().min(1).max(36500).nullable();
const reference = z.string().trim().min(4).max(240);
const offset = z.number().int().min(0).max(10000);
const outcomes = ["Continue retaining", "Recommend disposition"] as const;
const counselReview = z.object({ retainThrough:z.iso.date(), reference });
export const dispositionRequest = z.discriminatedUnion("type", [
  z.object({type:z.literal("dispositionQueue"),offset}),
  z.object({type:z.literal("saveDispositionPolicy"),id:z.uuid(),expected:z.number().int().nonnegative(),
    fundedDays:days,closedDays:days,reference}),
  z.object({type:z.literal("saveDispositionReview"),id:z.uuid(),loanId:z.string().min(1).max(200),
    policyVersion:z.number().int().positive(),basis:z.string().max(320),previous:z.uuid().nullable(),
    outcome:z.enum(outcomes),reference,offset,counsel:counselReview.optional()}),
]);
type Command = z.infer<typeof dispositionRequest>;
type Policy = {version:number; fundedDays:number|null; closedDays:number|null; reference:string; at:string; actor:string};
type Decision = {id:string; outcome:typeof outcomes[number]; reference:string; at:string; actor:string;
  counsel?:z.infer<typeof counselReview>};
export type MichiganDispositionReview = { evidence:MichiganDispositionEvidence; counsel:z.infer<typeof counselReview>|null };
export type CaliforniaDispositionReview = {
  evidence: { authority: string; gap: string | null; stateReviewDate: string | null; detail: CaliforniaDreDispositionEvidence | CaliforniaDfpiDispositionEvidence }[];
  counsel: z.infer<typeof counselReview> | null;
};
export type ColoradoDispositionReview = { evidence:ColoradoDispositionEvidence; counsel:z.infer<typeof counselReview>|null };
export type FloridaDispositionReview = { evidence:FloridaDispositionEvidence; counsel:z.infer<typeof counselReview>|null };
type StateDispositionReview = MichiganDispositionReview | CaliforniaDispositionReview | ColoradoDispositionReview | FloridaDispositionReview;
type Candidate = {id:string; borrower:string; category:string; eventDate:string; reviewOn:string; basis:string;
  decision:Decision|null; michigan:MichiganDispositionEvidence|null; retainMichiganThroughToday:boolean; california:CaliforniaDispositionReview["evidence"]; retainCaliforniaThroughToday:boolean; colorado:ColoradoDispositionEvidence|null; retainColoradoThroughToday:boolean; florida:FloridaDispositionEvidence|null; retainFloridaThroughToday:boolean };
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
    outcome TEXT NOT NULL, reference TEXT NOT NULL, at TEXT NOT NULL, actor TEXT NOT NULL, actorEmail TEXT NOT NULL, michiganReview TEXT, californiaReview TEXT, coloradoReview TEXT, floridaReview TEXT
  );
  CREATE INDEX IF NOT EXISTS retention_reviews_by_loan ON loan_retention_reviews(loanId,policyVersion,basis);
  CREATE INDEX IF NOT EXISTS retention_closed_loans ON loans(disposition,dispositionDate,id)
    WHERE disposition IN ('Withdrawn','Lost') AND dispositionDate IS NOT NULL;`);
  const columns = db.prepare("PRAGMA table_info(loan_retention_reviews)").all();
  for (const name of ["michiganReview", "californiaReview", "coloradoReview", "floridaReview"]) {
    if (!columns.some(row=>row.name===name)) db.exec(`ALTER TABLE loan_retention_reviews ADD COLUMN ${name} TEXT`);
  }
}

function candidates(db:Store, policy:Policy, today:string, pacificToday:string, mountainToday:string, now:string, brokerageId:string, loanId:string|null, offset:number):Candidate[] {
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
  SELECT d.id,d.borrower,d.category,d.eventDate,d.reviewOn,d.basis,
    nullif(${michiganLoanState("a.draft")},'') AS propertyState,
    nullif(upper(trim(json_extract(report.facts,'$.state'))),'') AS reportState,
    l.stage,l.disposition,l.dispositionDate,f.fundingDate,p.closingDate
  FROM due d JOIN loans l ON l.id=d.id LEFT JOIN applications a ON a.loanId=d.id
  LEFT JOIN closing_progress f ON f.loanId=d.id LEFT JOIN past_client_profiles p ON p.loanId=d.id
  LEFT JOIN call_report_facts report ON report.loanId=d.id
  WHERE d.reviewOn<=? ORDER BY d.reviewOn,d.id LIMIT 16 OFFSET ?`)
    .all(policy.fundedDays,policy.closedDays,loanId,loanId,today,offset) as
    (Pick<Candidate,"id"|"borrower"|"category"|"eventDate"|"reviewOn"|"basis"> & {propertyState:string|null; reportState:string|null; stage:string;
      disposition:string; dispositionDate:string|null; fundingDate:string|null; closingDate:string|null})[];
  const readDecision = db.prepare(`SELECT id,outcome,reference,at,actor,michiganReview,californiaReview,coloradoReview,floridaReview FROM loan_retention_reviews
    WHERE loanId=? AND policyVersion=? AND basis=? ORDER BY rowid DESC LIMIT 1`);
  return rows.map(({propertyState,reportState,stage,disposition,dispositionDate,fundingDate,closingDate,...row})=>{
    const michigan = michiganDispositionEvidence(db,row.id,propertyState,row.category);
    const michiganBasis = michigan ? [row.basis,"MI",propertyState??"",...michigan.versions.map(version=>version.id)].join("/") : row.basis;
    const dfpi = californiaDfpiDispositionEvidence(db,brokerageId,{id:row.id,propertyState,reportState},pacificToday);
    const dre = californiaDreDispositionEvidence(db,brokerageId,{id:row.id,propertyState,reportState,stage,disposition,dispositionDate,fundingDate,closingDate});
    const california: CaliforniaDispositionReview["evidence"] = dfpi.map(detail => ({
      authority:detail.authority,gap:detail.gap,stateReviewDate:detail.stateReviewDate,detail,
    }));
    if (dre && (dre.version !== null || !dfpi.length))
      california.unshift({authority:"DRE",gap:dre.gap,stateReviewDate:dre.stateReviewDate,detail:dre});
    const californiaBasis = california.length ? `${michiganBasis}/CA/${createHash("sha256").update(JSON.stringify(california)).digest("hex")}` : michiganBasis;
    const colorado = coloradoDispositionEvidence(db,brokerageId,{id:row.id,propertyState,reportState},now);
    const florida = floridaDispositionEvidence(db,brokerageId,{id:row.id,propertyState,reportState,
      closed:stage==="Closed" || stage==="Funded" || Boolean(fundingDate || closingDate)},now);
    const coloradoBasis = colorado ? `${californiaBasis}/CO/${createHash("sha256").update(JSON.stringify(colorado)).digest("hex")}` : californiaBasis;
    const basis = florida ? `${coloradoBasis}/FL/${createHash("sha256").update(JSON.stringify(florida)).digest("hex")}` : coloradoBasis;
    const saved = readDecision.get(row.id,policy.version,basis) as (Decision & {michiganReview:string|null;californiaReview:string|null;coloradoReview:string|null;floridaReview:string|null})|undefined;
    let decision:Decision|null = null;
    if (saved) {
      const {michiganReview,californiaReview,coloradoReview,floridaReview,...review} = saved;
      const snapshot = michiganReview ?? californiaReview ?? coloradoReview ?? floridaReview;
      const counsel = snapshot ? (JSON.parse(snapshot) as StateDispositionReview).counsel : null;
      decision = counsel ? {...review,counsel} : review;
    }
    return {...row,basis,michigan,decision,california,colorado,florida,
      retainFloridaThroughToday:!!florida?.stateReviewDate && florida.stateReviewDate>=floridaToday(now,florida),
      retainColoradoThroughToday:!!colorado?.stateReviewDate && colorado.stateReviewDate>=mountainToday,
      retainCaliforniaThroughToday:california.some(entry=>!!entry.stateReviewDate && entry.stateReviewDate>=pacificToday),
      retainMichiganThroughToday:!!michigan?.stateReviewDate && michigan.stateReviewDate>=today};
  });
}

function floridaToday(now:string, evidence:FloridaDispositionEvidence) {
  const zone = evidence.facts?.zone ?? "America/New_York";
  return new Intl.DateTimeFormat("en-CA",{timeZone:zone,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(now));
}

// Runs inside loanRetentionWork's owner-scoped transaction.
export function retentionDispositionWork(db:Store, data:Command, staff:WorkspaceStaff, now:string):DispositionQueue|{error:string} {
  const current = db.prepare("SELECT version,fundedDays,closedDays,reference,at,actor FROM loan_retention_policies ORDER BY version DESC LIMIT 1")
    .get() as Policy|undefined;
  const today = easternDate(new Date(now));
  const pacificToday = californiaDreRetentionLocalDate(now);
  const mountainToday = coloradoLocalDate(now);
  const brokerageId = staff.brokerage.id;
  function queue(policy:Policy|null, offset:number, message?:string):DispositionQueue {
    const rows = policy && (policy.fundedDays || policy.closedDays) ? candidates(db,policy,today,pacificToday,mountainToday,now,brokerageId,null,offset) : [];
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
    const snapshot = prior.michiganReview ?? prior.californiaReview ?? prior.coloradoReview ?? prior.floridaReview;
    const priorReview = snapshot ? JSON.parse(String(snapshot)) as StateDispositionReview : null;
    if (prior.actorEmail!==staff.email || prior.loanId!==data.loanId || prior.policyVersion!==data.policyVersion ||
      prior.basis!==data.basis || prior.previous!==data.previous || prior.outcome!==data.outcome || prior.reference!==data.reference ||
      JSON.stringify(priorReview?.counsel??null)!==JSON.stringify(data.counsel??null))
      return {error:"This request belongs to a different disposition review."};
    return queue(current??null,data.offset,"Disposition review recorded.");
  }
  if (!current || current.version!==data.policyVersion) return {error:"The policy changed. Refresh before recording a review."};
  const row = candidates(db,current,today,pacificToday,mountainToday,now,brokerageId,data.loanId,0)[0];
  if (!row || row.basis!==data.basis || (row.decision?.id??null)!==data.previous)
    return {error:"This loan changed or is no longer due for review. Refresh the queue."};
  const recommending = data.outcome==="Recommend disposition";
  if (data.counsel && ((!row.michigan && !row.california.length && !row.colorado && !row.florida) || !recommending))
    return {error:"Counsel evidence belongs with a state disposition recommendation."};
  if (row.michigan && recommending) {
    if (row.michigan.gap || !row.michigan.stateReviewDate)
      return {error:row.michigan.gap??"Resolve the Michigan evidence before recommending disposition."};
    if (row.retainMichiganThroughToday)
      return {error:`Retain the record through the Michigan review date of ${row.michigan.stateReviewDate}.`};
    if (!data.counsel)
      return {error:"Record counsel’s review reference and retain-through date before recommending disposition."};
    if (data.counsel.retainThrough<row.michigan.stateReviewDate)
      return {error:"The counsel-reviewed date is earlier than the latest Michigan date. Reconcile the evidence."};
    if (data.counsel.retainThrough>=today)
      return {error:`Retain the record through the counsel-reviewed date of ${data.counsel.retainThrough}.`};
  }
  if (recommending) for (const evidence of row.california) {
    const date = evidence.stateReviewDate;
    if (evidence.gap || !date) return {error:evidence.gap ?? `Resolve the California ${evidence.authority} evidence before recommending disposition.`};
    if (date>=pacificToday) return {error:`Retain the record through the California review date of ${date}.`};
    if (!data.counsel) return {error:"Record counsel’s review reference and retain-through date before recommending disposition."};
    if (data.counsel.retainThrough<date) return {error:"The counsel-reviewed date is earlier than the latest California date. Reconcile the evidence."};
    if (data.counsel.retainThrough>=pacificToday) return {error:`Retain the record through the counsel-reviewed date of ${data.counsel.retainThrough}.`};
  }
  if (recommending && row.colorado) {
    const date = row.colorado.stateReviewDate;
    if (row.colorado.gap || !date) return {error:row.colorado.gap ?? "Resolve Colorado evidence before recommending disposition."};
    if (date>=mountainToday) return {error:`Retain the record through the Colorado review date of ${date}.`};
    if (!data.counsel) return {error:"Record counsel’s review reference and retain-through date before recommending disposition."};
    if (data.counsel.retainThrough<date) return {error:"The counsel-reviewed date is earlier than the latest Colorado date. Reconcile the evidence."};
    if (data.counsel.retainThrough>=mountainToday) return {error:`Retain the record through the counsel-reviewed date of ${data.counsel.retainThrough}.`};
  }
  if (recommending && row.florida) {
    const date = row.florida.stateReviewDate;
    if (row.florida.gap || !date) return {error:row.florida.gap ?? "Resolve Florida evidence before recommending disposition."};
    if (row.retainFloridaThroughToday) return {error:`Retain the record through the Florida review date of ${date}.`};
    if (!data.counsel) return {error:"Record counsel’s review reference and retain-through date before recommending disposition."};
    if (data.counsel.retainThrough<date) return {error:"The counsel-reviewed date is earlier than the latest Florida date. Reconcile the evidence."};
    if (data.counsel.retainThrough>=floridaToday(now,row.florida)) return {error:`Retain the record through the counsel-reviewed date of ${data.counsel.retainThrough}.`};
  }
  const floridaReview = row.florida ?
    JSON.stringify({evidence:row.florida,counsel:data.counsel??null} satisfies FloridaDispositionReview) : null;
  const coloradoReview = row.colorado ?
    JSON.stringify({evidence:row.colorado,counsel:data.counsel??null} satisfies ColoradoDispositionReview) : null;
  const californiaReview = row.california.length ?
    JSON.stringify({evidence:row.california,counsel:data.counsel??null} satisfies CaliforniaDispositionReview) : null;
  const michiganReview = row.michigan ? JSON.stringify({evidence:row.michigan,counsel:data.counsel??null} satisfies MichiganDispositionReview) : null;
  db.prepare(`INSERT INTO loan_retention_reviews
    (id,loanId,policyVersion,basis,previous,outcome,reference,at,actor,actorEmail,michiganReview,californiaReview,coloradoReview,floridaReview) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(data.id,data.loanId,current.version,data.basis,data.previous,data.outcome,data.reference,now,staff.name,staff.email,michiganReview,californiaReview,coloradoReview,floridaReview);
  accessEvent(db,staff,"Recorded retention disposition review",data.loanId,now);
  return queue(current,data.offset,"Disposition review recorded.");
}
