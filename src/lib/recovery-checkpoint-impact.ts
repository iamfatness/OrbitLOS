import {createHash} from "node:crypto";
import type {CheckpointImpact,CheckpointImpactReview,CheckpointRecord,CheckpointRow} from "./recovery-checkpoint-model";
import {checkpointCanonical} from "./recovery-checkpoint-canonical";
const hash=(value:unknown)=>createHash("sha256").update(checkpointCanonical(value)).digest("hex");
const recordKey=(kind:string,id:string)=>`${kind}:${id}`;
const text=(value:unknown)=>typeof value==="string"&&value.length<=200?value:null;
const rootKinds:Record<string,CheckpointRecord["kind"]>={loans:"Loan",contacts:"Contact",referral_leads:"Lead",call_campaigns:"Campaign"};
// These are record associations, not permission grants. Unlinked changes remain
// explicit in the review; a technical row is never invented as a borrower file.
const links:Record<string,string>={loanId:"loans",contactId:"contacts",leadId:"referral_leads",campaignId:"call_campaigns",
  requestId:"document_requests",taskId:"tasks",submissionId:"submissions",realtorId:"contacts",applicationId:"applications"};
type Node={entry:CheckpointRow;refs:string[];root:CheckpointRecord|null;labelContact:string|null};
export function checkpointImpactCollector(){
  const nodes:Node[]=[],byId=new Map<string,Node>(),keys=new Set<string>();
  return {
    add(table:string,row:Record<string,unknown>,primary:string[],encoded:string){
      const key=hash(primary.length&&primary.every(name=>row[name]!==null&&row[name]!==undefined)?primary.map(name=>[name,row[name]]):row.__orbit_checkpoint_rowid__);
      if(keys.has(`${table}:${key}`))throw new Error("Checkpoint record identities are ambiguous. No checkpoint was saved.");
      keys.add(`${table}:${key}`);
      const id=text(row.id)??(table==="applications"?text(row.loanId):null),kind=rootKinds[table];
      const node:Node={entry:{table,key,digest:createHash("sha256").update(encoded).digest("hex"),record:null},
        refs:Object.entries(links).flatMap(([field,target])=>text(row[field])?[`${target}:${row[field]}`]:[]),
        root:kind&&id?{kind,id,label:text(row.name)??text(row.title)??`${kind} ${id}`} :null,
        labelContact:table==="loans"?text(row.contactId):null};
      nodes.push(node);if(id)byId.set(`${table}:${id}`,node);
    },
    finish():CheckpointImpact{
      const records=new Map<string,CheckpointRecord>();
      function resolve(node:Node,seen=new Set<Node>()):CheckpointRecord|null{
        if(seen.has(node))return null;seen.add(node);
        if(node.root)return node.root;
        for(const ref of node.refs){const linked=byId.get(ref);if(linked){const found=resolve(linked,seen);if(found)return found;}}
        return null;
      }
      for(const node of nodes){
        if(node.root&&node.labelContact){const contact=byId.get(`contacts:${node.labelContact}`)?.root;if(contact)node.root.label=contact.label;}
        const record=resolve(node);if(record){node.entry.record=recordKey(record.kind,record.id);records.set(node.entry.record,record);}
      }
      return {version:1,records:[...records.values()].sort((a,b)=>recordKey(a.kind,a.id).localeCompare(recordKey(b.kind,b.id))),rows:nodes.map(node=>node.entry)};
    }
  };
}
export function compareCheckpointImpact(before:CheckpointImpact|undefined,current:CheckpointImpact|undefined,offset=0):CheckpointImpactReview|null{
  if(!before||!current||before.version!==1||current.version!==1)return null;
  const old=new Map(before.rows.map(row=>[`${row.table}:${row.key}`,row])),next=new Map(current.rows.map(row=>[`${row.table}:${row.key}`,row]));
  const oldRecords=new Map(before.records.map(row=>[recordKey(row.kind,row.id),row])),newRecords=new Map(current.records.map(row=>[recordKey(row.kind,row.id),row]));
  const affected=new Map<string,{added:number;removed:number;changed:number}>();
  let added=0,removed=0,changed=0,unlinked=0;
  for(const key of new Set([...old.keys(),...next.keys()])){
    const a=old.get(key),b=next.get(key);if(a&&b&&a.digest===b.digest)continue;
    // Counts describe what restoring would do to current state.
    const type=!a?"removed":!b?"added":"changed";
    if(type==="removed")removed++;else if(type==="added")added++;else changed++;
    const refs=new Set([a?.record,b?.record].filter((id):id is string=>!!id));
    if(!refs.size)unlinked++;
    for(const id of refs){const value=affected.get(id)??{added:0,removed:0,changed:0};value[type]++;affected.set(id,value);}
  }
  const records=[...affected].map(([id,counts])=>({...newRecords.get(id)??oldRecords.get(id)!,...counts,
    effect:!oldRecords.has(id)?"Would remove" as const:!newRecords.has(id)?"Would restore" as const:"Would change" as const}))
    .sort((a,b)=>a.kind.localeCompare(b.kind)||a.label.localeCompare(b.label)||a.id.localeCompare(b.id));
  if(offset>0&&offset>=records.length)throw new Error("Affected records changed. Compare from the first page again.");
  return {records:records.slice(offset,offset+25),total:records.length,offset,next:offset+25<records.length?offset+25:null,unlinked,added,removed,changed};
}
