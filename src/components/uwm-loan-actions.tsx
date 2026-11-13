"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { RefreshCw, ShieldCheck } from "lucide-react";
import type { StaffApplication } from "@/lib/application-model";
import { dateTime } from "@/lib/utils";
import type { WorkspaceStaff } from "@/lib/staff-store";
import { documentDeliveryTarget, importRejectionTarget } from "@/lib/incoming-loan-work-model";
import { documentVerificationTarget, importVerificationTarget } from "@/lib/file-exception-model";
import { uwmActionLabels, uwmRateBody, uwmRateFields, type RateAction, type UwmField } from "@/lib/uwm-loan-ui";
import { uwmConditionAttachments, uwmDocumentType } from "@/lib/uwm-public-contracts";
import { UwmAccount } from "./uwm-account";
import { Button } from "./ui/button";

type Account = { configured: boolean; connectedAt: string | null; environment: string; message: string };
type Import = { id: string; actor: string; state: string; applicationRevision: number; transactionId: string | null; lenderLoanNumber: string | null; scan: string | null; ready: number; committed: number; failureReason: string | null };
type Activity = { uploads: {xml:boolean;documents:boolean}; imports: Import[]; requests: RequestActivity[] };
type RequestActivity = {id:string;action:string;state:string;createdAt:string;updatedAt:string;applicationRevision:number|null;transactionId:string|null;
  fileName:string|null;documentId:number|null;
  followUpAt?:string|null;followUpReviewedAt?:string|null;
  verification?:{outcome:string;evidence:string;recordedAt:string;actor:string}};
const documentSteps: Record<string,{label:string; acknowledged:string; next:string}> = {
  "upload-document": {label:"Document upload", acknowledged:"Confirmed in UWM holding", next:"Review the original file and choose it again under Document to upload when ready."},
  "attach-documents": {label:"Attach to conditions", acknowledged:"Attachment confirmed", next:"Load UWM documents and attachments. Compare the held files and conditions before preparing a new attachment."},
  "submit-documents": {label:"Submit to underwriting", acknowledged:"Submission acknowledged", next:"Load UWM documents and attachments. Check which are still unsubmitted before preparing a new underwriting submission."},
};
type Branch = {entityId:number;name:string|null;contacts:{contactId:number;firstName:string|null;lastName:string|null}[]};
type Attachment = {attachmentId:number;revisionId:string;documentType:string;comments:string;SubmittedDateTime:string|null;files:{documentId:number}[];conditions:string[]};
type Documents = {documents:{documentId:number;fileName:string}[];attachments:Attachment[]};
type Pending = {action:string;payload:Record<string,unknown>;summary:[string,string][];id:string;revision:number};
const formValues = (form: HTMLFormElement) => Object.fromEntries(Array.from(new FormData(form).entries()).map(([key,value])=>[key,String(value)]));
async function json<T>(url:string, body?:unknown, signal?:AbortSignal) {
  const response=await fetch(url,{method:body===undefined?"GET":"POST",cache:"no-store",signal,
    ...(body===undefined?{}:{headers:{"Content-Type":"application/json"},body:JSON.stringify(body)})});
  if(response.redirected || response.status===401) throw new Error("Your Orbit session ended. Sign in again before continuing.");
  const result=await response.json().catch(()=>{throw new Error("Orbit returned an unreadable response. Refresh the request status before continuing.");});
  const error = result && typeof result === "object" && "error" in result ? String(result.error) : "";
  if(!response.ok || error) throw new Error(error || "UWM could not complete this request.");
  return result as T;
}

export function UwmLoanActions({loanId,staff,application,view,rejectionId,verificationId,deliveryId,openVerification}:{loanId:string;staff:WorkspaceStaff;application?:StaffApplication;
  view:"import"|"documents"|"rates";rejectionId?:string;verificationId?:string;deliveryId?:string;openVerification?:(id:string)=>void}) {
  const [account,setAccount]=useState<Account|null>(null), [activity,setActivity]=useState<Activity|null>(null);
  const [error,setError]=useState(""), [message,setMessage]=useState(""), [busy,setBusy]=useState(false), [loading,setLoading]=useState(true);
  const [pending,setPending]=useState<Pending|null>(null), [uncertain,setUncertain]=useState<string|null>(null);
  const [branches,setBranches]=useState<Branch[]>([]), [branch,setBranch]=useState("");
  const [documents,setDocuments]=useState<Documents|null>(null), [rateAction,setRateAction]=useState<RateAction>("products");
  const [products,setProducts]=useState<unknown[]|null>(null);
  const confirmation=useRef<HTMLDivElement>(null);
  const documentInput=useRef<HTMLInputElement>(null);
  const heldDocumentsButton=useRef<HTMLButtonElement>(null);
  useEffect(()=>{if(pending)confirmation.current?.focus();},[pending]);
  const sending=useRef(false), endpoint=`/api/uwm-file?brokerage=${encodeURIComponent(staff.brokerage.id)}`;
  const accountUrl=`/api/uwm-account?brokerage=${encodeURIComponent(staff.brokerage.id)}`;
  const readUrl=`/api/uwm-file/read?brokerage=${encodeURIComponent(staff.brokerage.id)}`;
  const reviewed=!!application?.submittedAt && !!application.reviewedAt && !application.correctionNote;
  const linked=activity?.imports.find(item=>item.state==="Completed" && item.lenderLoanNumber);
  const importReview=activity?.imports.find(item=>item.state==="Prepared" && !item.committed && item.scan);
  const latestImport=activity?.imports[0];
  const rejection=rejectionId ? activity?.imports.find(item=>item.id===rejectionId && item.state==="Failed") :
    latestImport?.state==="Failed" ? latestImport : undefined;
  const selectedRejectionId=rejection?.id;
  const rejectionPanel=useRef<HTMLElement>(null);
  const verificationPanel=useRef<HTMLElement>(null);
  const verification=activity?.requests.find(request=>request.id===verificationId);
  const verificationState=verification?.state;
  const verifyingDocument=view==="documents" && !!verificationId;
  useEffect(()=>{
    if(verificationId && verificationState && !loading && !pending) {
      verificationPanel.current?.scrollIntoView({block:"start"});
      verificationPanel.current?.focus({preventScroll:true});
    }
  },[loading,pending,verificationId,verificationState]);
  useEffect(()=>{
    if(rejectionId && selectedRejectionId && !loading) {
      rejectionPanel.current?.scrollIntoView({block:"start"});
      rejectionPanel.current?.focus({preventScroll:true});
    }
  },[loading,rejectionId,selectedRejectionId]);
  const importPending=activity?.imports.some(item=>["Acknowledged","Dispatching","Unknown"].includes(item.state));
  const unresolved=activity?.requests.some(item=>["Unknown","Dispatching"].includes(item.state));
  const documentRequests=activity?.requests.filter(request=>documentSteps[request.action]) ?? [];
  const deliveryPanel=useRef<HTMLLIElement>(null);
  const delivery=documentRequests.find(request=>request.id===deliveryId);
  const deliveryState=delivery?.state;
  const deliveryReviewedAt=delivery?.followUpReviewedAt;
  useEffect(()=>{
    if(!deliveryId || !deliveryState || loading) return;
    deliveryPanel.current?.scrollIntoView({block:"start"});
    deliveryPanel.current?.focus({preventScroll:true});
  },[deliveryId,deliveryReviewedAt,deliveryState,loading]);
  const selectedRequestId=verificationId ?? deliveryId;
  const connected=!!account?.configured && !!account.connectedAt;
  const canWrite=connected && reviewed && !unresolved && !uncertain && !busy;
  const processor=staff.brokerage.role==="Processor";

  useEffect(()=>{
    const controller=new AbortController();
    (async()=>{
      try {
        const current=await json<Account>(accountUrl,undefined,controller.signal) as Account;setAccount(current);
        if(current.configured) setActivity(await json<Activity>(readUrl,{loanId,view:"activity",requestId:selectedRequestId},controller.signal));
      } catch(failure) {if(!controller.signal.aborted)setError(failure instanceof Error?failure.message:"UWM status is unavailable.");}
      finally {if(!controller.signal.aborted)setLoading(false);}
    })();
    return()=>controller.abort();
  },[accountUrl,readUrl,loanId,selectedRequestId]);
  async function refresh() {
    setBusy(true);setError("");
    try {
      setAccount(await json<Account>(accountUrl));
      const next=await json<Activity>(readUrl,{loanId,view:"activity",requestId:selectedRequestId});setActivity(next);
      if(uncertain && next.requests.some(item=>item.id===uncertain && !["Dispatching","Unknown"].includes(item.state))) {
        setUncertain(null);
        setPending(current=>current?.id===uncertain?null:current);
      }
    } catch(failure){setError(failure instanceof Error?failure.message:"Status could not be refreshed.");}
    finally{setBusy(false);}
  }
  function review(action:string,payload:Record<string,unknown>,summary:[string,string][]) {
    const revision=action==="reconcile-request" ? activity?.requests.find(request=>request.id===payload.requestId)?.applicationRevision : application?.revision;
    setError("");setMessage("");setPending({action,payload,summary,id:crypto.randomUUID(),revision:revision??0});
  }
  async function send() {
    if(!pending || sending.current || !pending.revision) return;
    sending.current=true;setBusy(true);setError("");
    const request={...pending.payload,action:pending.action,id:pending.id,loanId,applicationRevision:pending.revision,confirmed:true};
    let definitive=false;
    try {
      // Keep the id on any network failure. Never create a new intent to retry an
      // uncertain response; refresh and reconcile the durable request instead.
      const response=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(request)});
      if(response.redirected)throw new Error("Sign in to Orbit again, then check request status before sending anything else.");
      const result=await response.json().catch(()=>{throw new Error("Orbit returned an unreadable response. Check the original request before continuing.");}) as {id?:string;state?:string;error?:string;result?:{message?:string}};
      definitive=Boolean(result.id) || (!response.ok && response.status<500);
      if(result.id && result.state==="Rejected") {setPending(null);throw new Error(result.error || "UWM rejected this request.");}
      if(!response.ok || result.error || ["Unknown","Dispatching"].includes(result.state??"")) {
        if(result.id || !definitive)setUncertain(pending.id);throw new Error(result.error || "The outcome is not confirmed. Refresh and verify the lender file before another request.");
      }
      definitive=true;setUncertain(null);
      setMessage(result.result?.message || `${uwmActionLabels[pending.action]} acknowledged. Refresh to check the latest lender outcome.`);
      setPending(null);setProducts(null);setDocuments(null);
      setActivity(await json<Activity>(readUrl,{loanId,view:"activity",requestId:selectedRequestId}));
    } catch(failure) {
      setError(failure instanceof Error?failure.message:"Request outcome is unknown. Check its status before continuing.");
      // Unknown browser/network outcomes also block a new request until checked.
      if(!definitive)setUncertain(pending.id);
      else setPending(null);
    } finally{setBusy(false);sending.current=false;}
  }
  async function brokerAccess() {
    setBusy(true);setError("");
    try {const result=await json<{associations:{branches:Branch[]};message:string}>(accountUrl,{action:"verify"});setBranches(result.associations.branches);setMessage(result.message);}
    catch(failure){setError(failure instanceof Error?failure.message:"Broker access unavailable.");}
    finally{setBusy(false);}
  }
  async function prepareImport(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();const form=event.currentTarget,values=formValues(form),file=new FormData(form).get("xml");
    try {
      if(!(file instanceof File)||!file.size||file.size>1024*1024)throw new Error("Choose a MISMO XML file no larger than 1 MiB.");
      const xml=await file.text();
      review("prepare-import",{xml,scan:{entityId:values.entityId,contactId:values.contactId}},[["File",file.name],["Application",`Reviewed revision ${application?.revision}`],["Branch",branches.find(item=>String(item.entityId)===values.entityId)?.name || values.entityId],["Action","Upload to UWM and check required fields. This does not commit the loan."]]);
    } catch(failure){setError(failure instanceof Error?failure.message:"Could not read this XML file.");}
  }
  async function uploadDocument(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();const file=new FormData(event.currentTarget).get("document");
    try {
      if(!(file instanceof File)||!file.size||file.size>6*1024*1024)throw new Error("Choose a document no larger than 6 MiB.");
      const bytes=new Uint8Array(await file.arrayBuffer());let binary="";
      for(let offset=0;offset<bytes.length;offset+=8192)binary+=String.fromCharCode(...bytes.subarray(offset,offset+8192));
      review("upload-document",{fileName:file.name,content:btoa(binary)},[["File",file.name],["UWM loan",linked?.lenderLoanNumber || ""],["Action","Upload and hold. Underwriting submission is a separate step."]]);
    } catch(failure){setError(failure instanceof Error?failure.message:"Could not read this document.");}
  }
  async function loadDocuments() {setBusy(true);setError("");try{setDocuments(await json<Documents>(readUrl,{loanId,view:"documents"}));}catch(failure){setError(failure instanceof Error?failure.message:"Documents unavailable.");}finally{setBusy(false);}}
  async function checkDocumentRequest(request:RequestActivity) {
    if(busy || !request.applicationRevision)return;
    setBusy(true);setError("");setMessage("");
    try {
      const outcome=await json<{result?:{message?:string}}>(endpoint,{action:"check-document-request",id:crypto.randomUUID(),
        requestId:request.id,loanId,applicationRevision:request.applicationRevision,confirmed:true});
      await refresh();
      setMessage(outcome.result?.message ?? "The original request status was refreshed.");
    } catch(failure) {
      setError(failure instanceof Error?failure.message:"Could not check the original document request.");
    } finally {setBusy(false);}
  }
  async function reviewDocumentFollowUp(request:RequestActivity) {
    if(busy || !request.applicationRevision) return;
    setBusy(true);setError("");setMessage("");
    try {
      await json(endpoint,{action:"review-document-follow-up",id:crypto.randomUUID(),requestId:request.id,loanId,
        applicationRevision:request.applicationRevision,confirmed:true});
      await refresh();
      setMessage("Follow-up reviewed in Orbit.");
    } catch(failure) {
      setError(failure instanceof Error ? failure.message : "Could not confirm the follow-up review. Try again.");
    } finally {setBusy(false);}
  }
  async function price(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();const values=formValues(event.currentTarget);
    try {
      const body=uwmRateBody(rateAction,values);
      if(rateAction==="products") {setBusy(true);const result=await json<{CanSeePricing:boolean;UserHasExternalViewPricingPermission:boolean;Quote:{QuoteSet:{ValidQuotes:unknown[]}}}>(readUrl,{loanId,view:"products",body});
        if(!result.CanSeePricing || !result.UserHasExternalViewPricingPermission)throw new Error("UWM has not granted pricing access for this loan.");
        setProducts(result.Quote.QuoteSet.ValidQuotes);setError("");return;}
      const terms=uwmRateFields(rateAction).filter(field=>values[field.name]).map(field=>[field.label,field.type==="boolean"?(values[field.name]==="true"?"Yes":"No"):field.options?.find(option=>option[0]===values[field.name])?.[1] || values[field.name]] as [string,string]);
      review(rateAction,rateAction==="cancel-lock"?{}:{body},[["UWM loan",linked?.lenderLoanNumber || ""],...terms]);
    }catch(failure){setError(failure instanceof Error?failure.message:"Check the rate terms.");}finally{setBusy(false);}
  }
  return <section className="uwm-loan-card" aria-label={`UWM ${view}`} aria-busy={busy||loading}>
    <div className="section-heading"><div><span className="uwm-eyebrow">United Wholesale Mortgage</span><h3>{view==="import"?"Submit to UWM":view==="documents"?"Deliver documents to UWM":"UWM products & rate requests"}</h3></div>
      <Button variant="outline" size="sm" disabled={busy||loading} onClick={()=>void refresh()}><RefreshCw size={14}/> Refresh</Button></div>
    {loading?<p role="status">Checking your UWM connection…</p>:<>
      <p className="uwm-loan-status"><ShieldCheck size={16}/>{account?.environment==="production"?"Production":"Test environment"} · {linked?`UWM loan ${linked.lenderLoanNumber}`:connected?"Account connected · no completed import":"Account connection needed"}</p>
      {view==="documents" && !pending && !verifyingDocument && !!documentRequests.length && <section className="record-form" aria-label="Condition document requests">
        <h4 className="font-semibold">Condition document requests</h4>
        <ul className="document-list">{documentRequests.slice(0,8).map(request=>{
          const step=documentSteps[request.action];
          const checkLabel=request.action==="upload-document" ? "Check original upload" :
            request.action==="attach-documents" ? "Check original attachment" : "Check original submission";
          const selected=request.id===deliveryId;
          return <li key={request.id} className="document-item record-form break-words"
            id={documentDeliveryTarget(request.id)} ref={selected ? deliveryPanel : undefined} tabIndex={selected ? -1 : undefined}>
            <strong>{step.label}{request.fileName && ` · ${request.fileName}`}</strong>
            {selected && <p className="muted">1003 revision {request.applicationRevision}</p>}
            <p>{request.state==="Acknowledged" ? step.acknowledged : request.state==="Unknown" ? "Needs verification" :
              request.state==="Dispatching" ? "Request in progress" : request.state==="Reconciled" ? "Staff verification recorded" : "Request rejected"}
              {request.documentId && ` · Document ${request.documentId}`}</p>
            {selected && request.followUpAt && <div className="record-form">
              <strong>Admin verified the delivery was not applied</strong>
              <p className="muted">{dateTime(request.followUpAt)} ET</p>
              <p>{step.next}</p>
              <div className="loan-application-actions">
                {linked && (request.action==="upload-document" ? activity?.uploads.documents && canWrite : connected && !busy) &&
                  <Button size="sm" variant="outline" className="min-h-11" onClick={()=>{
                    const control=request.action==="upload-document" ? documentInput.current : heldDocumentsButton.current;
                    control?.scrollIntoView({block:"center"});
                    control?.focus({preventScroll:true});
                  }}>{request.action==="upload-document" ? "Go to document upload" : "Go to held documents"}</Button>}
                {!request.followUpReviewedAt && <Button size="sm" variant="outline" className="min-h-11" disabled={busy}
                  onClick={()=>void reviewDocumentFollowUp(request)}>Mark follow-up reviewed</Button>}
              </div>
              {request.followUpReviewedAt && <p>Follow-up reviewed in Orbit.</p>}
            </div>}
            {request.state==="Unknown" && (request.action!=="upload-document" || request.documentId ?
              <div><Button size="sm" variant="outline" className="min-h-11" disabled={busy||!connected}
                aria-label={request.fileName ? `${checkLabel} for ${request.fileName}` : undefined}
                onClick={()=>void checkDocumentRequest(request)}>{checkLabel}</Button>
                {!connected && <p className="muted">Connect your UWM account to check this request.</p>}</div> :
              <p>Ask a brokerage admin to verify this request in UWM before another attempt.</p>)}
          </li>;
        })}</ul>
      </section>}
      {deliveryId && activity && !deliveryState && <p role="status" className="uwm-feedback">
        The original request is unavailable. Return to Processing and refresh the queue.
      </p>}
      {verificationId && staff.brokerage.role==="Admin" &&
        <div hidden={!!pending}><section id={verifyingDocument ? documentVerificationTarget(verificationId) : importVerificationTarget(verificationId)}
          ref={verificationPanel} tabIndex={-1}
          className="uwm-import-review document-item break-words" aria-label={verifyingDocument ? "Document delivery verification" : "Import verification"}>
          <h4 className="font-semibold">{verifyingDocument ? "Verify original delivery" : "Verify original import"}{verification?.applicationRevision && ` · 1003 revision ${verification.applicationRevision}`}</h4>
          {verification?.transactionId && <p className="muted">Transaction {verification.transactionId}</p>}
          {verifyingDocument && verification && <p className="muted">
            {documentSteps[verification.action]?.label}{verification.fileName && ` · ${verification.fileName}`}
            {verification.documentId && ` · Document ${verification.documentId}`}
          </p>}
          {verifyingDocument && verification?.verification && <div className="record-form">
            <strong>Staff verification · {verification.verification.outcome}</strong>
            <p>{verification.verification.evidence}</p>
            <p className="muted">{verification.verification.actor} · {dateTime(verification.verification.recordedAt)} ET</p>
          </div>}
          {!verification ? <p>This request is unavailable in the current lender activity.</p> :
            (verifyingDocument ? ["Unknown","Dispatching"] : ["Unknown","Dispatching","Acknowledged"]).includes(verification.state) ?
              <><p>{verifyingDocument ? "Check this request in UWM and record what you found. This records staff verification in Orbit." :
                "Check this request in UWM before sending another import. Record what you found."}</p>
                <VerificationForm request={verification} disabled={busy} review={review} /></> :
              <p>This request no longer needs verification. Return to Exceptions for current work.</p>}
        </section></div>}
      {view==="import" && !processor && !pending && rejection &&
        <section id={importRejectionTarget(rejection.id)} ref={rejectionPanel} tabIndex={-1}
          className="uwm-import-review document-item break-words" aria-label="Rejected UWM import">
          <h4 className="font-semibold">UWM rejected 1003 revision {rejection.applicationRevision}</h4>
          {rejection.transactionId && <p className="muted">Transaction {rejection.transactionId}</p>}
          <p>{rejection.failureReason || "UWM did not include a reason. Check this transaction in UWM for details."}</p>
          {rejection !== latestImport ? <p>A newer import attempt is on file.</p> :
            !linked && !importPending && !unresolved && <p>Resolve the issue, then prepare a new submission check using the current reviewed 1003.</p>}
        </section>}
      {rejectionId && activity && !rejection && <p role="status">This rejection is unavailable in the current import activity.</p>}
      {!connected && !verificationId && <UwmAccount brokerageId={staff.brokerage.id} onConnectionChange={()=>void refresh()}/>}
      {connected && !reviewed && !verificationId && <p className="uwm-feedback">Submit and mark the current 1003 reviewed before sending lender requests.</p>}
      {(unresolved||uncertain) && <p className="uwm-feedback">An earlier request needs verification. Refresh its status and check the lender file before sending again.</p>}
      {message && <p role="status" className="uwm-feedback">{message}</p>}
      {error && <p role="alert" className="uwm-feedback is-error">{error}</p>}
      {pending && <div ref={confirmation} tabIndex={-1} className="uwm-confirm" role="region" aria-label="Review UWM request"><h4>Review: {uwmActionLabels[pending.action]}</h4>
        <p>{pending.action==="reconcile-request" ? "This records your verification in Orbit." :
          `This sends the displayed request to UWM${account?.environment==="production"?" in production":" in the test environment"}.`}</p>
        <dl>{pending.summary.map(([label,value],index)=><div key={`${label}:${index}`}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        <div className="loan-application-actions"><Button disabled={busy} onClick={()=>void send()}>{uncertain===pending.id?"Check original request":`Confirm ${uwmActionLabels[pending.action].toLowerCase().replace(/uwm/g,"UWM")}`}</Button><Button variant="outline" disabled={busy||uncertain===pending.id} onClick={()=>setPending(null)}>Back to editing</Button></div></div>}
      <div hidden={!!pending || !!verificationId}>
      {view==="import" && !processor && <>
        {!!activity?.imports.some(item=>item.state==="Failed" && item!==rejection) && <details className="uwm-loan-history">
          <summary>Earlier import rejections</summary>
          <ul>{activity.imports.filter(item=>item.state==="Failed" && item!==rejection).map(item=><li key={item.id} className="break-words">
            <strong>1003 revision {item.applicationRevision}{item.transactionId && ` · Transaction ${item.transactionId}`}</strong>
            <p>{item.failureReason || "UWM did not include a reason."}</p>
          </li>)}</ul>
        </details>}
        {linked?<p>UWM confirmed this import. Open Conditions for document delivery or Pricing &amp; credit for rate requests.</p>:importReview?<ImportReview key={importReview.id+importReview.scan} item={importReview} editable={canWrite && importReview.actor===staff.email && importReview.applicationRevision===application?.revision} review={review}/>:<>
          {activity && !activity.uploads.xml && <p className="uwm-feedback">Submission controls are ready. Orbit still needs UWM’s approved upload address before files can be sent.</p>}
          <Button variant="outline" disabled={!connected||busy} onClick={()=>void brokerAccess()}>Load my UWM branches</Button>
          <form className="uwm-loan-form" onSubmit={event=>void prepareImport(event)}><fieldset disabled={!canWrite||importPending||!activity?.uploads.xml}>
            <label className="field"><span>UWM branch</span><select name="entityId" required value={branch} onChange={event=>setBranch(event.target.value)}><option value="">Choose a branch</option>{branches.map(item=><option key={item.entityId} value={item.entityId}>{item.name||`Branch ${item.entityId}`}</option>)}</select></label>
            <label className="field"><span>UWM loan officer</span><select name="contactId" key={branch} required defaultValue=""><option value="">Choose a loan officer</option>{branches.find(item=>String(item.entityId)===branch)?.contacts.map(item=><option key={item.contactId} value={item.contactId}>{[item.firstName,item.lastName].filter(Boolean).join(" ")||`Contact ${item.contactId}`}</option>)}</select></label>
            <label className="field"><span>Reviewed MISMO XML</span><input name="xml" type="file" accept=".xml,application/xml,text/xml" required/></label>
            <label className="uwm-check"><input type="checkbox" required/>I reviewed this XML against the current borrower application.</label>
            <Button type="submit">Review submission check</Button></fieldset></form>
          {importPending&&<p>Import sent or awaiting confirmation. Refresh for UWM’s completion notification.</p>}
        </>}
      </>}
      {view==="documents" && <>
        {!linked?<p>Document delivery becomes available after UWM confirms this loan’s import.</p>:<>
          {!activity?.uploads.documents && <p className="uwm-feedback">Orbit still needs UWM’s approved document upload address. Existing held documents can be reviewed below.</p>}
          <form className="uwm-loan-form" onSubmit={event=>void uploadDocument(event)}><fieldset disabled={!canWrite||!activity?.uploads.documents}><label className="field"><span>Document to upload</span><input ref={documentInput} type="file" name="document" required accept=".pdf,.doc,.docx,.txt,.tif,.tiff,.gif,.jpg,.jpeg,.png,.xls,.xlsx,.csv,.heif,.heic,.bmp"/></label><Button type="submit">Review document upload</Button></fieldset></form>
          <Button ref={heldDocumentsButton} variant="outline" disabled={!connected||busy} onClick={()=>void loadDocuments()}>Load UWM documents &amp; attachments</Button>
          {documents && <DocumentActions documents={documents} disabled={!canWrite} review={review}/>}
        </>}
      </>}
      {view==="rates" && !processor && <>
        {!linked?<p>Live product search and rate requests become available after UWM confirms this loan’s import.</p>:<>
          <label className="field"><span>UWM action</span><select value={rateAction} disabled={busy} onChange={event=>{setRateAction(event.target.value as RateAction);setError("");}}>{(["products","float","lock","relock","extend-lock","cancel-lock"] as RateAction[]).map(action=><option value={action} key={action}>{uwmActionLabels[action]}</option>)}</select></label>
          <p className="muted">Use the product number and terms from your UWM quote. Requests remain pending until verified with UWM. No term is selected for you.</p>
          <form className="uwm-loan-form" key={rateAction} onSubmit={event=>void price(event)}><fieldset disabled={rateAction==="products"?!connected||busy:!canWrite}>
            <div className="uwm-fields">{uwmRateFields(rateAction).filter(field=>!field.optional).map(field=><RateInput key={field.name} field={field}/>)}</div>
            {uwmRateFields(rateAction).some(field=>field.optional)&&<details><summary>Additional fees and program options</summary><div className="uwm-fields">{uwmRateFields(rateAction).filter(field=>field.optional).map(field=><RateInput key={field.name} field={field}/>)}</div></details>}
            {rateAction==="cancel-lock"&&<p>This requests cancellation of the rate lock on UWM loan {linked.lenderLoanNumber}. Review the lender’s cancellation consequences before confirming.</p>}
            <Button type="submit">{rateAction==="products"?"Find UWM products":"Review rate request"}</Button></fieldset></form>
          {products && <div className="uwm-products"><h4>UWM returned {products.length} products</h4>{products.map((product,index)=><ProductDetails key={index} product={product}/>)}{!products.length&&<p>No products were returned for these options.</p>}</div>}
        </>}
      </>}
      </div>
      {!!activity?.requests.length && <details className="uwm-loan-history"><summary>UWM request activity</summary><ul>{activity.requests.map(request=><li key={request.id}><div><strong>{uwmActionLabels[request.action]||request.action}</strong><span>{request.state==="Acknowledged"?"Request acknowledged — verify lender outcome":request.state} · {new Date(request.createdAt).toLocaleString()}</span></div>
        {staff.brokerage.role==="Admin" && openVerification && documentSteps[request.action] && request.state==="Reconciled" && request.id!==verificationId &&
          <Button size="sm" variant="outline" onClick={()=>openVerification(request.id)}>View staff verification</Button>}
        {staff.brokerage.role==="Admin"&&request.id!==verificationId&&["Unknown","Dispatching","Acknowledged"].includes(request.state)&&
          !(documentSteps[request.action] && request.state==="Acknowledged")&&
          <details><summary>Record verification in UWM</summary><VerificationForm request={request} disabled={busy||!!pending} review={review} /></details>}</li>)}</ul></details>}
    </>}
  </section>;
}

function VerificationForm({request,disabled,review}:{request:RequestActivity;disabled:boolean;
  review:(action:string,payload:Record<string,unknown>,summary:[string,string][])=>void}) {
  return <form className="record-form" onSubmit={event=>{
    event.preventDefault();
    const values=formValues(event.currentTarget);
    review("reconcile-request",{requestId:request.id,outcome:values.outcome,evidence:values.evidence},
      [["Request",uwmActionLabels[request.action]||request.action],["Outcome",values.outcome],["Evidence",values.evidence]]);
  }}>
    <label className="field">Verified outcome<select name="outcome" required defaultValue=""><option value="">Choose…</option><option>Not applied</option><option>Verified in UWM</option></select></label>
    <label className="field">What you checked in UWM<textarea name="evidence" minLength={20} maxLength={2000} required/></label>
    <div><Button size="sm" variant="outline" className="min-h-11" disabled={disabled||!request.applicationRevision} type="submit">Review verification</Button></div>
  </form>;
}

function ImportReview({item,editable,review}:{item:Import;editable:boolean;review:(action:string,payload:Record<string,unknown>,summary:[string,string][])=>void}) {
  const scan=JSON.parse(item.scan!) as {data:{fields:{label?:string;id?:string;value?:unknown;required:boolean;validated:boolean}[]}};
  return <div className="uwm-import-review"><h4>UWM submission check</h4><p>{item.ready?"Required checks passed. Review the file before committing the loan.":"UWM needs the corrections below before submission."}</p>
    {!editable&&<p>Only the original submitting officer can continue, using the same reviewed application revision.</p>}
    {!item.ready&&<form className="uwm-loan-form" onSubmit={event=>{event.preventDefault();const data=new FormData(event.currentTarget);review("amend-import",{importId:item.id,values:scan.data.fields.map((_,index)=>String(data.get(`field${index}`)??""))},[["Action","Update the displayed UWM corrections and recheck the file."]]);}}><fieldset disabled={!editable}>
      {scan.data.fields.map((field,index)=><label className="field" key={index}><span>{field.label||field.id||`Required field ${index+1}`}</span><input name={`field${index}`} defaultValue={typeof field.value==="string"||typeof field.value==="number"?String(field.value):""} required={field.required} autoComplete="off" maxLength={10000}/></label>)}<Button type="submit">Review corrections</Button></fieldset></form>}
    {!!item.ready&&<Button disabled={!editable} onClick={()=>review("commit-import",{importId:item.id},[["Application",`Revision ${item.applicationRevision}`],["Action","Commit this reviewed loan to UWM. Completion will be confirmed by UWM’s notification."]])}>Review and submit loan</Button>}
  </div>;
}
function DocumentActions({documents,disabled,review}:{documents:Documents;disabled:boolean;review:(action:string,payload:Record<string,unknown>,summary:[string,string][])=>void}) {
  const [error,setError]=useState(""), [editing,setEditing]=useState<number|null>(null);
  const selected=documents.attachments.find(item=>item.attachmentId===editing && !item.SubmittedDateTime);
  return <div className="uwm-document-actions"><h4>{selected?"Update attachment":"Held documents"}</h4>{selected&&<Button variant="outline" size="sm" onClick={()=>setEditing(null)}>Create a separate attachment</Button>}{!documents.documents.length?<p>No held documents were returned.</p>:<form className="uwm-loan-form" key={selected?.revisionId??"new"} onSubmit={event=>{
    event.preventDefault();const data=new FormData(event.currentTarget);
    const body={attachments:[{attachmentId:selected?.attachmentId??null,revisionId:selected?.revisionId??null,documentType:String(data.get("documentType")),comments:String(data.get("comments")||""),files:data.getAll("files").map(id=>({documentId:Number(id)})),conditions:String(data.get("conditions")||"").split(/[\n,]/).map(id=>id.trim()).filter(Boolean)}]};
    if(!uwmConditionAttachments.safeParse(body).success){setError("Choose at least one document, a review team and a condition reference.");return;}
    setError("");review("attach-documents",{body},[["Documents",documents.documents.filter(doc=>body.attachments[0].files.some(file=>file.documentId===doc.documentId)).map(doc=>doc.fileName).join(", ")],["Review team",body.attachments[0].documentType],["Conditions",body.attachments[0].conditions.join(", ")],["Comments",body.attachments[0].comments]]);
  }}><fieldset disabled={disabled}>{documents.documents.map(doc=><label className="uwm-check" key={doc.documentId}><input type="checkbox" name="files" value={doc.documentId} defaultChecked={selected?.files.some(file=>file.documentId===doc.documentId)??false}/>{doc.fileName}</label>)}
    <label className="field"><span>Underwriting review team</span><select name="documentType" required defaultValue={selected?.documentType??""}><option value="">Choose…</option>{uwmDocumentType.options.map(type=><option key={type}>{type}</option>)}</select></label>
    <label className="field"><span>UWM condition references</span><textarea name="conditions" required defaultValue={selected?.conditions.join("\n")??""} placeholder="One lender condition reference per line"/></label>
    <label className="field"><span>Comments for underwriting</span><textarea name="comments" maxLength={4000} defaultValue={selected?.comments??""}/></label>
    {error&&<p role="alert">{error}</p>}<Button type="submit">Review attachments</Button></fieldset></form>}
    <h4>Underwriting attachments</h4>{!documents.attachments.length?<p>No attachments were returned.</p>:documents.attachments.map(item=><article className="uwm-attachment" key={item.attachmentId}><strong>{item.documentType}</strong><p>{item.comments||"No comments"}</p><p>{item.files.map(file=>documents.documents.find(doc=>doc.documentId===file.documentId)?.fileName||`Document ${file.documentId}`).join(", ")}</p><p>Conditions: {item.conditions.join(", ")}</p>
      {item.SubmittedDateTime?<span>Submitted {new Date(item.SubmittedDateTime).toLocaleString()}</span>:<div className="loan-application-actions"><Button size="sm" variant="outline" disabled={disabled} onClick={()=>setEditing(item.attachmentId)}>Edit attachment</Button><Button size="sm" disabled={disabled} onClick={()=>review("submit-documents",{attachments:[{attachmentId:item.attachmentId,revisionId:item.revisionId}]},[["Review team",item.documentType],["Conditions",item.conditions.join(", ")],["Action","Send this attachment to underwriting for review."]] )}>Review underwriting submission</Button></div>}</article>)}
  </div>;
}
function ProductDetails({product}:{product:unknown}) {
  if(!product||typeof product!=="object")return null;
  const record=product as Record<string,unknown>;
  // Show lender-labelled values without guessing how an undocumented rate item
  // maps to a financial request. The rate form requires explicit reviewed terms.
  return <details><summary>{typeof record.ProductName==="string"?record.ProductName:"UWM product"}</summary><dl>{Object.entries(record).filter(([,value])=>typeof value==="string"||typeof value==="number").map(([name,value])=><div key={name}><dt>{name.replace(/([a-z])([A-Z])/g,"$1 $2")}</dt><dd>{String(value)}</dd></div>)}</dl><p>Confirm available rate and price terms in your UWM quote before making a rate request.</p></details>;
}

function RateInput({field}:{field:UwmField}) {
  return <label className="field"><span>{field.label}{field.optional?" (optional)":""}</span>{field.options||field.type==="boolean"?<select name={field.name} required={!field.optional} defaultValue=""><option value="">Choose…</option>{(field.options??[["true","Yes"],["false","No"]]).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select>:<input name={field.name} type={field.type==="number"?"number":"text"} step="any" required={!field.optional}/>}</label>;
}
