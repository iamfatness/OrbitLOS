import {checkpointCanonical} from "./recovery-checkpoint-canonical";
export {checkpointCanonical} from "./recovery-checkpoint-canonical";
import {checkpointImpactCollector} from "./recovery-checkpoint-impact";
import {createHash} from "node:crypto";
import type {CheckpointManifest} from "./recovery-checkpoint-model";
// Full tenant SQL inventory, including unknown future tables and FTS backing tables.
// These bounds fail closed: a partial manifest must never become a checkpoint.
export const checkpointLimits={tables:600,rows:25000,bytes:20*1024*1024,keys:100};
type Reader=(query:string,...values:(string|number)[])=>Record<string,unknown>[];
const quote=(name:string)=>`"${name.replaceAll('"','""')}"`;
export function captureCheckpointManifest(read:Reader,kv:Map<string,unknown>,alarm:number|null,limits=checkpointLimits):CheckpointManifest {
  let bytes=0,totalRows=0;
  const impact=checkpointImpactCollector();
  const encode=(value:unknown)=>{const encoded=checkpointCanonical(value);bytes+=Buffer.byteLength(encoded);if(bytes>limits.bytes)throw new Error("Workspace exceeds the checkpoint inspection limit. No checkpoint was saved.");return encoded;};
  const hash=(value:unknown)=>createHash("sha256").update(encode(value)).digest("hex");
  const schema=read("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name");
  const tables=schema.filter(row=>row.type==="table" && !String(row.name).startsWith("_cf_"));
  if(tables.length>limits.tables || kv.size>limits.keys)throw new Error("Workspace exceeds the checkpoint inspection limit. No checkpoint was saved.");
  const result:CheckpointManifest={version:1,schema:hash(schema),tables:[],kv:{keys:kv.size,digest:hash(kv)},alarm};
  for(const table of tables){
    const name=String(table.name),columns=read(`PRAGMA table_info(${quote(name)})`);
    const count=Number(read(`SELECT COUNT(*) AS n FROM ${quote(name)}`)[0].n);
    totalRows+=count;if(totalRows>limits.rows)throw new Error("Workspace exceeds the checkpoint row limit. No checkpoint was saved.");
    // Bound total payload before loading pages, including BLOBs and large text.
    const sizeColumns=columns.map(row=>`COALESCE(length(CAST(${quote(String(row.name))} AS BLOB)),0)`);
    if(sizeColumns.length){const size=Number(read(`SELECT COALESCE(SUM(${sizeColumns.join("+")}),0) AS n FROM ${quote(name)}`)[0].n);
      if(size+bytes>limits.bytes/2)throw new Error("Workspace exceeds the checkpoint inspection limit. No checkpoint was saved.");}
    if(columns.some(row=>String(row.name)==="__orbit_checkpoint_rowid__"))throw new Error("A workspace table uses a reserved inspection column. No checkpoint was saved.");
    const names=columns.map(row=>String(row.name).toLowerCase());
    const rowid=["rowid","_rowid_","oid"].find(key=>!names.includes(key));
    if(!rowid)throw new Error("A workspace table cannot be fully inspected. No checkpoint was saved.");
    let hasRowid=true;
    try{read(`SELECT ${rowid} FROM ${quote(name)} LIMIT 0`);}catch(error){
      if(!/no such column/i.test(String(error)))throw error;hasRowid=false;
    }
    const primaryNames=columns.filter(row=>Number(row.pk)>0).sort((a,b)=>Number(a.pk)-Number(b.pk)).map(row=>String(row.name));
    const primary=columns.filter(row=>Number(row.pk)>0).sort((a,b)=>Number(a.pk)-Number(b.pk)).map(row=>quote(String(row.name)));
    if(!hasRowid&&!primary.length)throw new Error("A workspace table has no stable inspection order. No checkpoint was saved.");
    // Keep answer payloads and credentials out of the manifest. The impact index
    // contains digests and minimal authorized record labels, not row contents.
    const digest=createHash("sha256");let readRows=0;
    for(let offset=0;offset<count;offset+=100){
      const rows=read(`SELECT ${hasRowid?`${rowid} AS "__orbit_checkpoint_rowid__",`:""}* FROM ${quote(name)} ORDER BY ${hasRowid?rowid:primary.join(",")} LIMIT 100 OFFSET ?`,offset);
      for(const row of rows){const encoded=encode(row);digest.update(encoded);digest.update("\n");impact.add(name,row,primaryNames,encoded);}readRows+=rows.length;
    }
    if(readRows!==count)throw new Error("Workspace changed during inspection. No checkpoint was saved.");
    result.tables.push({name,rows:count,digest:digest.digest("hex")});
  }
  result.impact=impact.finish();
  return result;
}
