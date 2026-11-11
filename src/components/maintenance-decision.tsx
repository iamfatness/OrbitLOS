"use client";

import { useRef, useState, type FormEvent } from "react";
import { Button } from "./ui/button";
import { decisionOutcomes, type InspectionEvidence, type MaintenanceDecisionInput } from "@/lib/maintenance-inspection-model";

type DecisionFields=Pick<MaintenanceDecisionInput,"id"|"reference"|"fingerprint"|"outcome"|"note">;
export function MaintenanceDecisionForm({item,revision,disabled,onSave}:{revision:number;item:InspectionEvidence & {reference:string};disabled:boolean;onSave:(input:DecisionFields)=>Promise<boolean>}) {
  const [outcome,setOutcome]=useState<typeof decisionOutcomes[number]>("Needs investigation"),[note,setNote]=useState("");
  const [saved,setSaved]=useState(false),[open,setOpen]=useState(false);
  const attempt=useRef<{key:string;id:string}|null>(null),feedback=useRef<HTMLParagraphElement>(null);
  const latest=item.decisions[0],stale=latest&&latest.fingerprint!==item.fingerprint;
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const key=JSON.stringify([revision,item.reference,item.fingerprint,outcome,note]);
    if(attempt.current?.key!==key)attempt.current={key,id:crypto.randomUUID()};
    const ok=await onSave({id:attempt.current.id,reference:item.reference,fingerprint:item.fingerprint,outcome,note});
    setSaved(ok);if(ok){setOpen(false);requestAnimationFrame(()=>feedback.current?.focus());}
  }
  return <div className="inspection-decision">
    {latest&&<div><p><strong>{latest.outcome}</strong>{stale?" · Evidence changed since this decision":" · Inspected evidence unchanged"}</p>
      <p className="muted">{latest.actor} · {new Date(latest.at).toLocaleString()}</p><p>{latest.note}</p></div>}
    <details open={open} onToggle={event=>setOpen(event.currentTarget.open)}><summary>{latest?"Update decision":"Record a decision"}</summary>
      <form className="maintenance-form" onSubmit={event=>void submit(event)}>
        <label className="field">Decision<select value={outcome} onChange={event=>{setOutcome(event.target.value as typeof outcome);setSaved(false);}} disabled={disabled}>
          {decisionOutcomes.map(value=><option key={value}>{value}</option>)}</select></label>
        <label className="field">Evidence and next action<textarea required minLength={20} maxLength={1000} rows={3} value={note} disabled={disabled}
          placeholder="What did you verify, where is the supporting evidence, and what needs to happen next?"
          onChange={event=>{setNote(event.target.value);setSaved(false);}}/></label>
        <p className="muted">Record a reference or summary. Keep borrower financial details and credentials out of these notes.</p>
        <Button type="submit" disabled={disabled||saved}>Save decision</Button>
      </form>
    </details>
    {saved&&<p ref={feedback} tabIndex={-1} role="status" className="application-message">Decision recorded. Complete a new reopening review.</p>}
    {item.decisions.length>1&&<details><summary>Previous decisions</summary><ol>{item.decisions.slice(1).map(decision=><li key={decision.id}>
      <strong>{decision.outcome}</strong><p className="muted">{decision.actor} · {new Date(decision.at).toLocaleString()}</p><p>{decision.note}</p>
    </li>)}</ol><p className="muted">Latest five decisions for this item in the current maintenance session.</p></details>}
  </div>;
}
