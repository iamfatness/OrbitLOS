"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "./ui/button";
import { inspectionPageSize, type MaintenanceInspection } from "@/lib/maintenance-inspection-model";

function when(value:string) {
  const date=new Date(/^\d+$/.test(value)?Number(value):value);
  return Number.isNaN(date.getTime())?"Time unavailable":date.toLocaleString();
}
export function MaintenanceInspectionPanel({endpoint,revision,paused}:{endpoint:string;revision:number;paused:boolean}) {
  const [report,setReport]=useState<MaintenanceInspection|null>(null),[error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const pending=useRef<AbortController|null>(null),heading=useRef<HTMLHeadingElement>(null);
  useEffect(()=>()=>pending.current?.abort(),[]);
  async function inspect(documents=0,requests=0) {
    pending.current?.abort();const controller=new AbortController();pending.current=controller;
    setBusy(true);setError("");
    try {
      const response=await fetch(`${endpoint}&inspect=1&revision=${revision}&documents=${documents}&requests=${requests}`,{signal:controller.signal});
      const result=await response.json() as {error?:string;inspection?:MaintenanceInspection};
      if(!response.ok || !result.inspection)throw new Error(result.error??"Inspection is unavailable. Refresh the maintenance status and try again.");
      if(controller.signal.aborted)return;
      setReport(result.inspection);heading.current?.focus();
    }catch(failure){if(!controller.signal.aborted)setError(failure instanceof Error?failure.message:"Inspection is unavailable.");}
    finally{if(!controller.signal.aborted)setBusy(false);}
  }
  const doc=report?.documents,work=report?.requests;
  return <section className="pipeline relationship-panel maintenance-inspection" aria-label="Recovery inspection">
    <div className="section-heading"><div><h2 ref={heading} tabIndex={-1}>Recovery inspection</h2>
      <p className="muted">Inspect saved records before recording your reopening review.</p></div>
      <Button variant="outline" disabled={!paused||busy} onClick={()=>void inspect()}>{busy?"Inspecting…":report?"Refresh inspection":"Inspect saved work"}</Button></div>
    {!paused&&<p className="muted">Available after active workspace requests finish.</p>}
    {error&&<p className="application-message banner-error" role="alert">{error}{report?" The previous inspection remains below; it is not a new result.":""}</p>}
    {busy&&<p role="status" className="muted">Reading saved records and checking document storage…</p>}
    {report&&<>
      <p className="muted">Inspected {when(report.inspectedAt)} · Maintenance revision {report.revision}</p>
      {report.unavailable.length>0&&<div className="application-message banner-error" role="status"><strong>Some evidence is unavailable.</strong>
        <p>{report.unavailable.join(", ")}. Totals below cover readable records only; unavailable data is not zero.</p></div>}
      <dl className="inspection-counts">{report.records.map(item=><div key={item.label}><dt>{item.label}</dt><dd>{item.count===null?"Unavailable":item.count.toLocaleString()}</dd></div>)}</dl>
      <details className="inspection-details" open><summary>Requests to review <span className="pill">{work!.total}</span></summary>
        <p className="muted">Unresolved or acknowledged UWM records, plus pending uploads. One lender action can have both a request and an operation. Nothing is retried here.</p>
        {!work!.total?<p>No pending items in the inspected stores. This does not establish an external provider’s outcome.</p>:<>
          <p className="muted">Showing {work!.offset+1}–{work!.offset+work!.items.length} of {work!.total}</p>
          <ul className="inspection-items">{work!.items.map(item=><li key={item.reference}><div className="section-heading"><strong>{item.recordName}</strong><span className="pill">{item.state}</span></div>
            <p>{item.source} · {item.action.replaceAll("-"," ")}</p><p className="muted">{item.environment} · {when(item.at)}</p>
            <details><summary>Record references</summary><p>Record: <code>{item.recordId}</code></p><p>Request: <code>{item.reference}</code></p></details>
            <p>{item.state==="Prepared"?"Prepared locally; confirm whether it should proceed after reopening.":item.state==="Acknowledged"?"A response was recorded. Confirm the lender’s final outcome before treating the work as complete.":"Compare the saved request with its source before deciding whether any retry is safe."}</p>
          </li>)}</ul>
          <nav className="loan-application-actions" aria-label="Request inspection pages">
            <Button variant="outline" disabled={busy||!work!.offset} onClick={()=>void inspect(doc!.offset,Math.max(0,work!.offset-inspectionPageSize))}>Previous requests</Button>
            <Button variant="outline" disabled={busy||work!.next===null} onClick={()=>void inspect(doc!.offset,work!.next!)}>Next requests</Button>
          </nav></>}
      </details>
      <details className="inspection-details"><summary>Document availability <span className="pill">{doc!.total} references</span>
        {doc!.items.some(item=>item.availability!=="Available")&&<span className="inspection-attention"> · {doc!.items.filter(item=>item.availability!=="Available").length} need review on this page</span>}</summary>
        <p className="muted">Checks current, accepted, linked-evidence, lead and lender-package file references. The same PDF can appear more than once. “Available” confirms a stored object exists; its contents and recovery hash are not verified.</p>
        {!doc!.total?<p>No saved file references in the inspected stores.</p>:<>
          <p className="muted">Checked references {doc!.offset+1}–{doc!.offset+doc!.items.length} of {doc!.total}.{doc!.total>doc!.items.length?" Other pages have not been checked in this result.":""}</p>
          <ul className="inspection-items">{doc!.items.map(item=><li key={item.reference}><div className="section-heading"><strong>{item.recordName}</strong><span className="pill">{item.availability}</span></div>
            <p>{item.label}</p><p className="muted">{item.revision===null?"Revision unavailable":`Revision ${item.revision}`}{item.bytes===null?"":` · ${item.bytes.toLocaleString()} bytes`}</p>
            <details><summary>Record references</summary><p>Record: <code>{item.recordId}</code></p><p>Document: <code>{item.reference}</code></p></details>
          </li>)}</ul>
          <nav className="loan-application-actions" aria-label="Document inspection pages">
            <Button variant="outline" disabled={busy||!doc!.offset} onClick={()=>void inspect(Math.max(0,doc!.offset-inspectionPageSize),work!.offset)}>Previous documents</Button>
            <Button variant="outline" disabled={busy||doc!.next===null} onClick={()=>void inspect(doc!.next!,work!.offset)}>Next documents</Button>
          </nav></>}
      </details>
      <p className="muted">This inspection does not restore records, reconcile lender outcomes, or verify staff and portal permissions. Record those checks in your reopening review.</p>
    </>}
  </section>;
}
