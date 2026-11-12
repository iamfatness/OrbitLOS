"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { z } from "zod";
import { accessComplianceCases } from "@/app/actions";
import { obligationDraft, type ObligationDraft } from "@/lib/compliance-obligations-model";
import { Button } from "./ui/button";

const row = z.object({ id:z.string(),revision:z.number(),draft:obligationDraft,ownerAvailable:z.boolean() });
const registry = z.object({kind:z.literal("obligationRegistry"),items:z.array(row),more:z.boolean()});
const periods = z.object({kind:z.literal("obligationOccurrences"),more:z.boolean(),items:z.array(z.object({period:z.string(),version:z.number(),status:z.string(),internalTarget:z.string(),createdBy:z.string(),createdAt:z.string()}))});
type Row=z.infer<typeof row>;
const text=(form:FormData,name:string)=>String(form.get(name)??"");

export function ComplianceObligations({brokerageId,paused}:{brokerageId:string;paused:boolean}) {
 const [entities,setEntities]=useState<{id:string;name:string}[]>([]);
 const [entityId,setEntity]=useState("");
 const [items,setItems]=useState<Row[]>([]);
 const [more,setMore]=useState(false),[offset,setOffset]=useState(0),[revision,refresh]=useState(0);
 const [selected,setSelected]=useState<Row|null>(),[history,setHistory]=useState<z.infer<typeof periods>>();
 const [historyOffset,setHistoryOffset]=useState(0);
 const [filter,setFilter]=useState("");
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const feedback=useRef<HTMLDivElement>(null), heading=useRef<HTMLHeadingElement>(null);
 const alive=useRef(false),retry=useRef<{body:string;id:string}|undefined>(undefined),newId=useRef("");
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{if(error||notice)feedback.current?.focus();},[error,notice]);
 useEffect(()=>{heading.current?.focus();},[selected]);
 useEffect(()=>{
   if(paused)return;
   let current=true;
   void accessComplianceCases({type:"program",input:{operation:"entities"}},brokerageId).then(r=>{
     if(!current)return;
     if("error" in r)setError(r.error);else if(r.kind==="programEntities")setEntities(r.entities);
   }).catch(()=>{if(current)setError("Could not load entities. Refresh to retry.");}).finally(()=>{if(current)setLoading(false);});
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
 },[brokerageId,entityId,selected,paused,historyOffset,revision]);
 function back(){setSelected(undefined);setHistory(undefined);setError("");setHistoryOffset(0);}
 async function mutate(input:object,close:boolean){
   if(busy||paused)return;
   const body=JSON.stringify([brokerageId,input]);
   if(retry.current?.body!==body)retry.current={body,id:crypto.randomUUID()};
   setBusy(true);setError("");setNotice("");
   try{
     const r=await accessComplianceCases({type:"obligations",input:{...input,requestId:retry.current.id}},brokerageId);
     if(!alive.current)return;
     if("error" in r)throw new Error(r.error);
     const result=z.object({error:z.string().optional(),kind:z.string().optional()}).parse(r.kind==="obligations"?r.result:{});
     if(result.error)throw new Error(result.error);
     if(!["obligationSaved","obligationOccurrence"].includes(result.kind??""))throw new Error("Save could not be confirmed. Retry the unchanged form.");
     retry.current=undefined;
     if(close)back();
     setNotice(close?"Saved a new obligation version.":"Period recorded. Existing period evidence is preserved.");refresh(v=>v+1);
   }catch(e){if(alive.current)setError(e instanceof Error?e.message:"Save could not be confirmed. Retry the unchanged form.");}
   finally{if(alive.current)setBusy(false);}
 }
 function save(event:FormEvent<HTMLFormElement>){
   event.preventDefault();const form=new FormData(event.currentTarget);
   const draft=Object.fromEntries(["title","sourceUrl","authority","basis","applicability","applicabilityReason","reviewerEvidence","effectiveFrom","effectiveThrough","cadence","ownerEmail"].map(k=>[k,text(form,k)]));
   const parsed=obligationDraft.safeParse({...draft,internalTargetDay:Number(text(form,"internalTargetDay"))});
   if(!parsed.success){setError(parsed.error.issues.map(i=>`${i.path.join(".")}: ${i.message}`).join("; "));return;}
   void mutate({operation:"save",entityId,id:selected?.id??newId.current,expectedRevision:selected?.revision??0,draft:parsed.data},true);
 }
 const draft:Partial<ObligationDraft>=selected?.draft??{};
 if(paused)return <p>Obligations are unavailable while the workspace is paused.</p>;
 return <section className="record-form" aria-label="Obligations">
   <h2 ref={heading} tabIndex={-1}>{selected===undefined?"Obligations":selected?selected.draft.title:"Add obligation"}</h2>
   <p className="muted">Internal planning. Applicability and statutory deadlines require legal review; generated periods do not prove filing or compliance.</p>
   <div ref={feedback} tabIndex={-1} role={error?"alert":"status"}>{error||notice}</div>
   {selected===undefined?<>
     <div className="form-grid"><label className="field">Legal entity<select value={entityId} onChange={e=>{setEntity(e.target.value);setItems([]);setOffset(0);setMore(false);setError("");setNotice("");setLoading(Boolean(e.target.value));}}><option value="">Select an entity</option>{entities.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
     <label className="field">Applicability on this page<select value={filter} onChange={e=>setFilter(e.target.value)}><option value="">All decisions</option>{["Needs review","Required","Not applicable"].map(s=><option key={s}>{s}</option>)}</select></label></div>
     <div className="loan-application-actions"><Button disabled={!entityId||loading} onClick={()=>{newId.current=crypto.randomUUID();setSelected(null);setNotice("");}}>Add obligation</Button><Button variant="outline" onClick={()=>{setLoading(true);setError("");refresh(v=>v+1);}}>Refresh</Button></div>
     {!entityId&&<p>Create entity profiles in Monthly review, then select one here.</p>}
     {loading?<p role="status">Loading obligations…</p>:entityId&&<>
       <ul className="document-list">{items.filter(i=>!filter||i.draft.applicability===filter).map(i=><li className="document-item" key={i.id}><div><strong>{i.draft.title}</strong><p>{i.draft.applicability} · {i.draft.cadence} · Version {i.revision}</p><p>{i.ownerAvailable?i.draft.ownerEmail:"Owner unavailable — reassignment needed"}</p></div><Button variant="outline" onClick={()=>{setSelected(i);setNotice("");setHistory(undefined);}}>Review obligation</Button></li>)}</ul>
       {!items.some(i=>!filter||i.draft.applicability===filter)&&<p>No obligations match this page and filter.</p>}
       <div className="loan-application-actions"><Button variant="outline" disabled={!offset} onClick={()=>{setOffset(Math.max(0,offset-50));setLoading(true);}}>Previous page</Button><Button variant="outline" disabled={!more} onClick={()=>{setOffset(offset+50);setLoading(true);}}>Next page</Button></div>
     </>}
   </>:<>
     <form className="record-form" onSubmit={save}><fieldset className="record-form" disabled={busy}>
       <label className="field">Title<input name="title" required minLength={3} maxLength={160} defaultValue={draft.title}/></label>
       <label className="field">Authority source (HTTPS)<input name="sourceUrl" type="url" required maxLength={2000} defaultValue={draft.sourceUrl}/></label>
       {([ ["authority","Authority and section"],["basis","Requirement and scope"],["applicabilityReason","Applicability reasoning"],["reviewerEvidence","Internal review evidence reference"] ] as const).map(([name,label])=><label className="field" key={name}>{label}<textarea name={name} required={name!=="reviewerEvidence"} minLength={name==="reviewerEvidence"?0:5} maxLength={1500} defaultValue={draft[name]}/></label>)}
       <div className="form-grid"><label className="field">Applicability<select name="applicability" defaultValue={draft.applicability??"Needs review"}>{["Needs review","Required","Not applicable"].map(s=><option key={s}>{s}</option>)}</select></label>
       <label className="field">Active admin owner email<input type="email" name="ownerEmail" required defaultValue={draft.ownerEmail}/></label>
       <label className="field">Effective from<input name="effectiveFrom" type="date" required defaultValue={draft.effectiveFrom}/></label><label className="field">Effective through (optional)<input name="effectiveThrough" type="date" defaultValue={draft.effectiveThrough}/></label>
       <label className="field">Internal cadence<select name="cadence" defaultValue={draft.cadence??"Monthly"}>{["Monthly","Quarterly","Annual"].map(s=><option key={s}>{s}</option>)}</select></label>
       <label className="field">Internal target day in final month (UTC)<input name="internalTargetDay" type="number" required min={1} max={31} defaultValue={draft.internalTargetDay??28}/></label></div>
       <p className="muted">Short months use their final day. These targets are not statutory deadline calculations. Keep borrower data and privileged material out of notes.</p>
       <div className="loan-application-actions"><Button type="submit">{busy?"Saving…":"Save new version"}</Button><Button type="button" variant="outline" onClick={back}>Back to obligations</Button></div>
     </fieldset></form>
     {selected&&<><form className="record-form" onSubmit={e=>{e.preventDefault();void mutate({operation:"generate",entityId,id:selected.id,expectedRevision:selected.revision,period:text(new FormData(e.currentTarget),"period")},false);}}><h3>Record an internal period</h3><p>Uses saved version {selected.revision}; unsaved edits above are not included. Choose January for annual work or January, April, July or October for quarterly work.</p><label className="field">Period first month<input type="month" name="period" required min="2000-01" max="2099-12"/></label><Button type="submit" disabled={busy}>Record period</Button></form>
       <h3>Period history</h3>{!history?<p role="status">Loading history…</p>:<><ul className="document-list">{history.items.map(p=><li className="document-item" key={p.period}><div><strong>{p.period} · Version {p.version}</strong><p>{p.status}</p><p>Internal target: {p.internalTarget} · Recorded by {p.createdBy}</p></div></li>)}</ul>{!history.items.length&&<p>No periods recorded.</p>}<div className="loan-application-actions"><Button variant="outline" disabled={!historyOffset||busy} onClick={()=>{setHistory(undefined);setHistoryOffset(v=>Math.max(0,v-50));}}>Newer periods</Button><Button variant="outline" disabled={!history.more||busy} onClick={()=>{setHistory(undefined);setHistoryOffset(v=>v+50);}}>Older periods</Button></div></>}
     </>}
   </>}
 </section>;
}
