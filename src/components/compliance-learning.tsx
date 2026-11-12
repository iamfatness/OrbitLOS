"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { z } from "zod";
import { accessComplianceCases } from "@/app/actions";
import { learningRequest } from "@/lib/compliance-learning-model";
import { Button } from "./ui/button";

const versionSchema=z.object({id:z.string(),contentId:z.string(),title:z.string(),kind:z.string(),body:z.string(),sourceReferences:z.string(),state:z.string(),questions:z.array(z.object({prompt:z.string(),options:z.array(z.string())}))});
const listSchema=z.object({items:z.array(z.object({id:z.string(),title:z.string().optional(),kind:z.string().optional(),state:z.string().optional(),versionId:z.string().optional(),dueAt:z.string().optional()})),next:z.number().nullable()});
const detailSchema=z.object({version:versionSchema,assignment:z.object({id:z.string(),active:z.boolean(),dueAt:z.string()}).optional(),completion:z.unknown().nullable().optional()});
const assignmentSchema=z.object({items:z.array(z.object({id:z.string(),employeeEmail:z.string(),dueAt:z.string(),active:z.boolean(),completed:z.boolean()})),next:z.number().nullable()});
type Detail=z.infer<typeof detailSchema>;
const value=(f:FormData,k:string)=>String(f.get(k)??"");
const learningSaveMessages: Record<string,string> = {
  createVersion: "Draft saved.", review: "Review recorded for this version.", publish: "Version published for internal use.",
  assign: "Assignment saved.", revokeAssignment: "Assignment revoked. Existing completion evidence is retained.",
};
export function ComplianceLearning({brokerageId,paused,admin=false,initialVersionId,assignmentId,onBack}:{
  brokerageId:string;paused:boolean;admin?:boolean;initialVersionId?:string;assignmentId?:string;onBack?:()=>void;
 }){
 const [page,setPage]=useState<z.infer<typeof listSchema>>(),[detail,setDetail]=useState<Detail>();
 const [selected,setSelected]=useState(initialVersionId??""),[after,setAfter]=useState<number>(),[revision,refresh]=useState(0),[create,setCreate]=useState(false);
 const [error,setError]=useState(""),[notice,setNotice]=useState(""),[busy,setBusy]=useState(false);
 const [kind,setKind]=useState("Policy"),[questions,setQuestions]=useState(1);
 const [assignments,setAssignments]=useState<z.infer<typeof assignmentSchema>>(),[assignmentAfter,setAssignmentAfter]=useState<number>();
 const feedback=useRef<HTMLDivElement>(null),heading=useRef<HTMLHeadingElement>(null),alive=useRef(false);
 const retry=useRef<{body:string;id:string}|undefined>(undefined),contentId=useRef("");
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{if(error||notice)feedback.current?.focus();},[error,notice]);
 useEffect(()=>{heading.current?.focus();},[selected,create,detail?.version.title]);
 useEffect(()=>{
   if(!admin||!selected||paused)return;
   let current=true;
   void accessComplianceCases({type:"learning",input:{operation:"listAssignments",versionId:selected,after:assignmentAfter,assignmentId}},brokerageId).then(r=>{
     if(!current)return;
     const parsed=assignmentSchema.safeParse("kind" in r&&r.kind==="learning"?r.result:null);
     if(parsed.success)setAssignments(parsed.data);else setError("Could not load assignments. Refresh this content to retry.");
   }).catch(()=>{if(current)setError("Could not load assignments. Refresh this content to retry.");});
   return()=>{current=false;};
 },[brokerageId,admin,selected,paused,assignmentAfter,revision,assignmentId]);
 useEffect(()=>{
   if(paused||create)return;
   let current=true;
   const input=selected?(admin?{operation:"readVersion",versionId:selected}:{operation:"readAssignment",assignmentId:selected}):{operation:admin?"list":"myAssignments",after};
   void accessComplianceCases({type:"learning",input},brokerageId).then(r=>{
     if(!current)return;
     if("error" in r)throw new Error(r.error);
     if(r.kind!=="learning")throw new Error("Unexpected response. Refresh to retry.");
     const err=z.object({error:z.string()}).safeParse(r.result);if(err.success)throw new Error(err.data.error);
     if(selected)setDetail(detailSchema.parse(r.result));else setPage(listSchema.parse(r.result));
   }).catch(e=>{if(current)setError(e instanceof Error?e.message:"Could not load learning work. Refresh to retry.");});
   return()=>{current=false;};
 },[brokerageId,paused,admin,after,selected,revision,create]);
 function back(){if(onBack){onBack();return;}setSelected("");setDetail(undefined);setCreate(false);setError("");setPage(undefined);setAssignments(undefined);setAssignmentAfter(undefined);refresh(v=>v+1);}
 async function save(input:object,close=false){
   if(busy||paused)return;
   const body=JSON.stringify([brokerageId,input]);if(retry.current?.body!==body)retry.current={body,id:crypto.randomUUID()};
   const parsed=learningRequest.safeParse({...input,requestId:retry.current.id});
   if(!parsed.success){setError(parsed.error.issues.map(i=>`${i.path.join(".")}: ${i.message}`).join("; "));return;}
   setBusy(true);setError("");setNotice("");
   try{
     const r=await accessComplianceCases({type:"learning",input:parsed.data},brokerageId);
     if(!alive.current)return;
     if("error" in r)throw new Error(r.error);
     const result=z.object({error:z.string().optional(),kind:z.string().optional(),completed:z.boolean().optional(),correct:z.number().optional(),total:z.number().optional()}).parse(r.kind==="learning"?r.result:{});
     if(result.error)throw new Error(result.error);
     if(!["learningMutation","learningEvidence"].includes(result.kind??""))throw new Error("Save could not be confirmed. Retry the unchanged form.");
     retry.current=undefined;
     setNotice(result.completed===false?`Assessment: ${result.correct} of ${result.total} correct. Review the material and try again.`:result.completed?"Completion recorded for this version.":learningSaveMessages[parsed.data.operation]??"Saved.");
     if(close)back();else refresh(v=>v+1);
   }catch(e){if(alive.current)setError(e instanceof Error?e.message:"Save could not be confirmed. Retry the unchanged form.");}
   finally{if(alive.current)setBusy(false);}
 }
 function createVersion(e:FormEvent<HTMLFormElement>){
   e.preventDefault();const f=new FormData(e.currentTarget);
   void save({operation:"createVersion",contentId:contentId.current,previousVersionId:null,kind,title:value(f,"title"),body:value(f,"body"),sourceReferences:value(f,"sourceReferences"),passPercent:kind==="Policy"?100:Number(value(f,"passPercent")),
     questions:kind==="Policy"?[]:Array.from({length:questions},(_,i)=>({prompt:value(f,`prompt${i}`),options:[value(f,`a${i}`),value(f,`b${i}`)],correctIndex:Number(value(f,`correct${i}`)),explanation:value(f,`explanation${i}`)}))},true);
 }
 const assignmentList = !assignments ? <p role="status">Loading assignments…</p> : <>
   <ul className="document-list">{assignments.items.map(a => <li className="document-item record-form" key={a.id}>
     <div><strong className="break-words">{a.employeeEmail}</strong>
       <p>{a.completed ? "Completed · Evidence retained" : "Not completed"} · {a.active ? "Active" : "Revoked or access changed"}</p>
       <p>Internal target {a.dueAt.slice(0,10)} (UTC)</p>
     </div>
     {a.active && <details className="document-form"><summary>Revoke assignment</summary>
       <form className="record-form" onSubmit={e => {
         e.preventDefault();
         void save({operation:"revokeAssignment",assignmentId:a.id,note:value(new FormData(e.currentTarget),"note")});
       }}>
         <label className="field">Reason for revoking assignment<input name="note" required maxLength={2000} disabled={busy} /></label>
         <div><Button variant="outline" type="submit" disabled={busy}>Confirm revocation</Button></div>
       </form>
     </details>}
   </li>)}</ul>
   {!assignments.items.length && <p>{assignmentId ? "This assignment is no longer available." : "No assignments on this page."}</p>}
   {!assignmentId && (assignmentAfter || assignments.next) && <div className="loan-application-actions">
     <Button variant="outline" disabled={!assignmentAfter||busy} onClick={()=>{setAssignments(undefined);setAssignmentAfter(undefined);}}>First assignment page</Button>
     <Button variant="outline" disabled={!assignments.next||busy} onClick={()=>{setAssignments(undefined);setAssignmentAfter(assignments.next??undefined);}}>More assignments</Button>
   </div>}
 </>;
 const policyBody = detail && <>
   <div style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{detail.version.body}</div>
   <details><summary>Sources</summary><p style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{detail.version.sourceReferences}</p></details>
 </>;
 if(paused)return <p>Training and policies are unavailable while the workspace is paused.</p>;
 return <section className="record-form compliance-pilot-form" aria-label={admin?"Training and policies":"My training and policies"}>
   <h2 ref={heading} tabIndex={-1}>{create?"Draft training or policy":detail?.version.title??(admin?"Training & policies":"My training & policies")}</h2>
   {!assignmentId&&<p className="muted">Internal learning and policy evidence. Not accredited continuing education. User and lawyer review are required before publication.</p>}
   {(error||notice)&&<div role={error?"alert":"status"} ref={feedback} tabIndex={-1} className={error?"application-message banner-error":"application-message"}>{error||notice}</div>}
   {!create&&!selected?<>
     <div className="loan-application-actions">{admin&&<Button onClick={()=>{contentId.current=crypto.randomUUID();setCreate(true);setError("");setNotice("");}}>Draft content</Button>}<Button variant="outline" onClick={()=>{setPage(undefined);setError("");setNotice("");refresh(v=>v+1);}}>Refresh</Button></div>
     {!page?(error?null:<p role="status">Loading…</p>):<><ul className="document-list">{page.items.map(i=><li className="document-item" key={i.id}><div><strong>{i.title??"Assigned training or policy"}</strong><p>{i.state??`Target: ${i.dueAt?.slice(0,10)}`}</p></div><Button variant="outline" onClick={()=>{setSelected(i.id);setDetail(undefined);setNotice("");setError("");}}>Open {admin?"content":"assignment"}</Button></li>)}</ul>{!page.items.length&&<p>{admin?"No content versions recorded.":"No assignments on this page."}</p>}<div className="loan-application-actions"><Button variant="outline" disabled={!after} onClick={()=>{setPage(undefined);setAfter(undefined);}}>First page</Button><Button variant="outline" disabled={!page.next} onClick={()=>{setPage(undefined);setAfter(page.next??undefined);}}>Next page</Button></div></>}
   </>:create?<form className="record-form" onSubmit={createVersion}><fieldset className="record-form" disabled={busy}>
     <label className="field">Content type<select value={kind} onChange={e=>setKind(e.target.value)}><option>Policy</option><option>Course</option></select></label>
     <label className="field">Title<input name="title" required maxLength={160}/></label><label className="field">Content<textarea name="body" required maxLength={40000} rows={12}/></label><label className="field">Sources and content rights<textarea name="sourceReferences" required maxLength={4000}/></label>
     {kind==="Course"&&<><label className="field">Passing percentage<input name="passPercent" type="number" min={1} max={100} required defaultValue={80}/></label>{Array.from({length:questions},(_,i)=><fieldset className="record-form" key={i}><legend>Question {i+1}</legend><label className="field">Question<input name={`prompt${i}`} required maxLength={1000}/></label><label className="field">First answer<input name={`a${i}`} required maxLength={500}/></label><label className="field">Second answer<input name={`b${i}`} required maxLength={500}/></label><label className="field">Correct answer<select name={`correct${i}`}><option value="0">First answer</option><option value="1">Second answer</option></select></label><label className="field">Explanation<textarea name={`explanation${i}`} required maxLength={1000}/></label></fieldset>)}<Button variant="outline" type="button" disabled={questions>=20} onClick={()=>setQuestions(v=>v+1)}>Add question</Button></>}
     <div className="loan-application-actions"><Button type="submit">Save draft</Button><Button type="button" variant="outline" onClick={back}>Back to library</Button></div>
   </fieldset></form>:!detail?<>{!error&&<p role="status">Loading content…</p>}<div className="loan-application-actions"><Button variant="outline" onClick={back}>Back to list</Button>{error&&<Button variant="outline" onClick={()=>{setError("");refresh(v=>v+1);}}>Retry loading content</Button>}</div></>:<>
     {assignmentId ? <>
       <p className="muted">{detail.version.state} · Version {detail.version.id.slice(0,8)}</p>
       <section className="record-form" aria-label="Selected acknowledgment">{assignmentList}</section>
       <details className="document-form"><summary>Read policy version</summary>{policyBody}</details>
     </> : <><p>{detail.version.kind} · {detail.version.state}</p>{policyBody}</>}
     {admin? <>
       {detail.version.state==="Draft"&&<form className="record-form" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void save({operation:"review",versionId:selected,note:value(f,"note"),lawyerReviewReference:value(f,"lawyer"),rightsConfirmed:f.get("rights")==="on",userReviewed:f.get("reviewed")==="on"});}}><fieldset className="record-form" disabled={busy}><h3>Record completed review</h3><label className="field">Review findings<textarea name="note" required maxLength={2000}/></label><label className="field">Lawyer review evidence reference<textarea name="lawyer" required maxLength={2000}/></label><label className="compliance-choice"><input type="checkbox" name="reviewed" required/> Owner has reviewed this exact version</label><label className="compliance-choice"><input type="checkbox" name="rights" required/> Content rights are confirmed</label><Button type="submit">Record review</Button></fieldset></form>}
       {detail.version.state==="Owner reviewed"&&<Button disabled={busy} onClick={()=>void save({operation:"publish",versionId:selected})}>Publish reviewed version internally</Button>}
       {!assignmentId&&detail.version.state==="Internally published"&&<form className="record-form" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void save({operation:"assign",versionId:selected,employeeEmail:value(f,"email"),dueAt:`${value(f,"due")}T23:59:59.000Z`});}}><fieldset className="record-form" disabled={busy}><h3>Assign this version</h3><label className="field">Active employee email<input name="email" type="email" required/></label><label className="field">Internal completion target (UTC)<input name="due" type="date" required/></label><Button type="submit">Assign</Button></fieldset></form>}
     </>:detail.completion?<p role="status">Completed. Evidence is retained for this version.</p>:detail.assignment?.active?<form className="record-form" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void save(detail.version.kind==="Policy"?{operation:"acknowledge",assignmentId:selected,versionId:detail.version.id,acknowledged:f.get("ack")==="on"}:{operation:"attempt",assignmentId:selected,versionId:detail.version.id,answers:detail.version.questions.map((_,i)=>Number(value(f,`answer${i}`)))});}}><fieldset className="record-form" disabled={busy}>
       {detail.version.kind==="Policy"?<label className="compliance-choice"><input type="checkbox" name="ack" required/> I have read and acknowledge this policy version.</label>:detail.version.questions.map((q,i)=><fieldset key={i}><legend>{q.prompt}</legend>{q.options.map((o,j)=><label className="compliance-choice" key={j}><input type="radio" required name={`answer${i}`} value={j}/><span>{o}</span></label>)}</fieldset>)}<Button type="submit">{detail.version.kind==="Policy"?"Record acknowledgment":"Submit assessment"}</Button>
     </fieldset></form>:<p>This assignment is no longer active.</p>}
     {admin&&!assignmentId&&<details><summary>Assignments and completion</summary>{assignmentList}</details>}
     <div className="loan-application-actions"><Button variant="outline" disabled={busy} onClick={back}>Back to {onBack?"acknowledgments":admin?"library":"assignments"}</Button><Button variant="outline" disabled={busy} onClick={()=>{setError("");setNotice("");refresh(v=>v+1);}}>Refresh content</Button></div>
   </>}
 </section>;
}
