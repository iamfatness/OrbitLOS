"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, CheckCircle2, PauseCircle, ShieldCheck } from "lucide-react";
import { Button } from "./ui/button";
import { RecoveryCheckpoints } from "./recovery-checkpoints";
import { RecoveryEdits } from "./recovery-edits";
import { MaintenanceInspectionPanel } from "./maintenance-inspection";
import type { WorkspaceStaff } from "@/lib/staff-store";
import { brokerageUrl } from "@/lib/brokerage-model";
import { maintenanceChecks, type MaintenanceView } from "@/lib/workspace-maintenance-model";

export function WorkspaceMaintenance({staff}:{staff:WorkspaceStaff|null}) {
  const [view,setView]=useState<MaintenanceView|null>(null);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState(false);
  const [reviewDraft,setReviewDraft]=useState<{review:string;checks:boolean[]}|null>(null);
  const reviewDirty=reviewDraft!==null;
  const reviewBlocked=Boolean(view?.pendingRestore||view?.pendingEditRecovery);
  const reviewValues=reviewDraft??{review:view?.review??"",checks:view?.checks??[false,false,false]};
  function editReview(change:Partial<{review:string;checks:boolean[]}>) {setReviewDraft({...reviewValues,...change});setMessage("");}
  const feedback=useRef<HTMLParagraphElement>(null);
  const endpoint=`/api/workspace-maintenance?brokerage=${encodeURIComponent(staff?.brokerage.id??"")}`;
  const allowed=staff?.brokerage.role==="Admin" && staff.brokerage.pilot;
  function openRecovery(id:string) {
    const heading=document.getElementById(id);
    const disclosure=heading?.closest("details");
    if(disclosure)disclosure.open=true;
    heading?.focus();
  }
  function applyRecoveryView(next:MaintenanceView) {
    if(view && next.revision<view.revision)return;
    setView(next);
    if(next.revision!==view?.revision) {
      setReviewDraft({review:reviewValues.review,checks:[false,false,false]});
      setMessage("");
    }
  }
  useEffect(()=>{
    if(!allowed)return;
    const controller=new AbortController();
    fetch(endpoint,{signal:controller.signal}).then(async response=>{
      const result=await response.json() as MaintenanceView & {error?:string};
      if(!response.ok)throw new Error(result.error??"Maintenance status is unavailable.");
      setView(result);
    }).catch(failure=>{if(!controller.signal.aborted)setError(failure instanceof Error?failure.message:"Maintenance status is unavailable.");});
    return ()=>controller.abort();
  },[allowed,endpoint]);
  useEffect(()=>{if(message)feedback.current?.focus();},[message]);
  async function change(input?:Record<string,unknown>) {
    setBusy(true);setError("");setMessage("");
    try {
      const response=await fetch(endpoint,input?{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(input)}:undefined);
      const result=await response.json() as MaintenanceView & {error?:string};
      if(!response.ok)throw new Error(result.error??"Orbit could not update maintenance. Refresh its status before retrying.");
      setView(result);
      if(input?.type==="review" || input?.type==="pause" || view?.startedAt!==result.startedAt)setReviewDraft(null);
      setMessage(input?.type==="pause"?"Maintenance started. Check the workspace status below.":input?.type==="review"?"Reopening review recorded.":
        input?.type==="reopen"?"Workspace reopened. Staff and portals can continue.":"Maintenance status refreshed.");
    } catch(failure){setError(failure instanceof Error?failure.message:"Maintenance is unavailable. Refresh its status.");}
    finally{setBusy(false);}
  }
  function submit(event:FormEvent<HTMLFormElement>,type:"pause"|"review"|"reopen") {
    event.preventDefault();if(!view)return;
    const values=new FormData(event.currentTarget);
    void change({type,revision:view.revision,...(type==="pause"?{reason:values.get("reason"),confirmation:values.get("confirmation")}:
      type==="review"?{review:values.get("review"),checks:maintenanceChecks.map((_,index)=>values.has(`check-${index}`))}:
      {confirmation:values.get("confirmation")})});
  }
  return <main className="maintenance-page">
    <header className="maintenance-heading"><a className="maintenance-back" href={staff?brokerageUrl(staff.brokerage.id):"/workspace"}><ArrowLeft size={16} aria-hidden/> Back to workspace</a>
      <p className="eyebrow">OrbitLOS · {staff?.brokerage.name??"Brokerage workspace"}</p><h1>Workspace maintenance</h1>
      <p className="muted">Pause activity, review the outcome, and reopen with a clear record.</p></header>
    {!allowed?<section className="pipeline relationship-panel"><h2>Admin access required</h2><p>Maintenance is available to admins in a fictional pilot workspace.</p></section>:<>
      <div className="maintenance-feedback" aria-live="polite">{error&&<p role="alert" className="application-message banner-error">{error} Your form entries are retained.</p>}
        {message&&<p ref={feedback} role="status" tabIndex={-1} className="application-message">{message}</p>}</div>
      {!view?<section className="pipeline relationship-panel"><p role="status">{error?"Refresh to load the current status.":"Loading maintenance status…"}</p>
        {error&&<Button disabled={busy} variant="outline" onClick={()=>void change()}>Refresh status</Button>}</section>:<>
        <section className="pipeline relationship-panel maintenance-status" aria-label="Maintenance status">
          <div><span className="pill">{view.mode==="Open"?"Workspace open":view.mode==="Pausing"?"Finishing active work":"Workspace paused"}</span>
            <h2>{view.mode==="Open"?"Ready for daily work":view.mode==="Pausing"?"New activity is blocked":"Review before reopening"}</h2>
            <p className="muted">{view.mode==="Open"?"Staff and portal activity are available.":view.mode==="Pausing"?
              `${view.active} active workspace ${view.active===1?"request remains":"requests remain"}. Refresh after they finish.`:
              "Staff actions, borrower and partner portal updates, and background workspace work are paused."}</p></div>
          <div className="loan-application-actions">
            {view.pendingRestore&&<Button onClick={()=>openRecovery("restore-workspace-heading")}>Open pending restore</Button>}
            {!view.pendingRestore&&view.pendingEditRecovery&&<Button onClick={()=>openRecovery("internal-edits-heading")}>Open internal edit recovery</Button>}
            <Button variant="outline" disabled={busy} onClick={()=>void change()}>Refresh status</Button>
          </div>
        </section>
        {reviewBlocked&&<p className="application-message" role="status">
          {view.pendingRestore?"Verify the pending restore before recording a reopening review.":"Resolve the pending internal edit recovery before recording a reopening review."}
        </p>}
        <ol className="maintenance-steps" aria-label="Maintenance steps">{[[PauseCircle,"Pause activity"],[ShieldCheck,"Review outcome"],[CheckCircle2,"Reopen workspace"]].map(([Icon,label],index)=>{
          const Symbol=Icon as typeof PauseCircle;
          const step=view.mode==="Open"?0:view.reviewedAt?2:1;
          return <li key={String(label)} aria-current={index===step?"step":undefined}><Symbol size={20} aria-hidden/><span>{String(label)}</span></li>;
        })}</ol>
        {view.mode==="Open"?<section className="pipeline relationship-panel"><h2>Start maintenance</h2>
          <p className="muted">New activity will stop across this workspace and its portals. Active requests finish first. This pauses access; it does not restore data.</p>
          <form className="maintenance-form" onSubmit={event=>submit(event,"pause")}>
            <label className="field">Reason<textarea name="reason" required minLength={8} maxLength={500} rows={3} placeholder="What will your team investigate or recover?"/></label>
            <label className="field">Enter {staff?.brokerage.name} to confirm<input name="confirmation" required autoComplete="off"/></label>
            <Button disabled={busy} type="submit">Pause workspace</Button>
          </form></section>:<>
          <MaintenanceInspectionPanel key={view.startedAt} endpoint={endpoint} revision={view.revision} paused={view.mode==="Paused"}
            onDecisionSaved={applyRecoveryView}/>
          <RecoveryCheckpoints brokerageName={staff?.brokerage.name??""} key={`checkpoints:${view.startedAt}`} endpoint={endpoint} revision={view.revision} paused={view.mode==="Paused"}
            onSaved={applyRecoveryView}/>
          <RecoveryEdits key={`edits:${view.startedAt}`} endpoint={endpoint} revision={view.revision} paused={view.mode==="Paused"}
            onReviewed={applyRecoveryView}/>
          <div className="maintenance-columns">
          <section className="pipeline relationship-panel"><h2>Reopening review</h2><p className="muted">Confirm the outcome of your investigation or recovery. Check each item only after reviewing its evidence.</p>
            <form key={view.startedAt} className="maintenance-form" onSubmit={event=>submit(event,"review")}>
              <fieldset disabled={busy||reviewBlocked||view.mode!=="Paused"}><legend className="sr-only">Required reopening checks</legend>
              {maintenanceChecks.map((check,index)=><label key={check} className="demo-confirm"><input name={`check-${index}`} type="checkbox" required checked={reviewValues.checks[index]} onChange={event=>editReview({checks:reviewValues.checks.map((checked,item)=>item===index?event.target.checked:checked)})}/>{check}</label>)}</fieldset>
              <label className="field">Review notes<textarea name="review" required minLength={8} maxLength={1000} rows={4} value={reviewValues.review} onChange={event=>editReview({review:event.target.value})} placeholder="Record the checks performed, unresolved items, and the decision." disabled={busy||reviewBlocked||view.mode!=="Paused"}/></label>
              <Button disabled={busy||reviewBlocked||view.mode!=="Paused"} type="submit">Record review</Button>
            </form>
            {reviewDirty&&<p className="muted" role="status">Record your updated review before reopening.</p>}
            {view.reviewedAt&&<p className="muted">Recorded by {view.reviewedBy} · {new Date(view.reviewedAt).toLocaleString()}</p>}
          </section>
          <section className="pipeline relationship-panel"><h2>Reopen workspace</h2><p className="muted">Staff and portal activity resume after the review is recorded and you confirm this workspace.</p>
            <form className="maintenance-form" onSubmit={event=>submit(event,"reopen")}>
              <label className="field">Enter {staff?.brokerage.name} to confirm<input name="confirmation" required autoComplete="off" disabled={busy||reviewBlocked||!view.reviewedAt||reviewDirty}/></label>
              <Button disabled={busy||reviewBlocked||view.mode!=="Paused"||!view.reviewedAt||reviewDirty} type="submit">Reopen workspace</Button>
            </form>
            <p className="muted">Started by {view.startedBy} · {view.startedAt&&new Date(view.startedAt).toLocaleString()}</p><p>{view.reason}</p>
          </section>
        </div></>}
        <details className="pipeline relationship-panel maintenance-history"><summary>Maintenance history <span className="pill">{view.history.length}</span></summary>
          {view.history.length?<ol>{view.history.map((event,index)=><li key={`${event.at}-${index}`}><strong>{event.action}</strong><p className="muted">{event.actor} · {new Date(event.at).toLocaleString()}</p><p>{event.note}</p></li>)}</ol>:
            <p className="muted">No maintenance has been recorded for this workspace.</p>}</details>
      </>}
    </>}
  </main>;
}
