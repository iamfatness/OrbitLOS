"use client";
import {useRef,useState} from "react";
import {Button} from "./ui/button";
import type {CheckpointComparison,CheckpointSummary} from "@/lib/recovery-checkpoint-model";
import type {MaintenanceView} from "@/lib/workspace-maintenance-model";
export function RecoveryCheckpoints({endpoint,revision,paused,onSaved}:{endpoint:string;revision:number;paused:boolean;onSaved:(view:MaintenanceView)=>void}){
  const [items,setItems]=useState<CheckpointSummary[]|null>(null),[label,setLabel]=useState("");
  const [selected,setSelected]=useState(""),[comparison,setComparison]=useState<CheckpointComparison|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
  const [request,setRequest]=useState<{id:string;revision:number;label:string}|null>(null),[loadedAt,setLoadedAt]=useState(0);
  const feedback=useRef<HTMLParagraphElement>(null);
  const stale=!!comparison&&comparison.revision!==revision;
  async function call(input:Record<string,unknown>){
    const response=await fetch(`${endpoint}&checkpoints=1`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(input)});
    const result=await response.json() as {error?:string;checkpoint:CheckpointSummary;view:MaintenanceView;items:CheckpointSummary[];comparison:CheckpointComparison};if(!response.ok)throw new Error(result.error??"Checkpoint review unavailable.");return result;
  }
  async function act(action:"list"|"create"|"compare"){
    setLoadedAt(Date.now());setBusy(true);setError("");setMessage("");
    try{
      if(action==="create"){
        // Retain the exact request across a lost reply; retries cannot create another checkpoint.
        const attempt=request??{id:crypto.randomUUID(),revision,label:label.trim()};setRequest(attempt);
        const result=await call({action,...attempt});
        const saved=result.checkpoint as CheckpointSummary;
        onSaved(result.view);setSelected(saved.id);setComparison(null);setLabel("");setRequest(null);
        setItems(previous=>[saved,...(previous??[]).filter(item=>item.id!==saved.id)]);
        setMessage("Checkpoint saved. The workspace remains paused.");
      }else if(action==="list"){
        const result=await call({action,revision});setItems(result.items);setMessage(result.items.length?"Checkpoints refreshed.":"No checkpoints yet. Save one while the workspace is paused.");
      }else{
        const result=await call({action,id:selected,revision});setComparison(result.comparison);setMessage("Comparison ready. No data was changed.");
      }
      requestAnimationFrame(()=>feedback.current?.focus());
    }catch(failure){setError(failure instanceof Error?failure.message:"Checkpoint review unavailable. Your entries are retained.");}
    finally{setBusy(false);}
  }
  const areas=comparison?[...new Set(comparison.changed.map(item=>item.area))]:[];
  return <details className="pipeline relationship-panel maintenance-history"><summary>Recovery checkpoints</summary>
    <p className="muted">Save a recovery point and compare it with the paused workspace. Restoring a checkpoint is not available here yet.</p>
    <div className="maintenance-feedback" aria-live="polite">{error&&<p role="alert" className="application-message banner-error">{error}</p>}
      {message&&<p ref={feedback} tabIndex={-1} role="status" className="application-message">{message}</p>}</div>
    <div className="maintenance-columns">
      <section><h3>Save checkpoint</h3><form className="maintenance-form" onSubmit={event=>{event.preventDefault();void act("create");}}>
        <label className="field">Checkpoint name<input required minLength={3} maxLength={100} value={label} disabled={busy||!!request} onChange={event=>setLabel(event.target.value)} placeholder="Before reviewing document recovery"/></label>
        <Button type="submit" disabled={!paused||busy}>{busy?"Working…":request?"Check saved checkpoint":"Save checkpoint"}</Button>
        {request&&<Button type="button" variant="outline" disabled={busy} onClick={()=>{setRequest(null);setError("");setMessage("Request cleared. Refresh the list before creating another checkpoint.");}}>Clear pending request</Button>}
      </form></section>
      <section><h3>Compare with current work</h3><div className="maintenance-form">
        <Button variant="outline" disabled={!paused||busy} onClick={()=>void act("list")}>{items?"Refresh checkpoints":"Load checkpoints"}</Button>
        {items&&items.length===0&&<p className="muted">No checkpoints saved for this workspace.</p>}
        {!!items?.length&&<><label className="field">Checkpoint<select value={selected} disabled={busy} onChange={event=>{setSelected(event.target.value);setComparison(null);setMessage("");}}>
          <option value="">Choose a checkpoint</option>{items.map(item=><option key={item.id} value={item.id} disabled={Date.parse(item.expiresAt)<=loadedAt}>{item.label} · {new Date(item.at).toLocaleString()}{Date.parse(item.expiresAt)<=loadedAt?" · Expired":""}</option>)}</select></label>
          <Button variant="outline" disabled={!paused||busy||!selected} onClick={()=>void act("compare")}>Compare checkpoint</Button></>}
      </div></section>
    </div>
    {comparison&&<section className="checkpoint-comparison" aria-label="Checkpoint comparison"><h3>{comparison.checkpoint.label}</h3>
      <p className="muted">Saved by {comparison.checkpoint.actor} · {new Date(comparison.checkpoint.at).toLocaleString()}</p>
      {stale?<p role="status">Maintenance changed. Compare again before relying on these results.</p>:<>
        <p><strong>{comparison.changed.length} changed data tables</strong> · {comparison.unchanged} unchanged</p>
        {areas.length?<ul>{areas.map(area=><li key={area}>{area}: {comparison.changed.filter(item=>item.area===area).length} changed</li>)}</ul>:<p>No table contents differ from this checkpoint.</p>}
        <p className="muted">Structure: {comparison.schemaChanged?"changed":"unchanged"} · Workspace settings storage: {comparison.kvChanged?"changed":"unchanged"} · Scheduled wake-up: {comparison.alarmChanged?"changed":"unchanged"}</p>
        {!!comparison.changed.length&&<details><summary>Changed tables and stored-row counts</summary><ul className="checkpoint-table-list">{comparison.changed.map(item=><li key={item.name}><strong>{item.name}</strong><span>{item.change} · {item.before.toLocaleString()} at checkpoint → {item.now.toLocaleString()} now</span></li>)}</ul>
          <p className="muted">Counts include technical records and indexes. Equal counts can still contain changed values.</p></details>}
      </>}
    </section>}
    <p className="muted">Checkpoints cover workspace database contents within a 30-day recovery window. Document files and shared access records require separate review. A checkpoint is not an independent backup.</p>
  </details>;
}
