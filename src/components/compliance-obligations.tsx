"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { z } from "zod";
import { dateLabel } from "@/lib/client-retention";
import { accessComplianceCases } from "@/app/actions";
import { obligationDraft, reportingDateBasis, obligationStateSource, type ObligationDraft, type ObligationStateSource } from "@/lib/compliance-obligations-model";
import type { ProgramReviewTarget } from "@/lib/compliance-program-model";
import { Button } from "./ui/button";
import { IllinoisAuditEvidence } from "./illinois-audit-evidence";

const row = z.object({ id:z.string(),revision:z.number(),draft:obligationDraft,ownerAvailable:z.boolean(),
  stateBasis:obligationStateSource.optional(),stateBasisChanged:z.boolean().optional() });
const registry = z.object({kind:z.literal("obligationRegistry"),items:z.array(row),more:z.boolean()});
const stateSources = z.object({kind:z.literal("obligationStateSources"),items:z.array(obligationStateSource)});
const plannedReview = z.object({ entityId: z.uuid(), month: z.string(), itemId: z.uuid() });
const periods = z.object({ kind: z.literal("obligationOccurrences"), more: z.boolean(), items: z.array(z.object({
  reportingBasis: reportingDateBasis.optional(), period: z.string(), version: z.number(), status: z.string(), internalTarget: z.string(), createdBy: z.string(), createdAt: z.string(), ownerEmail: z.string(), from: z.string(), through: z.string(),
  illinoisAudit: z.boolean().optional(), audit: z.object({ dueOn: z.iso.date(), extensionStatus: z.string(), filingStatus: z.string() }).optional(), filingStatus: z.string().optional(), stateBasis: obligationStateSource.optional(), stateBasisChanged: z.boolean().optional(), review: plannedReview.optional(),
})) });
type Row=z.infer<typeof row>;
const text=(form:FormData,name:string)=>String(form.get(name)??"");
const months = Array.from({length:12}, (_, index) => new Intl.DateTimeFormat("en-US",{month:"long",timeZone:"UTC"})
  .format(new Date(Date.UTC(2026,index,1))));
function periodInstructions(draft: ObligationDraft) {
  const start = (draft.annualStartMonth ?? 1) - 1;
  if (draft.cadence === "Annual") return `Choose ${months[start]} as the first month.`;
  if (draft.cadence === "Fiscal quarterly") {
    const starts = [0, 3, 6, 9].map(offset => months[(start + offset) % 12]);
    return `Choose ${starts.slice(0, 3).join(", ")} or ${starts[3]} as the first month.`;
  }
  if (draft.cadence === "Quarterly") return "Choose January, April, July or October as the first month.";
  return "Choose the month to review.";
}

export function ComplianceObligations({brokerageId,paused,openReview,returnToItem}:{
   brokerageId:string;paused:boolean;openReview:(target:ProgramReviewTarget)=>void;returnToItem?:string;
 }) {
 const [entities,setEntities]=useState<{id:string;name:string}[]>([]);
 const [entityId,setEntity]=useState("");
 const [items,setItems]=useState<Row[]>([]);
 const [more,setMore]=useState(false),[offset,setOffset]=useState(0),[revision,refresh]=useState(0);
 const [selected,setSelected]=useState<Row|null>(),[history,setHistory]=useState<z.infer<typeof periods>>();
 const [planned,setPlanned]=useState<ProgramReviewTarget>();
 const [historyOffset,setHistoryOffset]=useState(0);
 const [auditPeriod,setAuditPeriod]=useState<string>();
 const auditReturn=useRef<HTMLButtonElement>(null);
 const [filter,setFilter]=useState("");
 const [sources,setSources]=useState<ObligationStateSource[]>();
 const [sourceError,setSourceError]=useState("");
 const [sourceRefresh,refreshSources]=useState(0);
 const [sourceKey,chooseSource]=useState("");
 const [sourceNeedsReselection,setSourceNeedsReselection]=useState(false);
 const [cadence,setCadence]=useState<ObligationDraft["cadence"]>("Monthly");
 const [manualAuthority,setManualAuthority]=useState({sourceUrl:"",authority:""});
 const [loadingEntities,setLoadingEntities]=useState(true);
 const [loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const feedback=useRef<HTMLDivElement>(null), heading=useRef<HTMLHeadingElement>(null);
 const sourceSelect=useRef<HTMLSelectElement>(null), sourceReload=useRef<HTMLButtonElement>(null);
 const recoveringSource=useRef(false);
 const alive=useRef(false),retry=useRef<{body:string;id:string}|undefined>(undefined),newId=useRef("");
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{heading.current?.focus();},[selected]);
 useEffect(()=>{if(error||notice)feedback.current?.focus();},[error,notice]);
 useEffect(()=>{
   if(!recoveringSource.current || (!sources && !sourceError))return;
   recoveringSource.current=false;
   if(sources?.length)sourceSelect.current?.focus();
   else sourceReload.current?.focus();
 },[sources,sourceError]);
 useEffect(()=>{
   if (returnToItem) document.getElementById(`obligation-review-${returnToItem}`)?.focus();
 },[returnToItem,history]);
 const editing=selected!==undefined;
 useEffect(()=>{
   if(!editing||paused)return;
   let current=true;
   void accessComplianceCases({type:"obligations",input:{operation:"stateSources",entityId}},brokerageId).then(r=>{
     if(!current)return;
     const parsed=stateSources.safeParse("kind" in r&&r.kind==="obligations"?r.result:null);
     if(!parsed.success)throw new Error("Could not load state sources.");
     setSources(parsed.data.items);
   }).catch(()=>{if(current)setSourceError("Could not load state obligation sources.");});
   return()=>{current=false;};
 },[brokerageId,editing,entityId,paused,sourceRefresh]);
 useEffect(()=>{
   if(paused)return;
   let current=true;
   void accessComplianceCases({type:"program",input:{operation:"entities"}},brokerageId).then(r=>{
     if(!current)return;
     if("error" in r)setError(r.error);else if(r.kind==="programEntities")setEntities(r.entities);
   }).catch(()=>{if(current)setError("Could not load entities. Refresh to retry.");}).finally(()=>{if(current)setLoadingEntities(false);});
   return()=>{current=false;};
 },[brokerageId,paused,revision]);
 useEffect(()=>{
   if(!entityId||paused)return;
   let current=true;
   void accessComplianceCases({type:"obligations",input:{operation:"list",entityId,offset}},brokerageId).then(r=>{
     if(!current)return;
     if("error" in r)throw new Error(r.error);
     if(r.kind!=="obligations")throw new Error("Unexpected response. Refresh to retry.");
     const parsed=registry.safeParse(r.result);
     if(!parsed.success)throw new Error("Could not read obligations. Refresh to retry.");
     setItems(parsed.data.items);setMore(parsed.data.more);
   }).catch(e=>{if(current)setError(e instanceof Error?e.message:"Could not load obligations.");}).finally(()=>{if(current)setLoading(false);});
   return()=>{current=false;};
 },[brokerageId,entityId,offset,paused,revision]);
 useEffect(()=>{
   if(!selected||paused)return;
   let current=true;
   void accessComplianceCases({type:"obligations",input:{operation:"occurrences",entityId,id:selected.id,offset:historyOffset}},brokerageId).then(r=>{
     if(!current)return;
     const parsed=periods.safeParse("kind" in r&&r.kind==="obligations"?r.result:null);
     if(parsed.success)setHistory(parsed.data);else setError("Could not load period history. Return and reopen the obligation to retry.");
   }).catch(()=>{if(current)setError("Could not load period history. Return and reopen to retry.");});
   return()=>{current=false;};
 },[brokerageId,entityId,selected,paused,historyOffset,revision,returnToItem]);
 function back(){setSelected(undefined);setHistory(undefined);setPlanned(undefined);setError("");setHistoryOffset(0);setLoading(Boolean(entityId));refresh(v=>v+1);}
 function edit(record:Row|null){
   setSources(undefined);
   setSourceError("");
   chooseSource("");
   setSourceNeedsReselection(false);
   setPlanned(undefined);
   setCadence(record?.draft.cadence??"Monthly");
   setManualAuthority({sourceUrl:record?.draft.sourceUrl??"",authority:record?.draft.authority??""});
   setSelected(record);
   setNotice("");
   setHistory(undefined);
 }
 function reloadStateSources(){
   recoveringSource.current=true;
   setSources(undefined);
   setSourceError("");
   setError("");
   chooseSource("");
   refreshSources(v=>v+1);
 }
 async function mutate(input:object,close:boolean){
   if(busy||paused)return;
   const body=JSON.stringify([brokerageId,input]);
   if(retry.current?.body!==body)retry.current={body,id:crypto.randomUUID()};
   setBusy(true);setError("");setNotice("");
   try{
     const r=await accessComplianceCases({type:"obligations",input:{...input,requestId:retry.current.id}},brokerageId)
       .catch(()=>{throw new Error("Save could not be confirmed. Retry the same action to check whether it was recorded.");});
     if(!alive.current)return;
     if("error" in r)throw new Error(r.error);
     const result=z.object({error:z.string().optional(),kind:z.string().optional(),month:z.string().optional(),workId:z.string().optional()}).parse(r.kind==="obligations"?r.result:{});
     if(result.error)throw new Error(result.error);
     if(!["obligationSaved","obligationOccurrence","obligationWorkPlanned"].includes(result.kind??""))throw new Error("Save could not be confirmed. Retry the unchanged form.");
     if(result.kind==="obligationWorkPlanned"){
       const target=plannedReview.parse({entityId,month:result.month,itemId:result.workId});
       setPlanned(target);
     } else setPlanned(undefined);
     retry.current=undefined;
     if(close)back();
     const message = result.kind === "obligationWorkPlanned" ? `Review work saved for ${result.month}.` :
       close ? "Saved a new obligation version." : "Period recorded. Existing period evidence is preserved.";
     setNotice(message);
     if(!close)refresh(v=>v+1);
   }catch(e){
     if(!alive.current)return;
     const message=e instanceof Error?e.message:"Save could not be confirmed. Retry the unchanged form.";
     if(message.startsWith("The state obligation source changed."))setSourceNeedsReselection(true);
     setError(message);
   }
   finally{if(alive.current)setBusy(false);}
 }
 function save(event:FormEvent<HTMLFormElement>){
   event.preventDefault();
   if(sourceRecoveryPending)return;
   const form=new FormData(event.currentTarget);
   const draft=Object.fromEntries(["title","sourceUrl","authority","basis","applicability","applicabilityReason","reviewerEvidence","effectiveFrom","effectiveThrough","cadence","ownerEmail"].map(k=>[k,text(form,k)]));
   const parsed=obligationDraft.safeParse({...draft,
     ...(linkedSource?{sourceUrl:linkedSource.sourceUrl,authority:linkedSource.authority}:{}),
     preparation:text(form,"preparation") || undefined,
     ...(text(form,"annualStartMonth") ? {annualStartMonth:Number(text(form,"annualStartMonth"))} : {}),
     internalTargetDay:Number(text(form,"internalTargetDay"))});
   if(!parsed.success){setError(parsed.error.issues.map(i=>`${i.path.join(".")}: ${i.message}`).join("; "));return;}
   const stateReference = chosenSource ? {
     jurisdiction:chosenSource.jurisdiction,revision:chosenSource.revision,sourceKey:chosenSource.sourceKey,
   } : undefined;
   void mutate({operation:"save",entityId,id:selected?.id??newId.current,expectedRevision:selected?.revision??0,
     draft:parsed.data,...(stateReference?{stateReference}:{})},true);
 }
 const draft:Partial<ObligationDraft>=selected?.draft??{};
 const chosenSource=sources?.find(source=>source.sourceKey===sourceKey);
 const staleSource=error.startsWith("The state obligation source changed.");
 const sourceRecoveryPending=sourceNeedsReselection&&(!chosenSource||staleSource);
 const linkedSource=chosenSource??selected?.stateBasis;
 const selectedEntity=entities.find(entity=>entity.id===entityId);
 if(paused)return <p>Obligations are unavailable while the workspace is paused.</p>;
 return <>
 {selected && auditPeriod && <IllinoisAuditEvidence brokerageId={brokerageId} entityId={entityId}
   obligationId={selected.id} period={auditPeriod} onBack={() => {
     setAuditPeriod(undefined);
     refresh(value => value + 1);
     requestAnimationFrame(() => auditReturn.current?.focus());
   }} />}
 <div hidden={Boolean(auditPeriod)}><section className="integration manager-panel record-form compliance-pilot-form" aria-label="Obligations">
   <h2 ref={heading} tabIndex={-1}>{selected===undefined?"Obligations":selected?selected.draft.title:"Add obligation"}</h2>
   <p className="muted">Internal planning. Applicability and statutory deadlines require legal review.</p>
   {(error||notice)&&<div ref={feedback} tabIndex={-1} className={error?"application-message banner-error":"application-message"} role={error?"alert":"status"}>{error||notice}{notice&&planned&&<div className="mt-2"><Button size="sm" onClick={()=>openReview(planned)}>Open review item</Button></div>}</div>}
   {selected===undefined?<>
     <div className="form-grid items-start"><label className="field">Legal entity<select value={entityId} title={selectedEntity?.name} disabled={loadingEntities} onChange={e=>{setEntity(e.target.value);setItems([]);setOffset(0);setMore(false);setError("");setNotice("");setLoading(Boolean(e.target.value));}}><option value="">Select an entity</option>{entities.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select>
       {selectedEntity&&<span className="muted break-words xl:hidden" aria-hidden="true">{selectedEntity.name}</span>}</label>
     <label className="field">Applicability on this page<select value={filter} onChange={e=>setFilter(e.target.value)}><option value="">All decisions</option>{["Needs review","Required","Not applicable"].map(s=><option key={s}>{s}</option>)}</select></label></div>
     <div className="loan-application-actions"><Button disabled={!entityId||loading} onClick={()=>{newId.current=crypto.randomUUID();edit(null);}}>Add obligation</Button><Button variant="outline" onClick={()=>{setLoading(Boolean(entityId));setError("");setNotice("");refresh(v=>v+1);}}>Refresh</Button></div>
     {!entityId&&<p>Add a legal entity in Compliance → Licensing to start planning obligations.</p>}
     {loading||loadingEntities?<p role="status">Loading obligations…</p>:entityId&&!error&&<>
       <ul className="document-list">{items.filter(i=>!filter||i.draft.applicability===filter).map(i=><li className="document-item" key={i.id}><div><strong>{i.draft.title}</strong><p>{i.draft.applicability} · {i.draft.cadence} · Version {i.revision}</p><p>{i.ownerAvailable?i.draft.ownerEmail:"Owner unavailable — reassignment needed"}</p>{i.stateBasisChanged&&<p>State obligation source needs review</p>}</div><Button variant="outline" onClick={()=>edit(i)}>Review obligation</Button></li>)}</ul>
       {!items.some(i=>!filter||i.draft.applicability===filter)&&<p>No obligations match this page and filter.</p>}
       <div className="loan-application-actions"><Button variant="outline" disabled={!offset} onClick={()=>{setOffset(Math.max(0,offset-50));setLoading(true);}}>Previous page</Button><Button variant="outline" disabled={!more} onClick={()=>{setOffset(offset+50);setLoading(true);}}>Next page</Button></div>
     </>}
   </>:<>
     {selected && <div className="record-form">
       <p className="muted">{selectedEntity?.name} · Saved version {selected.revision} · {selected.draft.cadence}</p>
     </div>}
     <details className="document-form" open={selected === null}><summary>{selected ? "Edit obligation version" : "Obligation details"}</summary>
     <form className="record-form" onSubmit={save}><fieldset className="record-form" disabled={busy}>
       <label className="field">Title<input name="title" required minLength={3} maxLength={160} defaultValue={draft.title}/></label>
       <label className="field">State obligation source
         <select ref={sourceSelect} value={sourceKey} disabled={!sources?.length || staleSource}
           onChange={e=>chooseSource(e.target.value)}>
           <option value="">{sourceRecoveryPending ? "Choose a current source" :
             selected?.stateBasis ? "Keep saved source" : "Enter source manually"}</option>
           {sources?.map(source=><option key={source.sourceKey} value={source.sourceKey}>{source.jurisdiction} · {source.title}</option>)}
         </select>
       </label>
       {sourceError ? <p role="status">{sourceError}</p> :
         !sources ? <p role="status">Loading state reporting sources…</p> :
         !sources.length && !selected?.stateBasisChanged && <p className="muted">
           No current state reporting sources. Review the entity’s scope in State rollout or enter the authority manually.
         </p>}
       {(sourceError||sourceRecoveryPending)&&<div className="record-form">
         {sourceRecoveryPending&&<p role="status">
           {staleSource ? "Reload sources, then select a current source. Your edits will stay here." :
             sources?.length ? "Select the current source to continue. Your edits are still here." :
               sources ? "No current sources are available. Review this entity’s state record before trying again." : "Your edits will stay here while sources reload."}
         </p>}
         <div><Button ref={sourceReload} type="button" variant="outline" aria-disabled={!sources&&!sourceError}
           onClick={()=>{if(sources||sourceError)reloadStateSources();}}>Reload sources</Button></div>
       </div>}
       {linkedSource&&<p className="muted">{linkedSource.jurisdiction} · {linkedSource.title} · {sourceRecoveryPending ? "Earlier scope version" : "Scope version"} {linkedSource.revision}</p>}
       {selected?.stateBasisChanged && !chosenSource && sources && <p role="status">The saved reporting basis needs review.{" "}
         {sources.length ? "Select a current source." : "Review the entity’s scope under Research & gaps → State rollout."}
       </p>}
       {linkedSource?<p><a className="underline" href={linkedSource.sourceUrl} target="_blank" rel="noreferrer">{linkedSource.authority}</a></p>:<>
         <label className="field">Authority source (HTTPS)<input name="sourceUrl" type="url" required maxLength={2000}
           value={manualAuthority.sourceUrl} onChange={e=>setManualAuthority({...manualAuthority,sourceUrl:e.target.value})}/></label>
         <label className="field">Authority and section<textarea name="authority" required minLength={5} maxLength={1500}
           value={manualAuthority.authority} onChange={e=>setManualAuthority({...manualAuthority,authority:e.target.value})}/></label>
       </>}
       {([ ["basis","Requirement and scope"],["applicabilityReason","Applicability reasoning"],["reviewerEvidence","Internal review evidence reference"] ] as const).map(([name,label])=><label className="field" key={name}>{label}<textarea name={name} required={name!=="reviewerEvidence"} minLength={name==="reviewerEvidence"?0:5} maxLength={1500} defaultValue={draft[name]}/></label>)}
       <div className="form-grid"><label className="field">Applicability<select name="applicability" defaultValue={draft.applicability??"Needs review"}>{["Needs review","Required","Not applicable"].map(s=><option key={s}>{s}</option>)}</select></label>
       <label className="field">Active admin owner email<input type="email" name="ownerEmail" required defaultValue={draft.ownerEmail}/></label>
       <label className="field">Effective from<input name="effectiveFrom" type="date" required defaultValue={draft.effectiveFrom}/></label><label className="field">Effective through (optional)<input name="effectiveThrough" type="date" defaultValue={draft.effectiveThrough}/></label>
       <label className="field">Internal cadence<select name="cadence" value={cadence}
         onChange={event=>setCadence(event.target.value as ObligationDraft["cadence"])}>{obligationDraft.shape.cadence.options.map(s=><option key={s}>{s}</option>)}</select></label>
       {(cadence==="Annual"||cadence==="Fiscal quarterly")&&<label className="field">{cadence==="Annual"?"Annual period starts":"Fiscal year starts"}<select name="annualStartMonth" required={cadence==="Fiscal quarterly"} defaultValue={draft.annualStartMonth??""}>
         <option value="">{cadence==="Annual"?"January assumed · confirm if needed":"Choose a month"}</option>
         {months.map((month,index)=><option key={month} value={index+1}>{month}</option>)}
       </select></label>}
       <label className="field">Reporting workbench<select name="preparation" defaultValue={draft.preparation??""}>
         <option value="">Internal review only</option><option>Mortgage Call Report</option>
       </select></label>
       <label className="field">Internal target day in final month (UTC)<input name="internalTargetDay" type="number" required min={1} max={31} defaultValue={draft.internalTargetDay??28}/></label></div>
       <p className="muted">Short months use their final day. These targets are not statutory deadline calculations. Keep borrower data and privileged material out of notes.</p>
       <div className="loan-application-actions"><Button type="submit" disabled={sourceRecoveryPending}>{busy?"Saving…":"Save new version"}</Button>{!selected&&<Button type="button" variant="outline" onClick={back}>Back to obligations</Button>}</div>
     </fieldset></form></details>
     {selected && <div><Button variant="outline" onClick={back}>Back to obligations</Button></div>}
     {selected&&<>
       <h3 id="obligation-periods" tabIndex={-1}>Recorded periods</h3>
       {!history ? (error ? null : <p role="status">Loading history…</p>) : <>
         <ul className="document-list">{history.items.map(period => <li className="document-item" key={period.period}>
           <div><strong>{period.period} · Version {period.version}</strong><p>{period.status}</p>
             <p>{dateLabel(period.from)} through {dateLabel(period.through)}</p>
             <p>Internal target {dateLabel(period.internalTarget)} · {period.ownerEmail}</p>
             {period.stateBasis && <p>Scope version {period.stateBasis.revision} · {period.stateBasis.jurisdiction} ·{" "}
               <a className="underline" href={period.stateBasis.sourceUrl} target="_blank" rel="noreferrer">{period.stateBasis.title}</a>
             </p>}
             {period.illinoisAudit && <p>{period.audit ? <>
               <strong>{period.audit.filingStatus}</strong> · Filing deadline {dateLabel(period.audit.dueOn)}
               {period.audit.extensionStatus !== "No request recorded" && <><br />Extension · {period.audit.extensionStatus}</>}
             </> : "No Illinois audit evidence recorded"}</p>}
             {period.filingStatus && <p>External filing · {period.filingStatus}</p>}
             {period.reportingBasis && <p>{period.reportingBasis.route} · {period.reportingBasis.nominalDueOn ? `Nominal filing date ${dateLabel(period.reportingBasis.nominalDueOn)}` : "Filing date needs review"}<br />{period.reportingBasis.review}</p>}
             {period.stateBasisChanged && <p>Reporting basis needed review when recorded.</p>}</div>
           {period.review ?
             <Button size="sm" variant="outline" id={`obligation-review-${period.review.itemId}`} aria-label={`Open review item for ${period.period}`} disabled={busy}
               onClick={()=>{if(period.review)openReview(period.review);}}>Open review item</Button> :
             <Button size="sm" variant="outline" aria-label={`Plan review work for ${period.period}`} disabled={busy}
               onClick={() => void mutate({operation:"planWork",entityId,id:selected.id,period:period.period},false)}>Plan review work</Button>}
             {period.illinoisAudit && <Button className="min-h-11" variant="outline" disabled={busy}
               onClick={event => { auditReturn.current = event.currentTarget; setAuditPeriod(period.period); }}>
               Review Illinois audit evidence</Button>}
         </li>)}</ul>
         {!history.items.length && <p>No periods recorded.</p>}
         {(historyOffset > 0 || history.more) && <div className="loan-application-actions">
           <Button variant="outline" disabled={!historyOffset||busy} onClick={() => {setHistory(undefined);setHistoryOffset(v=>Math.max(0,v-50));}}>Newer periods</Button>
           <Button variant="outline" disabled={!history.more||busy} onClick={() => {setHistory(undefined);setHistoryOffset(v=>v+50);}}>Older periods</Button>
         </div>}
       </>}
       <details className="document-form"><summary>Add a reporting period</summary>
         <form className="record-form" onSubmit={e=>{e.preventDefault();void mutate({operation:"generate",entityId,id:selected.id,expectedRevision:selected.revision,period:text(new FormData(e.currentTarget),"period")},false);}}><p>Uses saved version {selected.revision}. {periodInstructions(selected.draft)}</p><label className="field">Period first month<input type="month" name="period" required min="2000-01" max="2099-12"/></label><div><Button type="submit" disabled={busy}>Record period</Button></div></form>
       </details>
     </>}
   </>}
 </section></div></>;
}
