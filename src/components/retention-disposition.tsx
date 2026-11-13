"use client";

import { useEffect, useRef, useState } from "react";
import { accessLoanRetention } from "@/app/actions";
import type { DispositionQueue } from "@/lib/retention-disposition";
import { MichiganRetention } from "./michigan-retention";
import { RetentionAudit } from "./retention-audit";
import { Button } from "./ui/button";

type Candidate = DispositionQueue["rows"][number];
type Review = {kind:"policy"; id:string; funded:string; closed:string; reference:string} |
  {kind:"loan"; id:string; row:Candidate; outcome:"Continue retaining"|"Recommend disposition"; reference:string;
    counsel:{retainThrough:string; reference:string}};

function MichiganRetentionStatus({ row }: { row: Candidate }) {
  if (!row.michigan) return null;
  const stateDate = row.michigan.stateReviewDate;
  const counselDate = row.decision?.counsel?.retainThrough;
  return <p><strong>Michigan retention</strong> · {row.michigan.gap ?? <>
    {row.retainMichiganThroughToday ? "Retain through " : "State review date "}
    <time className="whitespace-nowrap" dateTime={stateDate??undefined}>{stateDate}</time>.
    {!row.retainMichiganThroughToday && (counselDate ?
      <> Counsel reviewed through <time className="whitespace-nowrap" dateTime={counselDate}>{counselDate}</time>.</> :
      " Record counsel’s review for a recommendation.")}
  </>}</p>;
}

export function RetentionDisposition({ brokerageId, openLoan, onBack }:{
  brokerageId:string; openLoan:(id:string)=>void; onBack:()=>void;
}) {
  const [showAudit,setShowAudit] = useState(false);
  const [evidence,setEvidence] = useState<Candidate>();
  const auditLink = useRef<HTMLButtonElement>(null);
  const evidenceLinks = useRef(new Map<string,HTMLButtonElement>());
  const returnEvidenceId = useRef<string>(null);
  const returningToReview = useRef(false);
  const [queue,setQueue] = useState<DispositionQueue>();
  const [review,setReview] = useState<Review>();
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [notice,setNotice] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const formHeading = useRef<HTMLHeadingElement>(null);
  const receipt = useRef<HTMLParagraphElement>(null);
  const origin = useRef<HTMLButtonElement>(null);

  useEffect(()=>{
    let active=true;
    heading.current?.focus();
    void accessLoanRetention({type:"dispositionQueue",offset:0},brokerageId).then(result=>{
      if (!active) return;
      if ("error" in result) setError(result.error);
      else if (result.kind==="disposition") setQueue(result);
    }).catch(()=>{if(active)setError("Could not load the review queue. Try again.");});
    return ()=>{active=false;};
  },[brokerageId]);
  const opened = review?.kind;
  useEffect(()=>{if(opened)formHeading.current?.focus();},[opened]);
  useEffect(()=>{
    if (!evidence && !busy && returnEvidenceId.current) {
      const button = evidenceLinks.current.get(returnEvidenceId.current);
      (button ?? heading.current)?.focus();
      returnEvidenceId.current = null;
    }
    if (!review && !busy && returningToReview.current) {
      (notice ? receipt.current : origin.current?.isConnected ? origin.current : heading.current)?.focus();
      returningToReview.current = false;
    }
  },[evidence,busy,queue,review,notice]);

  async function submit(input:unknown, saved=false) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await accessLoanRetention(input,brokerageId);
      if ("error" in result) setError(result.error);
      else if (result.kind==="disposition") {
        setQueue(result);
        setNotice(result.message??"");
        if (saved) closeReview();
      }
    } catch { setError("Could not confirm the update. Try again."); }
    finally {setBusy(false);}
  }

  function closeReview() {
    returningToReview.current = true;
    setReview(undefined);
  }

  const policy = queue?.policy;
  const enabled = !!(policy?.fundedDays || policy?.closedDays);
  const refresh = () => void submit({type:"dispositionQueue",offset:0},true);
  const canRecommend = review?.kind==="loan" && (!review.row.michigan || (!review.row.michigan.gap && !review.row.retainMichiganThroughToday));
  const needsCounsel = review?.kind==="loan" && !!review.row.michigan && review.outcome==="Recommend disposition";

  if (evidence) return <MichiganRetention brokerageId={brokerageId}
    target={{kind:"loan",id:evidence.id,label:evidence.borrower}} backLabel="Back to disposition review" onBack={()=>{
      returnEvidenceId.current=evidence.id;
      setEvidence(undefined);
      void submit({type:"dispositionQueue",offset:queue?.offset??0});
    }} />;

  if (showAudit) return <RetentionAudit brokerageId={brokerageId} openLoan={openLoan} onBack={()=>{
    setShowAudit(false);
    requestAnimationFrame(()=>auditLink.current?.focus());
  }} />;

  return <div className="integration manager-panel record-form loan-retention">
    <div className="section-heading">
      <h2 tabIndex={-1} ref={heading}>Disposition review</h2>
      <div className="loan-application-actions">
        <Button ref={auditLink} type="button" variant="outline" disabled={busy||!!review} onClick={()=>setShowAudit(true)}>Retention audit</Button>
        <Button type="button" variant="outline" disabled={busy} onClick={onBack}>Back to loan retention</Button>
      </div>
    </div>
    {error && <div className="record-form"><p role="alert">{error}</p>
      <div><Button type="button" variant="outline" disabled={busy} onClick={refresh}>Refresh queue</Button></div>
    </div>}
    {notice && <p ref={receipt} role="status" tabIndex={-1}>{notice}</p>}
    {!queue && !error && <p role="status">Loading disposition review…</p>}
    {queue && <div className="document-item record-form">
      <div className="section-heading">
        <h3>Brokerage policy</h3>
        <Button type="button" variant="outline" disabled={busy || !!review} onClick={event=>{
          origin.current=event.currentTarget;
          setNotice("");
          setReview({kind:"policy",id:crypto.randomUUID(),funded:String(policy?.fundedDays??""),closed:String(policy?.closedDays??""),reference:""});
        }}>{policy ? "Edit policy" : "Set policy"}</Button>
      </div>
      {policy ? <>
        <p>Funded {policy.fundedDays===null ? "· Review off" : `· ${policy.fundedDays} calendar days`}<br/>
          Withdrawn or lost {policy.closedDays===null ? "· Review off" : `· ${policy.closedDays} calendar days`}</p>
        <p className="muted">Version {policy.version} · {policy.reference} · {policy.actor}</p>
      </> : <p className="muted">Enter the periods your brokerage approved to start reviewing loans.</p>}
    </div>}
    {review && <form className="document-item record-form" onSubmit={event=>{
      event.preventDefault();
      const fields={id:review.id,reference:review.reference};
      void submit(review.kind==="policy" ? {type:"saveDispositionPolicy",...fields,expected:policy?.version??0,
        fundedDays:review.funded ? Number(review.funded) : null,closedDays:review.closed ? Number(review.closed) : null} :
        {type:"saveDispositionReview",...fields,loanId:review.row.id,basis:review.row.basis,policyVersion:policy?.version,
          previous:review.row.decision?.id??null,outcome:review.outcome,offset:queue?.offset??0,
          ...(needsCounsel?{counsel:review.counsel}:{})},true);
    }}>
      <h3 ref={formHeading} tabIndex={-1}>{review.kind==="policy" ? "Edit brokerage policy" : `Review ${review.row.borrower}`}</h3>
      {review.kind==="policy" ? <>
        <p className="muted">Enter calendar days after funding or the recorded withdrawal or loss. Leave a category blank to turn off its review.</p>
        <label className="field">Funded loan period in days
          <input type="number" min="1" max="36500" step="1" value={review.funded} disabled={busy}
            onChange={event=>setReview({...review,id:crypto.randomUUID(),funded:event.target.value})}/>
        </label>
        <label className="field">Withdrawn or lost loan period in days
          <input type="number" min="1" max="36500" step="1" value={review.closed} disabled={busy}
            onChange={event=>setReview({...review,id:crypto.randomUUID(),closed:event.target.value})}/>
        </label>
      </> : <>
        <MichiganRetentionStatus row={review.row} />
        <p className="muted">Recording a recommendation leaves the loan and documents in place.</p>
        <label className="field w-full max-w-2xl">Review outcome
          <select value={review.outcome} disabled={busy} onChange={event=>setReview({...review,id:crypto.randomUUID(),
            outcome:event.target.value==="Recommend disposition"?"Recommend disposition":"Continue retaining"})}>
            <option>Continue retaining</option>{canRecommend && <option>Recommend disposition</option>}
          </select>
        </label>
        {needsCounsel && <div className="record-form w-full max-w-2xl">
          <label className="field">Counsel-reviewed retain-through date
            <input type="date" required value={review.counsel.retainThrough} disabled={busy}
              onChange={event=>setReview({...review,id:crypto.randomUUID(),counsel:{...review.counsel,retainThrough:event.target.value}})} />
          </label>
          <label className="field">Counsel review reference
            <textarea required rows={2} minLength={4} maxLength={240} value={review.counsel.reference} disabled={busy}
              onChange={event=>setReview({...review,id:crypto.randomUUID(),counsel:{...review.counsel,reference:event.target.value}})} />
          </label>
        </div>}
      </>}
      <label className={review.kind==="policy"?"field":"field w-full max-w-2xl"}>
        {review.kind==="policy"?"Brokerage approval reference":"Review reference or reason"}
        <textarea required minLength={4} maxLength={240} rows={2} value={review.reference} disabled={busy}
          onChange={event=>setReview({...review,id:crypto.randomUUID(),reference:event.target.value})}/>
      </label>
      <div className="loan-application-actions">
        <Button type="submit" disabled={busy || review.reference.trim().length<4}>{busy?"Saving…":review.kind==="policy"?"Save policy":"Record review"}</Button>
        <Button type="button" variant="outline" disabled={busy} onClick={closeReview}>Cancel</Button>
      </div>
    </form>}
    {queue && enabled && <section className="record-form" aria-label="Loans due for disposition review" aria-busy={busy}>
      <div className="section-heading"><h3>Loans due for review</h3>
        <Button type="button" variant="outline" disabled={busy||!!review} onClick={refresh}>Refresh queue</Button></div>
      <p className="muted">Includes loans with a recorded outcome date. Active holds keep loans out of the queue.</p>
      {!queue.rows.length && <p>No loans are due for review.</p>}
      <ul className="loan-task-list">{queue.rows.map(row=><li key={row.id} className="loan-task document-item record-form">
        <div className="section-heading"><strong>{row.borrower}</strong><span>{row.decision?.outcome??"Needs review"}</span></div>
        <p className="muted">{row.category} <time className="whitespace-nowrap" dateTime={row.eventDate}>{row.eventDate}</time>
          {" · "}Internal review due <time className="whitespace-nowrap" dateTime={row.reviewOn}>{row.reviewOn}</time></p>
        <MichiganRetentionStatus row={row} />
        {row.decision && <p>{row.decision.reference} · {row.decision.actor}</p>}
        <div className="loan-application-actions">
          <Button type="button" variant="outline" disabled={busy||!!review} onClick={()=>openLoan(row.id)}>Open loan</Button>
          {row.michigan && <Button type="button" variant="outline" disabled={busy||!!review}
            ref={node=>{if(node)evidenceLinks.current.set(row.id,node);else evidenceLinks.current.delete(row.id);}}
            onClick={()=>setEvidence(row)}>Michigan evidence</Button>}
          <Button type="button" variant="outline" disabled={busy||!!review} onClick={event=>{
            origin.current=event.currentTarget;
            setNotice("");
            setReview({kind:"loan",id:crypto.randomUUID(),row,outcome:row.decision?.outcome??"Continue retaining",reference:"",
              counsel:row.decision?.counsel??{retainThrough:"",reference:""}});
          }}>{row.decision?"Update review":"Review loan"}</Button>
        </div>
      </li>)}</ul>
      {(queue.offset>0||queue.next!==null)&&<div className="loan-application-actions">
        <Button type="button" variant="outline" disabled={busy||!!review||queue.offset===0}
          onClick={()=>void submit({type:"dispositionQueue",offset:Math.max(0,queue.offset-15)})}>Previous loans</Button>
        <Button type="button" variant="outline" disabled={busy||!!review||queue.next===null}
          onClick={()=>void submit({type:"dispositionQueue",offset:queue.next})}>Next loans</Button>
      </div>}
    </section>}
  </div>;
}
