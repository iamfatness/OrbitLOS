"use client";

import {useEffect,useEffectEvent,useRef,useState,type FormEvent} from "react";
import type {RecoveryEditInspection} from "@/lib/recovery-edit-model";
import type {MaintenanceView} from "@/lib/workspace-maintenance-model";
import {Button} from "./ui/button";

const date=(value:string|null)=>value??"No due date";
const checklistStatus=(completed:boolean)=>completed?"Completed":"Open";
export function RecoveryEdits({endpoint,revision,paused,onReviewed,shortcut}:{endpoint:string;revision:number;paused:boolean;
  onReviewed:(view:MaintenanceView)=>void;shortcut?:{pendingOnly:boolean}}) {
  const [report,setReport]=useState<RecoveryEditInspection|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const [message,setMessage]=useState(""),[reviewing,setReviewing]=useState<string|null>(null),[expanded,setExpanded]=useState<string|null>(null);
  const feedback=useRef<HTMLParagraphElement>(null),heading=useRef<HTMLHeadingElement>(null),pendingReplay=useRef<HTMLDivElement>(null);
  const inspectionFocus=useRef<"heading"|"replay"|null>(null);
  useEffect(()=>{
    if(!report||!inspectionFocus.current)return;
    (inspectionFocus.current==="replay"&&pendingReplay.current?pendingReplay.current:heading.current)?.focus();
    inspectionFocus.current=null;
  },[report]);
  const url=(revision:number,offset:number,pendingOnly?:boolean)=>`${endpoint}&edits=1&revision=${revision}&offset=${offset}${pendingOnly?"&pending=1":""}`;
  async function inspect(offset=0,pendingOnly=report?.pendingOnly,focusReplay=false) {
    setBusy(true);setError("");setMessage("");
    try {
      const response=await fetch(url(revision,offset,pendingOnly));
      const result=await response.json() as {inspection?:RecoveryEditInspection;error?:string};
      if(!response.ok||!result.inspection)throw new Error(result.error??"Could not inspect internal edits.");
      inspectionFocus.current=focusReplay?"replay":"heading";
      setReport(result.inspection);
    }catch(failure){setError(failure instanceof Error?failure.message:"Could not inspect internal edits.");}
    finally{setBusy(false);}
  }
  const openShortcut=useEffectEvent((pendingOnly:boolean)=>{void inspect(0,pendingOnly,!pendingOnly);});
  useEffect(()=>{
    if(!shortcut||!paused)return;
    const frame=requestAnimationFrame(()=>openShortcut(shortcut.pendingOnly));
    return ()=>cancelAnimationFrame(frame);
  },[shortcut,paused]);
  async function confirm(event:FormEvent<HTMLFormElement>,item:RecoveryEditInspection["items"][number]) {
    event.preventDefault();if(!report)return;
    const note=new FormData(event.currentTarget).get("note");setReviewing(item.id);setBusy(true);setError("");setMessage("");
    try {
      const response=await fetch(`${endpoint}&edits=1`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
        revision,offset:report.offset,pendingOnly:report.pendingOnly,id:item.id,fingerprint:item.fingerprint,note})});
      const result=await response.json() as {view?:MaintenanceView;error?:string};
      if(!response.ok||!result.view)throw new Error(result.error??"Could not record the outcome. Your note is retained.");
      onReviewed(result.view);setExpanded(null);
      setMessage("Saved proof verified. Complete a new reopening review.");
      try {
        const fresh=await fetch(url(result.view.revision,report.pendingOnly?0:report.offset,report.pendingOnly));
        const body=await fresh.json() as {inspection?:RecoveryEditInspection};
        if(fresh.ok&&body.inspection)setReport(body.inspection);
      }catch{/* The recorded outcome is still saved; the stale-page notice offers refresh. */}
      requestAnimationFrame(()=>feedback.current?.focus());
    }catch(failure){setError(failure instanceof Error?failure.message:"Could not record the outcome. Your note is retained.");}
    finally{setBusy(false);setReviewing(null);}
  }
  async function recover(input:Record<string,unknown>) {
    setBusy(true);setError("");setMessage("");setReviewing(String(input.id));
    try {
      const response=await fetch(`${endpoint}&replay=1`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(input)});
      const result=await response.json() as {view?:MaintenanceView;message?:string;error?:string};
      if(!response.ok||!result.view)throw new Error(result.error??"Recovery outcome is unconfirmed. Check the pending recovery before reopening.");
      onReviewed(result.view);setExpanded(null);setMessage(result.message??"Recovery outcome recorded.");
    }catch(failure){setError(failure instanceof Error?failure.message:"Recovery outcome is unconfirmed. Your review note is retained.");}
    finally{
      // A failed response may follow a committed edit or reservation. Reload the
      // authoritative maintenance revision so the owner can resume the same work.
      try {
        const state=await fetch(endpoint),view=await state.json() as MaintenanceView;
        if(state.ok){if(view.revision!==revision)onReviewed(view);const fresh=await fetch(url(view.revision,report?.offset??0,report?.pendingOnly));
          const body=await fresh.json() as {inspection?:RecoveryEditInspection};if(fresh.ok&&body.inspection){
            setReport(body.inspection);
            const saved=body.inspection.items.find(item=>item.id===input.id)?.replay;
            if(saved&&saved.state!=="Pending"){setError("");setExpanded(null);setMessage(saved.result??"Recovery outcome recorded.");}
          }}
      }catch{/* Preserve the previous view and the note; refresh is available. */}
      setBusy(false);setReviewing(null);requestAnimationFrame(()=>feedback.current?.focus());
    }
  }
  return <section className="pipeline relationship-panel maintenance-inspection" aria-label="Internal edit recovery">
    <div className="section-heading"><div><h2 id="internal-edits-heading" ref={heading} tabIndex={-1}>Internal edits</h2><p className="muted">Review saved changes before reopening the workspace.</p></div>
      <Button variant="outline" disabled={busy||!paused} onClick={()=>void inspect()}>{busy?(reviewing?"Recording outcome…":"Checking edits…"):report?"Refresh edit history":"Inspect internal edits"}</Button></div>
    <p className="muted">Includes document due dates and closing checklist completions and reopenings that have recovery receipts.</p>
    {error&&<p ref={feedback} tabIndex={-1} role="alert" className="application-message banner-error">{error}{report?" The previous inspection remains below.":""}</p>}
    {message&&<p ref={feedback} tabIndex={-1} role="status" className="application-message">{message}</p>}
    {report&&<>
      {report.pendingReplay&&<div ref={pendingReplay} tabIndex={-1} role="status" className="application-message"><strong>Recovery outcome pending</strong>
        <p>{report.pendingReplay.recordName} · {report.pendingReplay.label}. Check this saved recovery before reviewing or reopening the workspace.</p>
        <Button variant="outline" disabled={busy||!paused} onClick={()=>void recover({id:report.pendingReplay!.editId,resume:true})}>Check pending recovery</Button></div>}
      {report.revision!==revision&&<p role="status" className="application-message">Maintenance changed. Refresh edit history before recording another outcome.</p>}
      {report.pendingOnly&&<div className="loan-application-actions"><strong>Unconfirmed edits</strong>
        <Button variant="outline" disabled={busy||!paused} onClick={()=>void inspect(0,false)}>Show all edits</Button></div>}
      {!report.total?<p>{report.pendingOnly?"No unconfirmed edits remain.":"No covered edits have been recorded yet. This does not prove that no other work occurred."}</p>:<>
        <div className="section-heading"><p>Showing {report.offset+1}–{report.offset+report.items.length} of {report.total}</p>
          <nav className="loan-application-actions" aria-label="Internal edit pages">
            <Button variant="outline" disabled={busy||!paused||!report.offset} onClick={()=>void inspect(Math.max(0,report.offset-25))}>Previous edits</Button>
            <Button variant="outline" disabled={busy||!paused||report.next===null} onClick={()=>void inspect(report.next!)}>Next edits</Button>
          </nav></div>
        <ul className="inspection-items">{report.items.map(item=>{
          const {command,before,current}=item;
          const isClosing=command.type==="completeClosingItem";
          const previous="completedAt" in before?checklistStatus(Boolean(before.completedAt)):date(before.dueOn);
          const saved=isClosing?checklistStatus(command.completed):date(command.dueOn);
          const currentState=current&&("completedAt" in current?`Current status ${checklistStatus(Boolean(current.completedAt))}`:`Current due date ${date(current.dueOn)}`);
          return <li key={item.id}>
          <div className="section-heading"><strong>{item.recordName}</strong><span className="pill">{item.state==="Pending"?"Outcome unconfirmed":item.state==="Rejected"?"Edit rejected":item.state==="Reviewed"?"Outcome reviewed":"Outcome recorded"}</span></div>
          <p>{item.label} · {previous} → {saved}</p>
          <p className="muted">{item.actor} · {new Date(item.at).toLocaleString()}</p>
          <p><strong>{item.finding}</strong>{currentState?` · ${currentState}`:""}</p>
          <details><summary>Revision evidence</summary>
            {"completedAt" in before?<p>Checklist item revision {before.revision} → {before.revision+1}</p>:<>
              <p>Document revision {before.revision}</p>
              <p>Due-date revision {before.deadlineRevision} → {before.deadlineRevision+1}</p>
            </>}
            <p>{item.sourceProof?"A receipt saved with this change is present.":"No matching edit receipt was found in this workspace state."}</p>
            <p>{item.proof?"A matching result was retained in the recovery directory.":"No result has been confirmed outside the tenant."}</p>
            <p>Reference: <code>{item.id}</code></p>
          </details>
          {item.replay&&<p className="muted"><strong>Recovery {item.replay.state.toLowerCase()}</strong> · {item.replay.actor} · {new Date(item.replay.at).toLocaleString()}<br/>{item.replay.note}{item.replay.result&&<><br/>{item.replay.result}</>}</p>}
          {item.canReplay&&!report.pendingReplay&&<details open={expanded===`replay:${item.id}`} onToggle={event=>{if(event.currentTarget.open)setExpanded(`replay:${item.id}`);else setExpanded(current=>current===`replay:${item.id}`?null:current);}}>
            <summary>{isClosing?"Recover saved checklist change":"Recover saved due-date change"}</summary><form className="maintenance-form" onSubmit={event=>{event.preventDefault();void recover({revision,offset:report.offset,id:item.id,fingerprint:item.fingerprint,note:new FormData(event.currentTarget).get("note")});}}>
              <p>Restore {item.label} from {previous} to {saved}. Orbit checks the original revision and confirmed receipt before saving the change in the loan history.</p>
              <label className="field">Recovery reason<textarea name="note" required minLength={20} maxLength={1000} rows={3} disabled={busy||report.revision!==revision}/></label>
              <Button type="submit" disabled={busy||!paused||report.revision!==revision}>{isClosing?"Recover checklist status":"Recover this due date"}</Button>
            </form></details>}
          {item.review&&<p className="muted">Reviewed by {item.review.actor} · {new Date(item.review.at).toLocaleString()}<br/>{item.review.note}</p>}
          {item.canConfirm?<details open={expanded===item.id} onToggle={event=>{if(event.currentTarget.open)setExpanded(item.id);else setExpanded(current=>current===item.id?null:current);}}><summary>Review saved outcome</summary><form className="maintenance-form" onSubmit={event=>void confirm(event,item)}>
            <p>The saved receipt matches this intended edit. Record that evidence without applying the change again.</p>
            <label className="field">Review note<textarea name="note" required minLength={20} maxLength={1000} rows={3} disabled={busy||report.revision!==revision}/></label>
            <Button type="submit" disabled={busy||!paused||report.revision!==revision}>{reviewing===item.id?"Recording…":"Record verified outcome"}</Button>
          </form></details>:item.state==="Pending"&&<p className="muted">Keep this outcome unresolved until matching saved proof is available. Confirm that the workspace has the original saved receipt.</p>}
        </li>;})}</ul>
      </>}
    </>}
  </section>;
}
