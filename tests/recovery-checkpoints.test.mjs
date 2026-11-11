import assert from "node:assert/strict";
import {registerHooks} from "node:module";
import {DatabaseSync} from "node:sqlite";
import test from "node:test";
registerHooks({resolve(specifier,context,next){try{return next(specifier,context);}catch(error){if(error.code!=="ERR_MODULE_NOT_FOUND"||!specifier.startsWith("./"))throw error;return next(`${specifier}.ts`,context);}}});
const {captureCheckpointManifest,checkpointLimits,checkpointCanonical}=await import("../src/lib/recovery-checkpoint-manifest.ts");
const checkpoints=await import("../src/lib/recovery-checkpoints.ts");
const {initializeBrokerages}=await import("../src/lib/brokerages.ts");
const {initializeMaintenance,changeMaintenance,markMaintenanceDrained,maintenanceState}=await import("../src/lib/workspace-maintenance.ts");
function fixture(t){const sqlite=new DatabaseSync(":memory:");t.after(()=>sqlite.close());const db={exec:q=>sqlite.exec(q),prepare:q=>sqlite.prepare(q),transaction:fn=>{sqlite.exec("BEGIN");try{const r=fn();sqlite.exec("COMMIT");return r;}catch(e){sqlite.exec("ROLLBACK");throw e;}}};
 const read=(q,...args)=>sqlite.prepare(q).all(...args);return {sqlite,db,read,capture:(kv=new Map(),alarm=null,limits)=>captureCheckpointManifest(read,kv,alarm,limits)};}
function ownerFixture(t){const f=fixture(t);initializeBrokerages(f.db);initializeMaintenance(f.db);checkpoints.initializeRecoveryCheckpoints(f.db);
 const id=crypto.randomUUID(),staff={name:"Owner",email:"owner@example.test",brokerage:{id,name:"Fictional",role:"Admin",pilot:true,accessRevision:1}};
 f.db.prepare("INSERT INTO brokerages VALUES (?,?,1)").run(id,"Fictional");f.db.prepare("INSERT INTO brokerage_members(brokerageId,email,name,role,status,accessRevision) VALUES (?,?,?,'Admin','Active',1)").run(id,staff.email,staff.name);
 changeMaintenance(f.db,staff,[],{type:"pause",revision:0,reason:"Checkpoint acceptance",confirmation:"Fictional"});markMaintenanceDrained(f.db,id,1);
 return {...f,staff,input:()=>({id:crypto.randomUUID(),label:"Before fictional recovery",revision:maintenanceState(f.db,id).revision})};}
test("manifest includes future tables, blobs, rowids, composite keys, indexes and FTS state without exposing contents",t=>{
 const f=fixture(t);f.db.exec("CREATE TABLE loan(id TEXT,value BLOB); INSERT INTO loan VALUES ('private',x'0102'); CREATE TABLE future(a TEXT,b TEXT,PRIMARY KEY(a,b)) WITHOUT ROWID; INSERT INTO future VALUES ('a','b'); CREATE VIRTUAL TABLE search USING fts5(body); INSERT INTO search VALUES ('private search');");
 const a=f.capture();assert(a.tables.some(x=>x.name==='future'));assert(a.tables.some(x=>x.name==='search_data'));assert(!JSON.stringify(a).includes('private'));assert.deepEqual(f.capture(),a);
 f.db.exec("UPDATE loan SET value=x'0103'");const b=f.capture();assert.equal(a.tables[0].rows,b.tables[0].rows);assert.notDeepEqual(b,a);
 f.db.exec("UPDATE loan SET rowid=9");assert.notDeepEqual(f.capture(),b);
 const c=f.capture();f.db.exec("CREATE INDEX new_index ON loan(id)");assert.notEqual(f.capture().schema,c.schema);
});
test("inspection refuses oversized or unsupported state instead of saving partial evidence",t=>{
 const f=fixture(t);f.db.exec("CREATE TABLE data(v TEXT);INSERT INTO data VALUES ('large text')");
 for(const limits of [{...checkpointLimits,rows:0},{...checkpointLimits,tables:0},{...checkpointLimits,bytes:5}])assert.throws(()=>f.capture(new Map(),null,limits),/limit/);
 assert.throws(()=>f.capture(new Map(Array.from({length:101},(_,i)=>[String(i),i]))),/limit/);
 const cyclic={};cyclic.self=cyclic;assert.throws(()=>checkpointCanonical(cyclic),/Unsupported/);
 assert.notEqual(checkpointCanonical(new Uint8Array([1])),checkpointCanonical(new Uint8Array([2])));
 assert.notEqual(f.capture(new Map([['key','a']])).kv.digest,f.capture(new Map([['key','b']])).kv.digest);
});
test("checkpoint creation is tenant-scoped, revision-checked, retry-safe and invalidates reopening approval",t=>{
 const f=ownerFixture(t),input=f.input(),manifest={version:1,schema:'s',tables:[{name:'loans',rows:1,digest:'a'}],kv:{keys:0,digest:'k'},alarm:null};
 const capture={manifest,bookmark:'private-bookmark',at:new Date().toISOString()};
 const saved=checkpoints.saveCheckpoint(f.db,f.staff,[],input,capture);assert(!JSON.stringify(saved).includes('bookmark'));assert.equal(maintenanceState(f.db,f.staff.brokerage.id).revision,input.revision+1);
 assert.deepEqual(checkpoints.saveCheckpoint(f.db,f.staff,[],input,capture),saved);assert.equal(checkpoints.checkpointList(f.db,f.staff,[],input.revision+1).length,1);
 assert.throws(()=>checkpoints.saveCheckpoint(f.db,f.staff,[],{...input,id:crypto.randomUUID()},capture),/refresh/);
 assert.throws(()=>checkpoints.saveCheckpoint(f.db,f.staff,[],{...input,label:'changed request'},capture),/different/);
 assert.throws(()=>checkpoints.checkpointList(f.db,{...f.staff,brokerage:{...f.staff.brokerage,role:'LO'}},[],input.revision+1),/Pause/);
 f.db.prepare("UPDATE brokerage_members SET accessRevision=2 WHERE brokerageId=?").run(f.staff.brokerage.id);
 assert.throws(()=>checkpoints.saveCheckpoint(f.db,f.staff,[],input,capture),/Pause/);
});
test("comparison detects same-count changes, added and removed tables, settings, schema and alarms; no raw state or cross-tenant lookup",t=>{
 const f=ownerFixture(t),input=f.input(),before={version:1,schema:'s',tables:[{name:'loans',rows:1,digest:'a'},{name:'old',rows:0,digest:'b'}],kv:{keys:0,digest:'k'},alarm:null};
 checkpoints.saveCheckpoint(f.db,f.staff,[],input,{manifest:before,bookmark:'hidden',at:new Date().toISOString()});
 const now={...before,schema:'new',tables:[{name:'loans',rows:1,digest:'changed'},{name:'new',rows:0,digest:'b'}],kv:{keys:1,digest:'new'},alarm:1};
 const result=checkpoints.compareCheckpoint(f.db,f.staff,[],input.id,input.revision+1,now);
 assert.equal(result.changed.length,3);assert(result.schemaChanged&&result.kvChanged&&result.alarmChanged);assert(!JSON.stringify(result).includes('hidden'));
 assert.throws(()=>checkpoints.compareCheckpoint(f.db,f.staff,[],crypto.randomUUID(),input.revision+1,now),/unavailable/);
 f.db.prepare("UPDATE brokerage_recovery_checkpoints SET expiresAt='2000-01-01' WHERE id=?").run(input.id);
 assert.throws(()=>checkpoints.compareCheckpoint(f.db,f.staff,[],input.id,input.revision+1,now),/30-day/);
});
