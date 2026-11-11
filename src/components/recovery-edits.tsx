"use client";

import {useRef,useState,type FormEvent} from "react";
import type {RecoveryEditInspection} from "@/lib/recovery-edit-model";
import type {MaintenanceView} from "@/lib/workspace-maintenance-model";
import {Button} from "./ui/button";

const date=(value:string|null)=>value??"No due date";
export function RecoveryEdits({endpoint,revision,paused,onReviewed}:{endpoint:string;revision:number;paused:boolean;onReviewed:(view:MaintenanceView)=>void}) {
  const [report,setReport]=useState<RecoveryEditInspection|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const [message,setMessage]=useState(""),[reviewing,setReviewing]=useState<string|null>(null),[expanded,setExpanded]=useState<string|null>(null);
  const feedback=useRef<HTMLParagraphElement>(null),heading=useRef<HTMLHeadingElement>(null);
  async function inspect(offset=0) {
    setBusy(true);setError("");setMessage("");
    try {
      const response=await fetch(`${endpoint}&edits=1&revision=${revision}&offset=${offset}`);
      const result=await response.json() as {inspection?:RecoveryEditInspection;error?:string};
      if(!response.ok||!result.inspection)throw new Error(result.error??"Could not inspect internal edits.");
      setReport(result.inspection);requestAnimationFrame(()=>heading.current?.focus());
    }catch(failure){setError(failure instanceof Error?failure.message:"Could not inspect internal edits.");}
    finally{setBusy(false);}
  }
  async function confirm(event:FormEvent<HTMLFormElement>,item:RecoveryEditInspection["items"][number]) {
    event.preventDefault();if(!report)return;
    const note=new FormData(event.currentTarget).get("note");setReviewing(item.id);setBusy(true);setError("");setMessage("");
    try {
      const response=await fetch(`${endpoint}&edits=1`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
        revision,offset:report.offset,id:item.id,fingerprint:item.fingerprint,note})});
      const result=await response.json() as {view?:MaintenanceView;error?:string};
      if(!response.ok||!result.view)throw new Error(result.error??"Could not record the outcome. Your note is retained.");
      onReviewed(result.view);setExpanded(null);
      setMessage("Saved proof verified. Complete a new reopening review.");
      try {
        const fresh=await fetch(`${endpoint}&edits=1&revision=${result.view.revision}&offset=${report.offset}`);
        const body=await fresh.json() as {inspection?:RecoveryEditInspection};
        if(fresh.ok&&body.inspection)setReport(body.inspection);
      }catch{/* The recorded outcome is still saved; the stale-page notice offers refresh. */}
      requestAnimationFrame(()=>feedback.current?.focus());
    }catch(failure){setError(failure instanceof Error?failure.message:"Could not record the outcome. Your note is retained.");}
    finally{setBusy(false);setReviewing(null);}
  }
  return <section className="pipeline relationship-panel maintenance-inspection" aria-label="Internal edit recovery">
    <div className="section-heading"><div><h2 ref={heading} tabIndex={-1}>Internal edits</h2><p className="muted">Review due-date changes and their saved receipts.</p></div>
      <Button variant="outline" disabled={busy||!paused} onClick={()=>void inspect()}>{busy?(reviewing?"Recording outcome…":"Checking edits…"):report?"Refresh edit history":"Inspect internal edits"}</Button></div>
    <p className="muted">Covers direct document due-date changes in this pilot from this release onward. Older edits, coverage actions and other workflows are not included. No lender request is retried here.</p>
    {error&&<p role="alert" className="application-message banner-error">{error}{report?" The previous inspection remains below.":""}</p>}
    {message&&<p ref={feedback} tabIndex={-1} role="status" className="application-message">{message}</p>}
    {report&&<>
      {report.revision!==revision&&<p role="status" className="application-message">Maintenance changed. Refresh edit history before recording another outcome.</p>}
      {!report.total?<p>No covered edits have been recorded yet. This does not prove that no other work occurred.</p>:<>
        <div className="section-heading"><p>Showing {report.offset+1}–{report.offset+report.items.length} of {report.total}</p>
          <nav className="loan-application-actions" aria-label="Internal edit pages">
            <Button variant="outline" disabled={busy||!paused||!report.offset} onClick={()=>void inspect(Math.max(0,report.offset-25))}>Previous edits</Button>
            <Button variant="outline" disabled={busy||!paused||report.next===null} onClick={()=>void inspect(report.next!)}>Next edits</Button>
          </nav></div>
        <ul className="inspection-items">{report.items.map(item=><li key={item.id}>
          <div className="section-heading"><strong>{item.recordName}</strong><span className="pill">{item.state==="Pending"?"Outcome unconfirmed":item.state==="Rejected"?"Edit rejected":item.state==="Reviewed"?"Outcome reviewed":"Outcome recorded"}</span></div>
          <p>{item.label} · {date(item.before.dueOn)} → {date(item.command.dueOn)}</p>
          <p className="muted">{item.actor} · {new Date(item.at).toLocaleString()}</p>
          <p><strong>{item.finding}</strong>{item.current?` · Current due date: ${date(item.current.dueOn)}`:""}</p>
          <details><summary>Revision evidence</summary>
            <p>Before: document {item.before.revision}, due-date revision {item.before.deadlineRevision}.</p>
            <p>Expected: document {item.command.revision}, due-date revision {item.before.deadlineRevision+1}.</p>
            <p>{item.sourceProof?"A receipt saved with this change is present.":"No matching edit receipt was found in this workspace state."}</p>
            <p>{item.proof?"A matching result was retained in the recovery directory.":"No result has been confirmed outside the tenant."}</p>
            <p>Reference: <code>{item.id}</code></p>
          </details>
          {item.review&&<p className="muted">Reviewed by {item.review.actor} · {new Date(item.review.at).toLocaleString()}<br/>{item.review.note}</p>}
          {item.canConfirm?<details open={expanded===item.id} onToggle={event=>{if(event.currentTarget.open)setExpanded(item.id);else setExpanded(current=>current===item.id?null:current);}}><summary>Review saved outcome</summary><form className="maintenance-form" onSubmit={event=>void confirm(event,item)}>
            <p>The saved receipt matches this intended edit. Record that evidence without applying the change again.</p>
            <label className="field">Review note<textarea name="note" required minLength={20} maxLength={1000} rows={3} disabled={busy||report.revision!==revision}/></label>
            <Button type="submit" disabled={busy||!paused||report.revision!==revision}>{reviewing===item.id?"Recording…":"Record verified outcome"}</Button>
          </form></details>:item.state==="Pending"&&<p className="muted">Keep this outcome unresolved until matching saved proof is available. A matching date alone does not prove this edit ran.</p>}
        </li>)}</ul>
      </>}
    </>}
  </section>;
}
