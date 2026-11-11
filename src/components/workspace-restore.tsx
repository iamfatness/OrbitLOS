"use client";
import {useEffect,useRef,useState} from "react";
import {Button} from "./ui/button";
import {restoreChecks,type RestorePreview,type RestoreJob,type RestoreStartInput} from "@/lib/workspace-restore-model";
import type {MaintenanceView} from "@/lib/workspace-maintenance-model";
export function WorkspaceRestore({endpoint,revision,paused,checkpointId,brokerageName,onSaved,onCompared}:{endpoint:string;revision:number;paused:boolean;checkpointId:string;brokerageName:string;onSaved:(view:MaintenanceView)=>void;onCompared:(comparison:RestorePreview["comparison"])=>void}){
  const [preview,setPreview]=useState<RestorePreview|null>(null),[job,setJob]=useState<RestoreJob|null>(null);
  const [note,setNote]=useState(""),[confirmation,setConfirmation]=useState(""),[checks,setChecks]=useState([false,false,false]);
  const [attempt,setAttempt]=useState<RestoreStartInput|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
  const feedback=useRef<HTMLDivElement>(null);
  const statusVersion=useRef(0);
  const pending=!!job&&job.state!=="Restored",stale=!!preview&&(preview.comparison.revision!==revision||preview.comparison.checkpoint.id!==checkpointId);
  useEffect(()=>{
    if(!paused)return;
    const controller=new AbortController();
    const version=statusVersion.current;
    fetch(`${endpoint}&restore=1`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"status"}),signal:controller.signal})
      .then(async response=>{const data=await response.json() as {error?:string;job:RestoreJob|null};if(!response.ok)throw new Error(data.error??"Restore status unavailable.");
        if(!controller.signal.aborted&&statusVersion.current===version)setJob(data.job);})
      .catch(failure=>{if(!controller.signal.aborted&&statusVersion.current===version)setError(failure instanceof Error?failure.message:"Restore status unavailable.");});
    return ()=>controller.abort();
  },[endpoint,paused]);
  async function call(input:Record<string,unknown>){
    const response=await fetch(`${endpoint}&restore=1`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(input)});
    const data=await response.json() as {error?:string;job:RestoreJob|null;preview:RestorePreview;view:MaintenanceView};
    if(!response.ok)throw new Error(data.error??"The response was interrupted. Check the saved restore outcome.");return data;
  }
  async function act(action:"preview"|"start"|"resume"|"status"){
    statusVersion.current+=1;
    setBusy(true);setError("");setMessage("");
    let expectedId=job?.id;
    try{
      if(action==="preview"){
        const result=await call({action,checkpointId,revision});setPreview(result.preview);onCompared(result.preview.comparison);setChecks([false,false,false]);
        setMessage(result.preview.blockers.length?"Restore is blocked. Review the reasons below.":"Preview ready. No records have changed.");
      }else if(action==="start"){
        if(!preview)return;
        const request=attempt??{id:crypto.randomUUID(),checkpointId,revision,fingerprint:preview.fingerprint,confirmation,note,checks:[true,true,true] as [true,true,true]};
        expectedId=request.id;
        setAttempt(request);const result=await call({action,...request});setJob(result.job);onSaved(result.view);setAttempt(null);
        setMessage("Current work was saved automatically. Apply the reserved restore when ready; the workspace remains paused.");
      }else{
        const result=await call(action==="resume"?{action,id:job?.id}:{action});
        setJob(result.job);if(result.job?.id===attempt?.id)setAttempt(null);onSaved(result.view);setMessage(result.job?.message??"No restore request is saved for this workspace.");
      }
    }catch(failure){
      if(expectedId&&(action==="start"||action==="resume")){
        try{
          const observed=await call({action:"status"});
          if(observed.job?.id===expectedId){
            setJob(observed.job);
            onSaved(observed.view);
            if(action==="start"||observed.job.state!==job?.state){
              setAttempt(null);
              setMessage(observed.job.message);
              return;
            }
          }
        }catch{/* Keep the exact request and let the owner check status again. */}
      }
      setError(failure instanceof Error?failure.message:"Restore response unavailable. Check the saved outcome.");
    }
    finally{setBusy(false);requestAnimationFrame(()=>feedback.current?.focus());}
  }
  return <section className="checkpoint-restore" aria-label="Restore workspace">
    <h3 id="restore-workspace-heading" tabIndex={-1}>Restore workspace</h3>
    <p className="muted">Replace the paused workspace with a saved checkpoint. Orbit saves the current database first. Staff access and portal revocations stay in the shared directory; document files are checked separately.</p>
    <div ref={feedback} tabIndex={-1} aria-live="polite">{error&&<p role="alert" className="application-message banner-error">{error}</p>}{message&&<p role="status" className="application-message">{message}</p>}</div>
    <div className="checkpoint-pages"><Button variant="outline" disabled={!paused||busy} onClick={()=>void act("status")}>Check restore status</Button>
      {!pending&&<Button variant="outline" disabled={!paused||busy||!checkpointId||!!attempt} onClick={()=>void act("preview")}>Preview restore</Button>}</div>
    {job&&<div className="maintenance-status"><div><strong>{job.state==="Requested"?"Restore reserved":job.state==="Restored"?"Restore verified":job.state==="Armed"?"Waiting for verification":"Operator review required"}</strong>
      <p>{job.message}</p><p className="muted">{job.actor} · {new Date(job.at).toLocaleString()} · {job.note}</p>
      {pending&&<p>The workspace stays paused until its database and document evidence are verified.</p>}</div>
      {pending&&job.state!=="Needs review"&&<Button disabled={!paused||busy} onClick={()=>void act("resume")}>{busy?"Checking…":job.state==="Requested"?"Apply reserved restore":"Verify restored workspace"}</Button>}
    </div>}
    {preview&&!pending&&<div><h4>{preview.comparison.checkpoint.label}</h4>
      {stale?<p role="status">Maintenance or checkpoint selection changed. Preview again before restoring.</p>:<>
        <p><strong>{preview.comparison.impact?.total??0} business records affected</strong> · {preview.comparison.changed.length} changed tables · {preview.documents} document files verified</p>
        <p className="muted">Review the complete record comparison above. This restores the whole workspace, including changes outside the displayed records.</p>
        {preview.unretained>0&&<p role="note">{preview.unretained} earlier acceptance records have no retained file. Restore cannot recreate those sample or legacy files.</p>}
        {preview.blockers.length?<ul role="alert">{preview.blockers.map(reason=><li key={reason}>{reason}</li>)}</ul>:<form className="maintenance-form" onSubmit={event=>{event.preventDefault();void act("start");}}>
          <fieldset disabled={busy||!!attempt}><legend>Review this restore</legend>{restoreChecks.map((label,index)=><label className="maintenance-check" key={label}><input type="checkbox" required checked={checks[index]} onChange={event=>setChecks(previous=>previous.map((value,i)=>i===index?event.target.checked:value))}/>{label}</label>)}
            <label className="field">Reason for restore<textarea required minLength={10} maxLength={1000} value={note} onChange={event=>setNote(event.target.value)}/></label>
            <label className="field">Enter {brokerageName} to confirm<input required autoComplete="off" value={confirmation} onChange={event=>setConfirmation(event.target.value)}/></label></fieldset>
          <Button type="submit" disabled={!paused||busy||(!attempt&&(!checks.every(Boolean)||confirmation!==brokerageName||note.trim().length<10))}>{attempt?"Check saved restore request":"Save current work and reserve restore"}</Button>
        </form>}
      </>}
    </div>}
    {attempt&&stale&&<Button disabled={!paused||busy} variant="outline" onClick={()=>void act("start")}>Check saved restore request</Button>}
  </section>;
}
