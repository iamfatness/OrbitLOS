"use client";

import { useEffect, useRef, useState } from "react";
import { accessLoanRetention } from "@/app/actions";
import type { RetentionAudit as Audit } from "@/lib/retention-audit";
import { dateTime } from "@/lib/utils";
import { downloadSampleFile } from "./sample-download";
import { Button } from "./ui/button";

type Selection = {section:Audit["section"]; policyVersion:number|null; before:number|null};
const initial:Selection = {section:"policies",policyVersion:null,before:null};

export function RetentionAudit({ brokerageId, onBack, openLoan }:{
  brokerageId:string; onBack:()=>void; openLoan:(id:string)=>void;
}) {
  const [selection,setSelection] = useState(initial);
  const [audit,setAudit] = useState<{selection:Selection;data:Audit}>();
  const [version,setVersion] = useState("");
  const [prior,setPrior] = useState<(number|null)[]>([]);
  const [error,setError] = useState("");
  const [status,setStatus] = useState("");
  const [exporting,setExporting] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const moveFocus = useRef(false);
  const data = audit?.selection===selection ? audit.data : undefined;
  const busy = !data && !error;

  useEffect(()=>{heading.current?.focus();},[]);
  useEffect(()=>{
    let active=true;
    void accessLoanRetention({type:"retentionAudit",...selection},brokerageId).then(result=>{
      if (!active) return;
      if ("error" in result) setError(result.error);
      else if (result.kind==="retentionAudit") setAudit({selection,data:result});
    }).catch(()=>{if(active)setError("Could not load audit history. Try again.");});
    return ()=>{active=false;};
  },[brokerageId,selection]);
  useEffect(()=>{
    if (data && moveFocus.current) {
      resultHeading.current?.focus();
      moveFocus.current=false;
    }
  },[data]);

  function load(next:Selection, focus=false) {
    setError("");
    setStatus("");
    moveFocus.current=focus;
    setSelection(next);
  }

  function choose(section:Audit["section"],policyVersion:number|null) {
    setPrior([]);
    setVersion(String(policyVersion??""));
    load({section,policyVersion,before:null},true);
  }

  async function exportAudit() {
    if (exporting) return;
    setExporting(true);
    setStatus("Preparing audit JSON…");
    setError("");
    try {
      const result = await accessLoanRetention({type:"exportRetentionAudit",policyVersion:selection.policyVersion},brokerageId);
      if ("error" in result) {setError(result.error);setStatus("");}
      else if (result.kind==="retentionAuditExport") {
        downloadSampleFile(result.json,"orbit-retention-audit.json","application/json");
        setStatus("Audit JSON sent to your downloads.");
      }
    } catch {setError("Could not export audit history. Try again.");setStatus("");}
    finally {setExporting(false);}
  }

  return <div className="integration manager-panel record-form loan-retention">
    <div className="section-heading">
      <h2 ref={heading} tabIndex={-1}>Retention audit</h2>
      <Button type="button" variant="outline" disabled={exporting} onClick={onBack}>Back to disposition review</Button>
    </div>
    <div className="loan-application-actions retention-audit-views" role="group" aria-label="Audit records">
      <Button type="button" variant="outline" aria-pressed={selection.section==="policies"} disabled={exporting}
        onClick={()=>choose("policies",selection.policyVersion)}>Policy versions</Button>
      <Button type="button" variant="outline" aria-pressed={selection.section==="decisions"} disabled={exporting}
        onClick={()=>choose("decisions",selection.policyVersion)}>Disposition decisions</Button>
    </div>
    <form className="loan-application-actions retention-search" onSubmit={event=>{
      event.preventDefault();
      choose(selection.section,version?Number(version):null);
    }}>
      <label className="field">Policy version
        <input type="number" min="1" step="1" placeholder="All versions" value={version} disabled={exporting}
          onChange={event=>setVersion(event.target.value)}/>
      </label>
      <Button type="submit" variant="outline" disabled={exporting}>Apply filter</Button>
      {selection.policyVersion!==null && <Button type="button" variant="outline" disabled={exporting}
        onClick={()=>choose(selection.section,null)}>Clear filter</Button>}
    </form>
    <div className="loan-application-actions">
      <Button type="button" disabled={!data} aria-disabled={exporting}
        onClick={()=>void exportAudit()}>Download audit JSON</Button>
      <span className="muted">{selection.policyVersion===null?"All policy versions and decisions":`Policy version ${selection.policyVersion} and its decisions`}</span>
    </div>
    {status && <p role="status">{status}</p>}
    {error && <div className="record-form"><p role="alert">{error}</p>
      {!data && <div><Button type="button" variant="outline" onClick={()=>load({...selection})}>Retry audit</Button></div>}
    </div>}
    {busy && <p role="status">Loading audit history…</p>}
    {data && <section className="record-form" aria-label="Retention audit results">
      <h3 ref={resultHeading} tabIndex={-1}>{data.section==="policies"?"Policy history":"Decision history"}</h3>
      {!data.policies.length && !data.decisions.length && <p>No records match this view.</p>}
      <ul className="loan-task-list">
        {data.policies.map(policy=><li className="loan-task document-item record-form" key={policy.version}>
          <div className="section-heading"><strong>Version {policy.version}</strong>{policy.version===data.latestVersion && <span>Current policy</span>}</div>
          <p>Funded · {policy.fundedDays===null?"Review off":`${policy.fundedDays} calendar days`}<br/>
            Withdrawn or lost · {policy.closedDays===null?"Review off":`${policy.closedDays} calendar days`}</p>
          <p>{policy.reference}</p>
          <p className="muted">{dateTime(policy.at)} ET · {policy.actor}</p>
          <div><Button type="button" variant="outline" disabled={exporting} onClick={()=>choose("decisions",policy.version)}>View decisions</Button></div>
        </li>)}
        {data.decisions.map(decision=><li className="loan-task document-item record-form" key={decision.id}>
          <div className="section-heading"><strong>{decision.currentBorrower??"Loan removed"}</strong><span>{decision.outcome}</span></div>
          <p>{decision.reference}</p>
          <p className="muted">Policy version {decision.policyVersion} · {dateTime(decision.at)} ET · {decision.actor}</p>
          {decision.eventDate && <p className="muted">{decision.category} <time className="whitespace-nowrap" dateTime={decision.eventDate}>{decision.eventDate}</time>
            {decision.reviewOn && <>{" · "}<span className="whitespace-nowrap">Review due <time dateTime={decision.reviewOn}>{decision.reviewOn}</time></span></>}</p>}
          {!decision.currentBorrower && <p className="muted">Loan reference {decision.loanId}</p>}
          <div className="loan-application-actions">
            <Button type="button" variant="outline" disabled={exporting} onClick={()=>choose("policies",decision.policyVersion)}>View policy</Button>
            {decision.currentBorrower && <Button type="button" variant="outline" disabled={exporting}
              onClick={()=>openLoan(decision.loanId)}>Open loan</Button>}
          </div>
        </li>)}
      </ul>
      {(prior.length>0||data.next!==null)&&<div className="loan-application-actions">
        <Button type="button" variant="outline" disabled={exporting||!prior.length} onClick={()=>{
          load({...selection,before:prior.at(-1)??null},true);
          setPrior(prior.slice(0,-1));
        }}>Newer records</Button>
        <Button type="button" variant="outline" disabled={exporting||data.next===null} onClick={()=>{
          setPrior([...prior,selection.before]);
          load({...selection,before:data.next},true);
        }}>Older records</Button>
      </div>}
    </section>}
  </div>;
}
