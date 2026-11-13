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

test("Cloudflare internal tables use their public storage APIs, not protected SQL reads",t=>{
 const f=fixture(t);f.db.exec("CREATE TABLE _cf_METADATA(k INTEGER,v TEXT); CREATE TABLE _cf_KV(k TEXT,v BLOB); CREATE TABLE app(id TEXT);INSERT INTO app VALUES ('one')");
 const read=(q,...args)=>{if(q.includes("_cf_"))throw Error("Protected table");return f.read(q,...args);};
 const manifest=captureCheckpointManifest(read,new Map([['setting','value']]),123);
 assert.deepEqual(manifest.tables.map(t=>t.name),['app']);assert.equal(manifest.kv.keys,1);assert.equal(manifest.alarm,123);
});

test("record comparison names affected loans and contacts, preserves all unlinked changes, and paginates",async t=>{
 const {compareCheckpointImpact}=await import("../src/lib/recovery-checkpoint-impact.ts");
 const f=fixture(t);f.db.exec("CREATE TABLE contacts(id TEXT PRIMARY KEY,name TEXT,email TEXT);CREATE TABLE loans(id TEXT PRIMARY KEY,contactId TEXT);CREATE TABLE document_requests(id TEXT PRIMARY KEY,loanId TEXT,dueOn TEXT);CREATE TABLE document_files(requestId TEXT PRIMARY KEY,secret TEXT);CREATE TABLE technical(id TEXT PRIMARY KEY,v TEXT)");
 f.db.exec("INSERT INTO contacts VALUES ('c','Fictional Borrower','private@example.test');INSERT INTO loans VALUES ('l','c');INSERT INTO document_requests VALUES ('r','l','2030-01-01');INSERT INTO document_files VALUES ('r','private-payload');INSERT INTO technical VALUES ('t','old')");
 const before=f.capture();assert(!JSON.stringify(before.impact).includes('private@example'));assert(!JSON.stringify(before.impact).includes('private-payload'));
 f.db.exec("UPDATE document_files SET secret='changed-private';UPDATE contacts SET email='new-private@example.test';UPDATE technical SET v='new';INSERT INTO contacts VALUES ('new','New fictional contact','private-new@example.test')");
 const result=compareCheckpointImpact(before.impact,f.capture().impact);
 assert.equal(result.total,3);assert.equal(result.unlinked,1);assert.equal(result.records.find(r=>r.kind==='Loan').label,'Fictional Borrower');assert.equal(result.records.find(r=>r.id==='new').effect,'Would remove');
 f.db.exec("DELETE FROM document_files;DELETE FROM document_requests;DELETE FROM loans");const deleted=compareCheckpointImpact(before.impact,f.capture().impact);assert.equal(deleted.records.find(r=>r.kind==='Loan').effect,'Would restore');
 for(let i=0;i<30;i++)f.db.prepare("INSERT INTO contacts VALUES (?,?,?)").run('new'+i,'Fictional '+i,'private'+i+'@example.test');
 const current=f.capture();const first=compareCheckpointImpact(before.impact,current.impact);assert.equal(first.records.length,25);assert.equal(first.next,25);assert.equal(compareCheckpointImpact(before.impact,current.impact,25).next,null);
 assert.equal(compareCheckpointImpact(undefined,current.impact),null);
});
test("directory chunks round-trip a large record index and reject missing pieces",t=>{
 const f=ownerFixture(t),input=f.input();const rows=Array.from({length:750},(_,i)=>({table:'contacts',key:String(i),digest:'a'.repeat(64),record:'Contact:'+i}));
 const records=rows.map((r,i)=>({kind:'Contact',id:String(i),label:'Fictional '+i}));const manifest={version:1,schema:'s',tables:[{name:'contacts',rows:750,digest:'d'}],kv:{keys:0,digest:'k'},alarm:null,impact:{version:1,rows,records}};
 checkpoints.saveCheckpoint(f.db,f.staff,[],input,{manifest,bookmark:'hidden',at:new Date().toISOString()});
 const row=f.db.prepare("SELECT * FROM brokerage_recovery_checkpoints WHERE id=?").get(input.id);assert(JSON.parse(row.manifest).impact.parts>1);assert.equal(JSON.parse(row.manifest).impact.rows.length,0);
 assert.deepEqual(checkpoints.readCheckpointManifest(f.db,row),manifest);
 assert.equal(checkpoints.compareCheckpoint(f.db,f.staff,[],input.id,input.revision+1,manifest).impact.total,0);
 f.db.prepare("DELETE FROM brokerage_checkpoint_parts WHERE checkpointId=? AND part=0").run(input.id);
 assert.throws(()=>checkpoints.readCheckpointManifest(f.db,row),/incomplete/);
});

test("document checkpoint evidence verifies exact bytes and rejects missing, corrupt and in-flight uploads",async t=>{
 const {captureCheckpointFiles,verifyCheckpointFiles}=await import("../src/lib/recovery-checkpoint-files.ts");
 const f=fixture(t);f.db.exec("CREATE TABLE document_files(objectId TEXT,pendingId TEXT);CREATE TABLE document_accepted_files(objectId TEXT,requestId TEXT,revision INTEGER);CREATE TABLE condition_document_sources(objectId TEXT);CREATE TABLE lead_document_requests(objectId TEXT,pendingId TEXT);CREATE TABLE lender_package_files(objectId TEXT);CREATE TABLE document_acceptances(requestId TEXT,revision INTEGER);CREATE TABLE loan_retention_holds(id TEXT,releasedAt TEXT);CREATE TABLE loan_retention_objects(holdId TEXT,objectId TEXT)");
 const id=crypto.randomUUID(),bytes=new TextEncoder().encode('fictional PDF');f.db.prepare("INSERT INTO document_files VALUES (?,NULL)").run(id);f.db.prepare("INSERT INTO document_accepted_files VALUES (?,'r',1)").run(id);f.db.exec("INSERT INTO document_acceptances VALUES ('r',1),('legacy',2)");
 const get=async()=>({size:bytes.byteLength,arrayBuffer:async()=>bytes.buffer});const files=await captureCheckpointFiles(f.db,get);
 assert.equal(files.references,2);assert.equal(files.items.length,1);assert.equal(files.unretained,1);assert.deepEqual(await verifyCheckpointFiles(files,get),{verified:1,unretained:1});
 await assert.rejects(verifyCheckpointFiles(files,async()=>null),/missing/);
 await assert.rejects(verifyCheckpointFiles(files,async()=>({size:bytes.length,arrayBuffer:async()=>new Uint8Array(bytes.length).buffer})),/no longer matches/);
 await assert.rejects(verifyCheckpointFiles(undefined,get),/predates/);
 f.db.exec("UPDATE document_files SET pendingId='pending'");await assert.rejects(captureCheckpointFiles(f.db,get),/pending/);
});

const restore=await import("../src/lib/workspace-restore.ts");
function restoreFixture(t, setup){
 const f=ownerFixture(t);const tenant=fixture(t);tenant.db.exec("CREATE TABLE loans(id TEXT PRIMARY KEY,amount INTEGER);INSERT INTO loans VALUES ('loan-a',100)");
 if(setup)setup(tenant.db);
 const capture=()=>({at:new Date().toISOString(),bookmark:'private-bookmark',manifest:{...tenant.capture(),files:{references:0,unretained:0,items:[]}}});
 const saved=checkpoints.saveCheckpoint(f.db,f.staff,[],f.input(),capture());
 tenant.db.prepare("UPDATE loans SET amount=200").run();
 const revision=maintenanceState(f.db,f.staff.brokerage.id).revision;
 const preview=restore.previewRestore(f.db,f.staff,[],saved.id,revision,capture().manifest);
 const input={id:crypto.randomUUID(),checkpointId:saved.id,revision,fingerprint:preview.fingerprint,confirmation:'Fictional',note:'Reviewed fictional restore impact',checks:[true,true,true]};
 return {...f,tenant,capture,saved,preview,input};
}
test("restore protects assigned processor grants and receipts without freezing ordinary handoff edits", t => {
 const f=restoreFixture(t, db=>db.exec(`CREATE TABLE loan_processing(loanId TEXT PRIMARY KEY,processorEmail TEXT,note TEXT,revision INTEGER);
   CREATE TABLE processor_assignment_receipts(id TEXT PRIMARY KEY,loanId TEXT);
   INSERT INTO loan_processing VALUES ('loan-a','fictional-processor@example.test','Initial handoff',1)`));
 const before=restore.restoreCheckpoint(f.db,f.staff.brokerage.id,f.saved.id).manifest;
 assert(!JSON.stringify(before).includes("fictional-processor@example.test"));
 f.tenant.db.exec("UPDATE loan_processing SET note='New handoff note',revision=2");
 assert.deepEqual(restore.processorRestoreBlockers(before,f.capture().manifest),[]);
 assert.match(restore.processorRestoreBlockers({...before,processorAccessDigest:undefined},f.capture().manifest)[0],/processor access/);
 assert.deepEqual(restore.processorRestoreBlockers({...before,processorAccessDigest:undefined},before),[]);
 f.tenant.db.exec("UPDATE loan_processing SET processorEmail='replacement@example.test'");
 const changed=f.capture(), preview=restore.previewRestore(f.db,f.staff,[],f.saved.id,f.input.revision,changed.manifest);
 assert.match(preview.blockers[0],/processor access/);
 assert.throws(()=>restore.reserveRestore(f.db,f.staff,[],{...f.input,fingerprint:preview.fingerprint},changed),/processor access/);
 assert.equal(f.db.prepare("SELECT count(*) AS n FROM brokerage_restore_jobs").get().n,0);
 f.tenant.db.exec("UPDATE loan_processing SET processorEmail='fictional-processor@example.test'; INSERT INTO processor_assignment_receipts VALUES ('private-receipt','loan-a')");
 assert.match(restore.processorRestoreBlockers(before,f.capture().manifest)[0],/receipts changed/);
 f.tenant.db.exec("DELETE FROM processor_assignment_receipts; UPDATE loan_processing SET processorEmail=NULL");
 assert.match(restore.processorRestoreBlockers(before,f.capture().manifest)[0],/processor access/);
});
test('restore reserves source atomically, blocks reopening and checkpoints, and verifies once',t=>{
 const f=restoreFixture(t);assert.deepEqual(f.preview.blockers,[]);
 const job=restore.reserveRestore(f.db,f.staff,[],f.input,f.capture());
 assert.equal(job.state,'Requested');assert.equal(job.sourceCheckpointId,job.id);
 const source=restore.restoreCheckpoint(f.db,f.staff.brokerage.id,job.sourceCheckpointId);
 assert.equal(restore.restoreStateHash(source.manifest),restore.restoreStateHash(f.capture().manifest));
 const revision=maintenanceState(f.db,f.staff.brokerage.id).revision;
 assert.deepEqual(restore.reserveRestore(f.db,f.staff,[],f.input,f.capture()),job);
 assert.equal(maintenanceState(f.db,f.staff.brokerage.id).revision,revision);
 assert(changeMaintenance(f.db,f.staff,[],{type:'review',revision,review:'Reviewed documents and work',checks:[true,true,true]}).error);
 assert.throws(()=>checkpoints.saveCheckpoint(f.db,f.staff,[],f.input,f.capture()),/pending recovery/);
 const armed=restore.recordRestoreOutcome(f.db,f.staff,[],job.id,'Armed','Armed private test','private-undo');assert.equal(armed.state,'Armed');
 const done=restore.recordRestoreOutcome(f.db,f.staff,[],job.id,'Restored','Verified test');assert.equal(done.state,'Restored');
 const finalRevision=maintenanceState(f.db,f.staff.brokerage.id).revision;
 assert.deepEqual(restore.recordRestoreOutcome(f.db,f.staff,[],job.id,'Restored','Verified test'),done);
 assert.equal(maintenanceState(f.db,f.staff.brokerage.id).revision,finalRevision);
 assert.equal(maintenanceState(f.db,f.staff.brokerage.id).reviewedAt,null);
 assert(!JSON.stringify(job).includes('bookmark'));assert(!JSON.stringify(done).includes('private-undo'));
});
test('restore rejects stale evidence, changed credentials, foreign IDs, revoked admins and incompatible checkpoints',t=>{
 const f=restoreFixture(t);
 f.tenant.db.prepare('UPDATE loans SET amount=300').run();
 assert.throws(()=>restore.reserveRestore(f.db,f.staff,[],f.input,f.capture()),/evidence changed/);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM brokerage_restore_jobs').get().n,0);
 assert.throws(()=>restore.restoreCheckpoint(f.db,crypto.randomUUID(),f.saved.id),/unavailable/);
 assert.throws(()=>restore.reserveRestore(f.db,{...f.staff,brokerage:{...f.staff.brokerage,role:'LO'}},[],f.input,f.capture()),/current pilot admin/);
 const old=f.capture().manifest,next=structuredClone(old);next.tables.push({name:'uwm_user_access',rows:1,digest:'secret-changed'});
 assert(restore.restoreBlockers(old,next).some(x=>x.includes('Lender evidence')));
 assert.deepEqual(restore.restoreBlockers(old,{...old,tables:[...old.tables,{name:'realtor_portals',rows:0,digest:'revoked-local-mirror'}]}),[]);
 assert.equal(restore.restoreSourceMatches(old,{...old,files:{...old.files,unretained:1}}),false);
 assert(restore.restoreBlockers({...old,schema:'older'},next).some(x=>x.includes('structure')));
 assert(restore.restoreBlockers({...old,files:undefined},old).some(x=>x.includes('predates')));
 f.db.prepare("UPDATE brokerage_members SET status='Revoked' WHERE brokerageId=?").run(f.staff.brokerage.id);
 assert.throws(()=>restore.priorRestore(f.db,f.staff,[],f.input),/current pilot admin/);
});
test('unresolved restore stays pending and cannot reopen or start a second job',t=>{
 const f=restoreFixture(t),job=restore.reserveRestore(f.db,f.staff,[],f.input,f.capture());
 restore.recordRestoreOutcome(f.db,f.staff,[],job.id,'Needs review','Neither state matches');
 assert.equal(restore.readRestoreJob(f.db,f.staff.brokerage.id).state,'Needs review');
 assert.throws(()=>restore.reserveRestore(f.db,f.staff,[],{...f.input,id:crypto.randomUUID()},f.capture()),/pending recovery/);
 assert.throws(()=>restore.priorRestore(f.db,f.staff,[],{...f.input,note:'Different confirmation intent'}),/different review/);
 assert.throws(()=>restore.authorizedRestore(f.db,{...f.staff,brokerage:{...f.staff.brokerage,accessRevision:999}},[],job.id),/current pilot admin/);
});


test("an owner hold protects a replaced PDF, blocks deletion and restore, and records a scoped release",async t=>{
 const {initializeStore}=await import("../src/lib/store.ts");
 const {loanRetentionWork}=await import("../src/lib/loan-retention.ts");
 const {documentCleanupBatch,nextDocumentCleanup}=await import("../src/lib/document-files.ts");
 const {captureCheckpointFiles}=await import("../src/lib/recovery-checkpoint-files.ts");
 const f=ownerFixture(t), {db,staff}=f, scope=staff.brokerage.id;
 initializeStore(db,false);
 const id=crypto.randomUUID(),request=crypto.randomUUID(),original=crypto.randomUUID(),replacement=crypto.randomUUID();
 db.exec("INSERT INTO contacts (id,name,email,phone,role) VALUES ('borrower','Fictional Borrower','borrower@example.test','','Borrower')");
 db.prepare("INSERT INTO loans (id,contactId,officer,address,amount,purpose,stage,stageSince) VALUES (?,'borrower','LO','',1,'Purchase','Lead','2026-11-11')").run(id);
 db.prepare("INSERT INTO document_requests (id,loanId,kind,instructions,requestedAt) VALUES (?,?,'Bank statement','','2026-11-11')").run(request,id);
 db.prepare("INSERT INTO document_files (requestId,objectId,attemptedAt) VALUES (?,?,0)").run(request,original);
 const hold={type:"hold",id:crypto.randomUUID(),loanId:id,reference:"Fictional dispute"};
 for(const role of ["LO","Processor"]) assert("error" in loanRetentionWork(db,hold,{...staff,brokerage:{...staff.brokerage,role}},scope));
 assert("error" in loanRetentionWork(db,hold,staff,crypto.randomUUID()));
 const saved=loanRetentionWork(db,hold,staff,scope);
 assert.equal(saved.kind,"saved");
 assert.deepEqual(loanRetentionWork(db,hold,staff,scope),saved);
 assert("error" in loanRetentionWork(db,{...hold,id:crypto.randomUUID()},staff,scope));
 db.prepare("UPDATE document_files SET objectId=? WHERE requestId=?").run(replacement,request);
 assert.equal(db.prepare("SELECT objectId FROM document_file_cleanup").get().objectId,original);
 assert.deepEqual(documentCleanupBatch(db),[]);
 assert.equal(nextDocumentCleanup(db),null);
 const inventory=loanRetentionWork(db,{type:"list",heldOnly:true,search:"Borrower",offset:0},staff,scope);
 assert.deepEqual(inventory.loans.map(row=>[row.id,row.requests,row.pdfs,row.holdId]),[[id,1,2,hold.id]]);
 assert.throws(()=>db.prepare("DELETE FROM loans WHERE id=?").run(id),/retention hold/);
 assert.throws(()=>db.prepare("DELETE FROM document_requests WHERE id=?").run(request),/retention hold/);
 const checkpoint=await captureCheckpointFiles(db,async()=>({size:1,arrayBuffer:async()=>new Uint8Array([1]).buffer}));
 assert.deepEqual(checkpoint.items.map(row=>row.objectId).sort(),[original,replacement].sort());
 const manifest={...f.capture(),files:checkpoint,activeLoanHolds:1};
 assert(restore.restoreBlockers(manifest,manifest).some(message=>/active retention hold/.test(message)));
 const release={type:"release",id:crypto.randomUUID(),loanId:id,holdId:hold.id,reference:"Fictional issue resolved"};
 assert("error" in loanRetentionWork(db,{...release,holdId:crypto.randomUUID()},staff,scope));
 const released=loanRetentionWork(db,release,staff,scope);
 assert.equal(released.kind,"saved");
 assert.deepEqual(loanRetentionWork(db,release,staff,scope),released);
 assert.deepEqual(documentCleanupBatch(db),[original]);
 assert.notEqual(nextDocumentCleanup(db),null);
 const history=loanRetentionWork(db,{type:"history",loanId:id},staff,scope);
 assert.equal(history.holds[0].releaseReference,release.reference);
 assert(!JSON.stringify(history).includes(staff.email));
 assert(restore.restoreBlockers(manifest,{...f.capture(),files:checkpoint,activeLoanHolds:0}).some(message=>/retention evidence changed/.test(message)));
});

test("Michigan retention records preserve dated evidence for each record category without altering loan holds", async t => {
 const {initializeStore}=await import("../src/lib/store.ts");
 const {loanRetentionWork}=await import("../src/lib/loan-retention.ts");
 const {db,staff}=ownerFixture(t);
 const scope=staff.brokerage.id;
 initializeStore(db,false);
 db.exec("INSERT INTO contacts (id,name,email,phone,role) VALUES ('borrower','Fictional Borrower','borrower@example.test','','Borrower')");
 db.exec("INSERT INTO loans (id,contactId,officer,address,amount,purpose,stage,stageSince) VALUES ('mi','borrower','LO','',1,'Purchase','Closed','2026-11-11')");
 const target={kind:"loan",id:"mi"}, now="2026-11-12T16:00:00.000Z";
 const owner=input=>loanRetentionWork(db,input,staff,scope,now);
 const save=(evidence,expected=0,reviewTarget=target)=>({
  type:"saveMichiganRetentionReview",target:reviewTarget,id:crypto.randomUUID(),expected,evidence,
 });
 const history=(category,reviewTarget=target)=>owner({type:"michiganRetentionHistory",target:reviewTarget,category});
 const record={category:"Closed loan file",role:"Broker only",authority:"First mortgage",reference:"Fictional closing file",
  closedOn:"2023-11-13",transfer:{status:"Unknown"}};
 const first=save(record);
 assert("error" in loanRetentionWork(db,first,{...staff,brokerage:{...staff.brokerage,role:"LO"}},scope,now));
 assert("error" in loanRetentionWork(db,first,staff,crypto.randomUUID(),now));
 assert.equal(owner(first).versions[0].finding.date,"2026-11-13");
 assert.equal(owner(first).versions.length,1);
 assert.match(owner({...first,evidence:{...record,reference:"Different closing evidence"}}).error,/different Michigan retention review/i);
 assert.match(owner(save(record)).error,/review changed/i);
 assert.match(owner(save({...record,transfer:{status:"Transferred",date:"2024-01-03"}},1)).error,/retention fields/i);
 const lender={...record,role:"Lender",transfer:{status:"Transferred",date:"2024-01-03"}};
 assert.equal(owner(save(lender,1)).versions[0].finding.date,"2024-01-03");
 assert.equal(owner(save({...lender,transfer:{status:"Unknown"}},2)).versions[0].finding.date,null);
 assert.equal(owner(save({...record,closedOn:"2024-02-29"},3)).versions[0].finding.date,null);
 assert.deepEqual(history(record.category).versions.map(review=>[review.version,review.finding.date]),[
  [4,null],[3,null],[2,"2024-01-03"],[1,"2026-11-13"],
 ]);
 assert.match(owner(save({...record,closedOn:"2026-11-13"},4)).error,/events that have occurred/i);

 const copies={category:"Transferred copies",authority:"Secondary mortgage",closedOn:"2023-11-13",
  transferredOn:"2024-01-03",reference:"Fictional transfer register"};
 assert.equal(owner(save(copies)).versions[0].finding.date,"2026-01-03");
 assert.match(owner(save({...copies,transferredOn:"2023-11-12"},1)).error,/retention fields/i);
 const application={category:"Unsuccessful application",authority:"First mortgage",outcome:"Withdrawn",
  retainThrough:null,counselReference:null,reference:"Fictional withdrawal documentation"};
 assert.equal(owner(save(application)).versions[0].finding.date,null);
 assert.match(owner(save({...application,retainThrough:"2028-05-31"},1)).error,/retention fields/i);
 assert.equal(owner(save({...application,retainThrough:"2028-05-31",counselReference:"Fictional counsel memo"},1)).versions[0].finding.date,"2028-05-31");
 const business={kind:"business",id:"Fictional company books 2025"};
 const books={category:"Other business records",authority:"First mortgage",createdOn:"2025-05-10",fiscalYearEnd:"2025-06-30",
  reference:"Fictional fiscal-year evidence"};
 assert.match(owner(save(books)).error,/category/i);
 assert.equal(owner(save(books,0,business)).versions[0].finding.date,"2028-06-30");
 assert.equal(owner(save({...books,authority:"Secondary mortgage"},1,business)).versions[0].finding.date,"2027-06-30");
 assert.deepEqual(owner({type:"michiganBusinessRecords",offset:0}),{
  kind:"michiganBusinessRecords",records:[business.id],next:null,
 });

 db.prepare("INSERT INTO applications (loanId,token,expiresAt,draft,updatedAt) VALUES ('mi','fictional-token',?,?,?)")
  .run(now,JSON.stringify({propertyLocation:{state:"oh"}}),now);
 assert.equal(owner({type:"list",heldOnly:false,search:"",offset:0}).loans[0].propertyState,"OH");
 assert.match(owner(save(record,4)).error,/outside Michigan/i);
 assert.equal(history(record.category).versions.length,4);
 assert.equal(owner(first).versions.length,4);

 const hold={type:"hold",id:crypto.randomUUID(),loanId:target.id,reference:"Fictional examination hold"};
 assert.equal(owner(hold).kind,"saved");
 assert.equal(history(record.category).held,true);
 assert.equal(history(books.category,business).held,false);
 assert.throws(()=>db.prepare("DELETE FROM loans WHERE id=?").run(target.id),/retention hold/);
 assert(!JSON.stringify(history(record.category)).includes(staff.email));
 assert.equal(owner({type:"release",id:crypto.randomUUID(),loanId:target.id,holdId:hold.id,
  reference:"Fictional examination complete"}).kind,"saved");
 db.prepare("DELETE FROM loans WHERE id=?").run(target.id);
 assert.equal(history(record.category).versions.length,4);
 assert.equal(history(record.category).held,false);
 assert.match(owner(save(record,4)).error,/loan is unavailable/i);
});

test("Michigan retention exports preserve scoped historical findings and reject changed or oversized snapshots", async t => {
 const {initializeStore}=await import("../src/lib/store.ts");
 const {loanRetentionWork}=await import("../src/lib/loan-retention.ts");
 const {reviewRetentionExport,auditRetentionExport,retentionExportResponse}=await import("../src/lib/loan-retention-export.ts");
 const {strFromU8,unzipSync}=await import("fflate");
 const {db,staff}=ownerFixture(t);
 const scope=staff.brokerage.id, now="2026-11-12T16:00:00.000Z";
 initializeStore(db,false);
 db.exec("INSERT INTO contacts (id,name,email,phone,role) VALUES ('borrower','Fictional Borrower','borrower@example.test','','Borrower')");
 const addLoan=db.prepare("INSERT INTO loans (id,contactId,officer,address,amount,purpose,stage,stageSince) VALUES (?,'borrower','LO','',1,'Purchase','Closed','2026-11-11')");
 addLoan.run("loan-one");
 addLoan.run("loan-two");
 const work=input=>loanRetentionWork(db,input,staff,scope,now);
 const record={category:"Closed loan file",role:"Broker only",authority:"First mortgage",reference:"Fictional closing file",
  closedOn:"2023-11-13",transfer:{status:"Unknown"}};
 const save=(kind,id,evidence,expected=0)=>work({
  type:"saveMichiganRetentionReview",id:crypto.randomUUID(),target:{kind,id},evidence,expected,
 });
 const audit={type:"exportRetentionAudit",policyVersion:null};
 assert.deepEqual(JSON.parse(work(audit).json).michiganRetention,[]);
 const denied={...staff,brokerage:{...staff.brokerage,role:"Processor"}};
 assert.match(loanRetentionWork(db,audit,denied,scope,now).error,/current pilot owners/);
 assert.match(loanRetentionWork(db,audit,staff,crypto.randomUUID(),now).error,/current pilot owners/);
 assert.equal(reviewRetentionExport(db,denied,scope,"loan-one").status,404);
 assert.equal(reviewRetentionExport(db,staff,crypto.randomUUID(),"loan-one").status,404);
 assert.equal(save("loan","loan-one",record).kind,"michiganRetention");
 assert.equal(save("loan","loan-two",{...record,reference:"Fictional second file"}).kind,"michiganRetention");
 const books={category:"Other business records",authority:"Secondary mortgage",createdOn:"2025-01-01",
  fiscalYearEnd:"2025-06-30",reference:"Fictional annual books"};
 assert.equal(save("business","Books 2025",books).kind,"michiganRetention");
 const beforeCorrection=reviewRetentionExport(db,staff,scope,"loan-one");
 const corrected={...record,closedOn:"2024-06-01",reference:"Fictional corrected closing"};
 assert.equal(save("loan","loan-one",corrected,1).versions[0].finding.date,"2027-06-01");
 const confirm=fingerprint=>Promise.resolve(auditRetentionExport(db,staff,scope,"loan-one",fingerprint));
 const stale=await retentionExportResponse(undefined,scope,beforeCorrection,confirm);
 assert.equal(stale.status,409);
 const hold={type:"hold",id:crypto.randomUUID(),loanId:"loan-one",reference:"Fictional exam hold"};
 assert.equal(work(hold).kind,"saved");
 const current=reviewRetentionExport(db,staff,scope,"loan-one");
 const zip=await retentionExportResponse(undefined,scope,current,confirm);
 assert.equal(zip.status,200);
 const manifest=JSON.parse(strFromU8(unzipSync(new Uint8Array(await zip.arrayBuffer()))["manifest.json"]));
 assert.deepEqual(manifest.michiganRetention.map(row=>[row.target.id,row.version,row.finding.date,row.activeHold]),[
  ["loan-one",2,"2027-06-01",true],["loan-one",1,"2026-11-13",true],
 ]);
 assert.equal(manifest.michiganRetention[0].evidence.reference,corrected.reference);
 assert.equal(manifest.holdHistory[0].id,hold.id);
 assert(!JSON.stringify(manifest).includes(staff.email));
 db.prepare("DELETE FROM loans WHERE id=?").run("loan-two");
 const full=JSON.parse(work(audit).json);
 assert.equal(full.michiganRetention.length,4);
 assert(full.michiganRetention.some(row=>row.target.id==="loan-two" && !row.activeHold));
 assert(full.michiganRetention.some(row=>row.target.kind==="business" && row.activeHold===null));
 assert(!JSON.stringify(full).includes(staff.email));
 assert.equal(work({type:"saveDispositionPolicy",id:crypto.randomUUID(),expected:0,
  fundedDays:30,closedDays:30,reference:"Fictional retention policy"}).kind,"disposition");
 const filtered=JSON.parse(work({...audit,policyVersion:1}).json);
 assert.equal(filtered.policies[0].version,1);
 assert(!("michiganRetention" in filtered));

 db.exec(`WITH RECURSIVE n(version) AS (SELECT 3 UNION ALL SELECT version+1 FROM n WHERE version<1001)
   INSERT INTO michigan_retention_reviews (id,targetKind,targetId,category,version,evidence,finding,at,actor,actorEmail)
   SELECT 'fixture-' || n.version,r.targetKind,r.targetId,r.category,n.version,r.evidence,r.finding,r.at,r.actor,r.actorEmail
   FROM n JOIN michigan_retention_reviews r ON r.targetKind='loan' AND r.targetId='loan-one' AND r.version=1`);
 assert.match(work(audit).error,/exceeds 1,000 Michigan retention versions/);
 assert.equal(reviewRetentionExport(db,staff,scope,"loan-one").status,413);
 assert.equal(work({...audit,policyVersion:1}).kind,"retentionAuditExport");
});

test("Michigan disposition recommendations use current evidence, both dates and the recorded counsel review", async t => {
 const {initializeStore}=await import("../src/lib/store.ts");
 const {initializeRetentionDisposition}=await import("../src/lib/retention-disposition.ts");
 const {loanRetentionWork}=await import("../src/lib/loan-retention.ts");
 const f=ownerFixture(t);
 const {db,staff}=f, scope=staff.brokerage.id;
 initializeStore(db,false);
 db.exec(`ALTER TABLE loan_retention_reviews DROP COLUMN michiganReview;
   INSERT INTO loan_retention_reviews (id,loanId,policyVersion,basis,previous,outcome,reference,at,actor,actorEmail) VALUES ('legacy-review','old-loan',1,'Withdrawn/2023-01-01/0/0//',NULL,
     'Continue retaining','Fictional legacy review','2026-10-01','Owner','owner@example.test')`);
 initializeRetentionDisposition(db);
 assert.equal(db.prepare("SELECT michiganReview FROM loan_retention_reviews WHERE id='legacy-review'").get().michiganReview,null);
 db.exec("INSERT INTO contacts (id,name,email,phone,role) VALUES ('borrower','Fictional Borrower','borrower@example.test','','Borrower')");
 const create=db.prepare("INSERT INTO loans (id,contactId,officer,address,amount,purpose,stage,stageSince) VALUES (?,'borrower','LO','',1,'Purchase','Funded','2023-11-13')");
 const property=db.prepare("INSERT INTO applications (loanId,token,expiresAt,draft,updatedAt) VALUES (?,?, '2027-01-01',?, '2026-11-12')");
 for(const [id,state] of [["mi","MI"],["oh","OH"],["mi-withdrawn","MI"]]){
  create.run(id);
  property.run(id,id,JSON.stringify({propertyLocation:{state}}));
 }
 db.exec(`INSERT INTO closing_progress (loanId,fundingDate) VALUES ('mi','2023-11-13'),('oh','2023-11-13');
  UPDATE loans SET disposition='Withdrawn',dispositionDate='2023-11-13' WHERE id='mi-withdrawn'`);
 const now="2026-11-12T16:00:00.000Z";
 const work=(input,at=now)=>loanRetentionWork(db,input,staff,scope,at);
 const queue={type:"dispositionQueue",offset:0};
 const row=(id="mi",at=now)=>work(queue,at).rows.find(item=>item.id===id);
 const save=(id,evidence,expected=0)=>work({
  type:"saveMichiganRetentionReview",id:crypto.randomUUID(),target:{kind:"loan",id},evidence,expected,
 });
 const decide=(item,fields={})=>({type:"saveDispositionReview",id:crypto.randomUUID(),loanId:item.id,
  policyVersion:1,basis:item.basis,previous:item.decision?.id??null,outcome:"Recommend disposition",
  reference:"Fictional recommendation",offset:0,...fields});
 assert.equal(work({type:"saveDispositionPolicy",id:crypto.randomUUID(),expected:0,fundedDays:30,closedDays:30,
  reference:"Fictional policy"}).kind,"disposition");
 const old=JSON.parse(work({type:"exportRetentionAudit",policyVersion:1}).json).decisions.find(item=>item.id==="legacy-review");
 assert.equal(old.reviewOn,"2023-01-31");
 assert(!("michiganReview" in old));
 assert.match(work(decide(row())).error,/closed loan file/i);
 assert.equal(work(decide(row(),{outcome:"Continue retaining"})).kind,"disposition");
 assert.equal(row("oh").michigan,null);
 assert.equal(work(decide(row("oh"))).kind,"disposition");

 const transfer={category:"Closed loan file",role:"Lender",authority:"First mortgage",reference:"Fictional closing file",
  closedOn:"2023-11-13",transfer:{status:"Transferred",date:"2024-01-05"}};
 const preReview=f.capture();
 assert.equal(save("mi",transfer).kind,"michiganRetention");
 assert(restore.restoreBlockers(preReview,f.capture()).some(message=>/retention evidence changed/i.test(message)));
 assert.equal(row().decision,null);
 assert.match(work(decide(row())).error,/specified transferred copies/i);
 const copies={category:"Transferred copies",authority:"First mortgage",closedOn:"2023-11-13",
  transferredOn:"2024-01-05",reference:"Fictional transferred copies"};
 assert.equal(save("mi",{...copies,authority:"Secondary mortgage"}).kind,"michiganRetention");
 assert.match(work(decide(row())).error,/reconcile the license scope/i);
 const stale=decide(row());
 assert.equal(save("mi",copies,1).kind,"michiganRetention");
 assert.match(work(stale).error,/loan changed/i);
 assert.equal(row().michigan.stateReviewDate,"2027-01-05");
 assert.match(work(decide(row())).error,/through the Michigan review date/);
 const boundary="2027-01-05T16:00:00.000Z", later="2027-02-02T16:00:00.000Z";
 assert.match(work(decide(row("mi",boundary)),boundary).error,/through the Michigan review date/);
 const eligible=row("mi",later);
 assert.equal(eligible.retainMichiganThroughToday,false);
 assert.match(work(decide(eligible),later).error,/record counsel/i);
 const counsel={retainThrough:"2027-02-01",reference:"Fictional counsel reviewed state and federal retention"};
 assert.match(work(decide(eligible,{counsel:{...counsel,retainThrough:"2026-01-01"}}),later).error,/earlier than/i);
 assert.match(work(decide(eligible,{counsel:{...counsel,retainThrough:"2027-02-02"}}),later).error,/through the counsel-reviewed date/i);
 const request=decide(eligible,{counsel});
 assert.equal(work(request,later).kind,"disposition");
 assert.equal(row("mi",later).decision.id,request.id);
 assert.equal(work(request,later).kind,"disposition");
 assert.match(work({...request,counsel:{...counsel,reference:"Different counsel review"}},later).error,/different disposition review/i);
 const historical=JSON.parse(work({type:"exportRetentionAudit",policyVersion:1},later).json).decisions.find(item=>item.id===request.id);
 assert.deepEqual(historical.michiganReview.counsel,counsel);
 assert.deepEqual(historical.michiganReview.evidence.versions.map(item=>item.version),[1,2]);
 assert.match(work(decide(row("mi-withdrawn"))).error,/unsuccessful application/i);
 const withdrawn={category:"Unsuccessful application",outcome:"Denied",authority:"First mortgage",reference:"Fictional application",
  retainThrough:"2025-12-01",counselReference:"Fictional counsel application schedule"};
 assert.equal(save("mi-withdrawn",withdrawn).kind,"michiganRetention");
 assert.match(work(decide(row("mi-withdrawn"))).error,/reconcile the recorded withdrawal/i);
 assert.equal(save("mi-withdrawn",{...withdrawn,outcome:"Withdrawn"},1).kind,"michiganRetention");
 assert.equal(row("mi-withdrawn").michigan.stateReviewDate,"2025-12-01");
});

test("California DRE records retain authority, original findings and examination evidence without setting a deletion date", async t => {
 const {initializeStore}=await import("../src/lib/store.ts");
 const {loanRetentionWork}=await import("../src/lib/loan-retention.ts");
 const {auditRetentionExport,reviewRetentionExport,retentionExportResponse}=await import("../src/lib/loan-retention-export.ts");
 const {strFromU8,unzipSync}=await import("fflate");
 const {restoreBlockers}=await import("../src/lib/workspace-restore.ts");
 const {db,staff,capture}=ownerFixture(t);
 initializeStore(db,false);
 const tenant=staff.brokerage.id, now="2026-11-12T03:00:00Z", entityId=crypto.randomUUID();
 db.prepare("INSERT INTO compliance_program_entities VALUES (?,?,?,'002341','Fictional scope',?)").run(tenant,entityId,"Fictional DRE broker",now);
 db.exec("INSERT INTO contacts (id,name,email,phone,role) VALUES ('borrower','Fictional Borrower','','','Borrower')");
 const addLoan=db.prepare("INSERT INTO loans (id,contactId,officer,address,amount,purpose,stage,stageSince) VALUES (?,'borrower','LO','',1,'Purchase',?,'2026-11-11')");
 const addApp=db.prepare("INSERT INTO applications (loanId,token,expiresAt,draft,updatedAt) VALUES (?,?, '2027-01-01',?, '2026-11-12')");
 for(const [id,state,stage] of [["ca-closed","CA","Funded"],["ca-ended","CA","Processing"],["outside","MI","Processing"]]){
  addLoan.run(id,stage);
  addApp.run(id,id,JSON.stringify({propertyLocation:{state}}));
 }
 db.exec(`INSERT INTO closing_progress (loanId,fundingDate) VALUES ('ca-closed','2024-06-06');
   INSERT INTO past_client_profiles (loanId,closingDate) VALUES ('ca-closed','2024-06-03');
   UPDATE loans SET disposition='Withdrawn',dispositionDate='2024-03-04' WHERE id='ca-ended'`);
 const before=capture();
 const request=(input,actor=staff)=>loanRetentionWork(db,input,actor,tenant,now);
 const save=(loanId,facts,expected=0)=>({type:"saveCaliforniaDreRecordkeeping",loanId,facts,expected,requestId:crypto.randomUUID(),
  ...(expected?{correction:"Fictional revised archive evidence"}:{})});
 const inspection={on:"2026-11-11",reference:"Fictional office viewing and paper production"};
 const at=(on)=>({on,reference:"Fictional dated record"});
 const retained={status:"On file",reference:"Fictional signed disclosure reference"};
 const absent={status:"Not applicable",reference:"Fictional scope review"};
 const facts={entityId,authorityReference:"Fictional DRE license evidence",fileInventory:"Fictional archive inventory",
  outcome:{status:"Closed",...at("2024-06-03")},mortgageDisclosure:retained,trustRecords:absent,electronicSignatures:retained,
  privateMoney:absent,archive:{format:"Electronic",location:"Fictional archive",inspection}};
 const list=request({type:"list",heldOnly:false,search:"",offset:0});
 assert.deepEqual(Object.fromEntries(list.loans.map(row=>[row.id,row.canReviewCaliforniaDre])),{"ca-closed":true,"ca-ended":true,outside:false});
 assert.match(request(save("outside",facts)).error,/California loan/);
 assert.match(request(save("ca-closed",{...facts,entityId:crypto.randomUUID()})).error,/legal entity/);
 assert.match(request(save("ca-closed",facts),{...staff,brokerage:{...staff.brokerage,role:"Processor"}}).error,/pilot owners/);
 assert.match(request(save("ca-closed",{...facts,archive:{...facts.archive,inspection:at("2026-11-12")}})).error,/already|occurred/);
 const initial=save("ca-closed",facts);
 const initialResult=request(initial);
 assert.equal(initialResult.currentFinding.stateReviewDate,"2027-06-03");
 assert.equal(initialResult.versions[0].entity.nmls,"002341");
 assert.deepEqual(initialResult.currentFinding.findings.map(item=>item.key),["immutability","regularCourse","contemporaryRecord","custodian","indexing"]);
 assert.equal(request(initial).versions.length,1);
 const corrected=save("ca-closed",{...facts,archive:{...facts.archive,immutability:"Fictional write-once evidence",
  regularCourse:"Fictional records practice",contemporaryRecord:"Fictional preparation record",
  custodian:"Fictional custodian evidence",indexing:"Fictional retrieval index"}},1);
 const result=request(corrected);
 assert.deepEqual(result.currentFinding.findings,[]);
 assert.equal(result.versions[1].finding.findings.length,5);
 assert.match(request({...corrected,requestId:crypto.randomUUID()}).error,/changed/);
 const ended={...facts,outcome:{status:"Unconsummated",application:at("2024-02-29"),listing:at("2024-02-28")},
  privateMoney:{status:"Applicable",selfDealing:absent,investorQualifications:retained,investorSuitability:retained}};
 const gap=request(save("ca-ended",ended)).currentFinding;
 assert.equal(gap.stateReviewDate,null);
 assert.ok(gap.findings.some(item=>item.key==="start"));
 assert.ok(gap.findings.some(item=>item.key==="privateRetention"));
 const leap=request(save("ca-ended",{...ended,outcome:{status:"Unconsummated",application:at("2024-02-29")}},1)).currentFinding;
 assert.equal(leap.stateReviewDate,null);
 assert.ok(leap.findings.some(item=>item.key==="anniversary"));
 const resolved=request(save("ca-ended",{...ended,outcome:{status:"Unconsummated",application:at("2024-02-28")}},2)).currentFinding;
 assert.equal(resolved.stateReviewDate,"2027-02-28");
 assert.equal(resolved.basis.event,"Loan application");
 const audit=request({type:"exportRetentionAudit",policyVersion:null});
 assert.equal(JSON.parse(audit.json).californiaDreRecordkeeping.length,5);
 const archive=reviewRetentionExport(db,staff,tenant,"ca-closed");
 const zip=await retentionExportResponse(undefined,tenant,archive,async fingerprint=>auditRetentionExport(db,staff,tenant,"ca-closed",fingerprint));
 const manifest=JSON.parse(strFromU8(unzipSync(new Uint8Array(await zip.arrayBuffer()))["manifest.json"]));
 assert.deepEqual(manifest.californiaDreRecordkeeping.map(v=>[v.version,v.finding.findings.length]),[[2,0],[1,5]]);
 assert.ok(restoreBlockers(before,capture()).some(reason=>reason.includes("retention evidence changed")));
 db.prepare("UPDATE applications SET draft=? WHERE loanId='ca-closed'").run(JSON.stringify({propertyLocation:{state:"NV"}}));
 const moved=request({type:"californiaDreRecordkeepingHistory",loanId:"ca-closed"});
 assert.equal(moved.targetChanged,true);
 assert.equal(moved.currentFinding.stateReviewDate,null);
 assert.equal(moved.versions[0].finding.stateReviewDate,"2027-06-03");
});

test("California disposition requires current DRE evidence, private-money dates and counsel review", async t => {
 const {initializeStore}=await import("../src/lib/store.ts");
 const {loanRetentionWork}=await import("../src/lib/loan-retention.ts");
 const {db,staff}=ownerFixture(t);
 const scope=staff.brokerage.id, now="2026-11-12T06:00:00Z", entityId=crypto.randomUUID();
 initializeStore(db,false);
 db.exec("ALTER TABLE loan_retention_reviews DROP COLUMN californiaReview");
 initializeStore(db,false);
 db.prepare("INSERT INTO compliance_program_entities VALUES (?,?,?,'002341','Fictional scope',?)").run(scope,entityId,"Fictional DRE broker",now);
 db.exec(`INSERT INTO contacts (id,name,email,phone,role) VALUES ('borrower','Fictional Borrower','','','Borrower');
   INSERT INTO loans (id,contactId,officer,address,amount,purpose,stage,stageSince)
   VALUES ('ca','borrower','LO','',1,'Purchase','Funded','2022-11-04'),('report-only','borrower','LO','',1,'Purchase','Funded','2022-11-04');
   INSERT INTO closing_progress (loanId,fundingDate) VALUES ('ca','2022-11-04'),('report-only','2022-11-04');
   INSERT INTO past_client_profiles (loanId,closingDate) VALUES ('ca','2022-11-02'),('report-only','2022-11-02');`);
 const addApp=db.prepare("INSERT INTO applications (loanId,token,expiresAt,draft,updatedAt) VALUES (?,?, '2027-01-01',?, '2026-11-12')");
 for(const [id,state] of [["ca","CA"],["report-only","NV"]]) addApp.run(id,id,JSON.stringify({propertyLocation:{state}}));
 db.prepare("INSERT INTO call_report_facts VALUES ('report-only',?,1)").run(JSON.stringify({state:"CA"}));
 const work=(input,at=now)=>loanRetentionWork(db,input,staff,scope,at);
 assert.equal(work({type:"saveDispositionPolicy",id:crypto.randomUUID(),expected:0,fundedDays:30,closedDays:30,
  reference:"Fictional policy"}).kind,"disposition");
 const row=(at=now,id="ca")=>work({type:"dispositionQueue",offset:0},at).rows.find(item=>item.id===id);
 const review=(item,options={})=>({type:"saveDispositionReview",id:crypto.randomUUID(),loanId:item.id,policyVersion:1,
  basis:item.basis,previous:item.decision?.id??null,outcome:"Recommend disposition",reference:"Fictional recommendation",offset:0,...options});
 const save=(facts,expected=0,id="ca")=>work({type:"saveCaliforniaDreRecordkeeping",loanId:id,facts,expected,requestId:crypto.randomUUID(),
  ...(expected?{correction:"Fictional corrected archive evidence"}:{})});
 const missing=row();
 assert.match(work(review(missing)).error,/California license authority/);
 const continueReview=review(missing,{outcome:"Continue retaining"});
 assert.equal(work(continueReview).kind,"disposition");
 assert.equal(row().decision.id,continueReview.id);
 const absent={status:"Not applicable",reference:"Fictional scope review"};
 const present={status:"On file",reference:"Fictional retained document"};
 const facts={entityId,authorityReference:"Fictional DRE authority",fileInventory:"Fictional complete inventory",
  outcome:{status:"Closed",on:"2022-11-02",reference:"Fictional closing record"},mortgageDisclosure:present,trustRecords:absent,
  electronicSignatures:absent,archive:{format:"Paper",location:"Fictional office archive",
   inspection:{on:"2026-10-12",reference:"Fictional retrieval and print test"}},
  privateMoney:{status:"Applicable",selfDealing:absent,investorQualifications:present,investorSuitability:present,
   retentionEvidence:"Fictional four-year custody evidence"}};
 assert.equal(save(facts).versions[0].version,1);
 assert.equal(row().decision,null);
 assert.match(work(review(missing)).error,/loan changed/);
 assert.match(work(review(row())).error,/private-money retain-through/);
 assert.equal(save(facts,0,"report-only").versions[0].version,1);
 assert.match(work(review(row(now,"report-only"))).error,/property and reporting state/);
 assert.equal(save({...facts,privateMoney:{...facts.privateMoney,retainThrough:"2026-11-11"}},1).versions[0].version,2);
 assert.equal(row().retainCaliforniaThroughToday,true);
 assert.match(work(review(row())).error,/2026-11-11/);
 const tomorrow="2026-11-12T09:00:00Z";
 assert.equal(row(tomorrow).retainCaliforniaThroughToday,false);
 assert.match(work(review(row(tomorrow)),tomorrow).error,/Record counsel/);
 const counsel=retainThrough=>({retainThrough,reference:"Fictional counsel scope and retention review"});
 assert.match(work(review(row(tomorrow),{counsel:counsel("2026-11-10")}),tomorrow).error,/earlier than/);
 assert.match(work(review(row(tomorrow),{counsel:counsel("2026-11-12")}),tomorrow).error,/Retain the record/);
 const allowed=review(row(tomorrow),{counsel:counsel("2026-11-11")});
 assert.equal(work(allowed,tomorrow).kind,"disposition");
 assert.equal(work(allowed,tomorrow).kind,"disposition");
 assert.equal(row(tomorrow).decision.counsel.retainThrough,"2026-11-11");
 const audit=JSON.parse(work({type:"exportRetentionAudit",policyVersion:null},tomorrow).json);
 const saved=audit.decisions.find(item=>item.id===allowed.id).californiaReview;
 assert.equal(saved.evidence[0].detail.version,2);
 assert.equal(saved.evidence[0].detail.entity.nmls,"002341");
 assert.deepEqual(saved.counsel,counsel("2026-11-11"));
 assert.equal(db.prepare("SELECT count(*) AS n FROM loans WHERE id='ca'").get().n,1);
});

test("California DFPI evidence preserves separate CFL and CRMLA findings and examination dates", async t => {
 const {initializeStore}=await import("../src/lib/store.ts");
 const {loanRetentionWork}=await import("../src/lib/loan-retention.ts");
 const {reviewRetentionExport,auditRetentionExport,retentionExportResponse}=await import("../src/lib/loan-retention-export.ts");
 const {restoreBlockers}=await import("../src/lib/workspace-restore.ts");
 const {strFromU8,unzipSync}=await import("fflate");
 const {db,staff,capture}=ownerFixture(t);
 initializeStore(db,false);
 db.exec("ALTER TABLE loan_retention_reviews DROP COLUMN californiaReview");
 initializeStore(db,false);
 const scope=staff.brokerage.id, now="2026-11-12T06:00:00Z", entityId=crypto.randomUUID();
 db.prepare("INSERT INTO compliance_program_entities VALUES (?,?,?,'002341','Fictional scope',?)").run(scope,entityId,"Fictional DFPI company",now);
 db.exec(`INSERT INTO contacts (id,name,email,phone,role) VALUES ('borrower','Fictional Borrower','','','Borrower');
   INSERT INTO loans (id,contactId,officer,address,amount,purpose,stage,stageSince)
   VALUES ('ca','borrower','LO','',1,'Purchase','Processing','2026-11-04'),
     ('outside','borrower','LO','',1,'Purchase','Processing','2026-11-04');
   UPDATE loans SET disposition='Withdrawn',dispositionDate='2023-11-08' WHERE id='ca';`);
 const addApp=db.prepare("INSERT INTO applications (loanId,token,expiresAt,draft,updatedAt) VALUES (?,?, '2027-01-01',?, '2026-11-12')");
 for(const [id,state] of [["ca","CA"],["outside","MI"]]) addApp.run(id,id,JSON.stringify({propertyLocation:{state}}));
 const before=capture();
 const work=(input,at=now,actor=staff)=>loanRetentionWork(db,input,actor,scope,at);
 const save=(facts,expected=0,loanId="ca")=>({type:"saveCaliforniaDfpi",loanId,facts,expected,requestId:crypto.randomUUID(),
   ...(expected?{correction:"Fictional revised DFPI evidence"}:{})});
 const evidence=on=>({on,reference:"Fictional documented event"});
 const unreviewed={status:"Unreviewed"};
 const retained={status:"On file",reference:"Fictional archived file"};
 const cfl={entityId,authority:"CFL",role:"Broker",authorityReference:"Fictional CFL license",
   finalEntry:evidence("2023-11-08"),inventory:"Fictional inventory",
   custody:{method:"Digital access from licensed office",office:"Fictional licensed office",retrieval:evidence("2026-10-28")},
   disclosure:retained,securityInstrument:retained,note:retained,application:retained,paymentRecord:retained,escrow:unreviewed,insurance:retained};
 assert.match(work(save(cfl,0,"outside")).error,/California loan/);
 assert.match(work(save(cfl),now,{...staff,brokerage:{...staff.brokerage,role:"Processor"}}).error,/pilot owners/);
 assert.match(work(save({...cfl,entityId:crypto.randomUUID()})).error,/legal entity/);
 const original=save(cfl);
 const initial=work(original);
 assert.equal(initial.currentFinding.stateReviewDate,"2026-11-08");
 assert.deepEqual(initial.currentFinding.findings.map(item=>item.key),["escrow"]);
 assert.equal(work(original).versions.length,1);
 const crmla={entityId,authority:"CRMLA",role:"Lender and servicer",authorityReference:"Fictional CRMLA license",
  finalEntry:evidence("2023-11-08"),inventory:"Fictional inventory",loanLog:"Fictional 36-month log reference",
  application:retained,commitment:retained,truthInLending:retained,closingStatement:retained,noteAndDeed:retained,
  adverseAction:{status:"Not applicable",reference:"Fictional closed loan history"},appraisal:retained,creditReport:retained,
  balance:{status:"Balance remains",reference:"Fictional current servicing ledger"},
  production:{notice:evidence("2026-11-01")}};
 assert.match(work(save({...crmla,production:{...crmla.production,produced:evidence("2026-10-31")}})).error,/cannot precede/);
 assert.match(work(save({...crmla,production:{...crmla.production,produced:evidence("2026-11-12")}})).error,/occurred/);
 const second=save(crmla);
 const pending=work(second);
 assert.equal(pending.currentFinding.productionDue,"2026-11-11");
 assert.equal(pending.currentFinding.productionStatus,"Awaiting production");
 assert.deepEqual(pending.currentFinding.findings.map(item=>item.key),["activeBalance"]);
 const history={type:"californiaDfpiHistory",loanId:"ca",authority:"CRMLA"};
 const overdue=work(history,"2026-11-12T09:00:00Z");
 assert.equal(overdue.currentFinding.productionStatus,"Overdue");
 assert.equal(overdue.versions[0].finding.productionStatus,"Awaiting production");
 assert.match(work({...second,requestId:crypto.randomUUID()}).error,/changed/);
 const completed=work(save({...crmla,production:{...crmla.production,produced:evidence("2026-11-11")}},1));
 assert.equal(completed.currentFinding.productionStatus,"Produced on time");
 assert.deepEqual(completed.versions.map(item=>item.facts.authority),["CRMLA","CRMLA"]);
 assert.equal(work({...history,authority:"CFL"}).versions[0].facts.authority,"CFL");
 assert.equal(work({type:"saveDispositionPolicy",id:crypto.randomUUID(),expected:0,fundedDays:30,closedDays:30,
  reference:"Fictional policy"}).kind,"disposition");
 const queue=()=>work({type:"dispositionQueue",offset:0}).rows.find(item=>item.id==="ca");
 const recommend=row=>({type:"saveDispositionReview",id:crypto.randomUUID(),loanId:row.id,policyVersion:1,
  basis:row.basis,previous:row.decision?.id??null,outcome:"Recommend disposition",reference:"Fictional recommendation",offset:0,
  counsel:{retainThrough:"2026-11-08",reference:"Fictional counsel confirmed license scope and dates"}});
 assert.deepEqual(queue().california.map(item=>item.authority),["CFL","CRMLA"]);
 assert.match(work(recommend(queue())).error,/Escrow closing evidence/);
 assert.equal(work(save({...cfl,escrow:retained},1)).versions[0].version,2);
 assert.match(work(recommend(queue())).error,/outstanding-balance/);
 assert.equal(work(save({...crmla,balance:{status:"No balance",reference:"Fictional payoff evidence"}},2)).versions[0].version,3);
 const awaiting=queue();
 assert.match(work(recommend(awaiting)).error,/open CRMLA notice/);
 assert.equal(work(save({...crmla,balance:{status:"No balance",reference:"Fictional payoff evidence"},
  production:{...crmla.production,produced:evidence("2026-11-11")}},3)).versions[0].version,4);
 assert.match(work(recommend(awaiting)).error,/loan changed/);
 const accepted=recommend(queue());
 assert.equal(work(accepted).kind,"disposition");
 assert.equal(work(accepted).kind,"disposition");
 const json=JSON.parse(work({type:"exportRetentionAudit",policyVersion:null}).json);
 assert.equal(json.californiaDfpi.length,6);
 const decision=json.decisions.find(item=>item.id===accepted.id).californiaReview;
 assert.deepEqual(decision.evidence.map(item=>[item.authority,item.detail.version]),[["CFL",2],["CRMLA",4]]);
 assert.equal(decision.counsel.retainThrough,"2026-11-08");
 const reviewed=reviewRetentionExport(db,staff,scope,"ca");
 const archive=await retentionExportResponse(undefined,scope,reviewed,async fingerprint=>auditRetentionExport(db,staff,scope,"ca",fingerprint));
 const manifest=JSON.parse(strFromU8(unzipSync(new Uint8Array(await archive.arrayBuffer()))["manifest.json"]));
 assert.equal(manifest.californiaDfpi[0].entity.nmls,"002341");
 assert.equal(manifest.californiaDfpi.at(-1).finding.stateReviewDate,"2026-11-08");
 assert.ok(restoreBlockers(before,capture()).some(reason=>reason.includes("retention evidence changed")));
});

test("CRMLA register exports the 36-month population and preserves corrections", async t => {
 const {initializeStore}=await import("../src/lib/store.ts");
 const {loanRetentionWork}=await import("../src/lib/loan-retention.ts");
 const {crmlaRegisterFrom}=await import("../src/lib/crmla-register-model.ts");
 const {restoreBlockers}=await import("../src/lib/workspace-restore.ts");
 const {strFromU8,unzipSync}=await import("fflate");
 const {db,staff,capture}=ownerFixture(t);
 initializeStore(db,false);
 const tenant=staff.brokerage.id, entityId=crypto.randomUUID(), secondId=crypto.randomUUID(), now="2026-11-13T06:00:00Z";
 const add=db.prepare("INSERT INTO compliance_program_entities VALUES (?,?,?,'001234','Fictional scope',?)");
 add.run(tenant,entityId,"Fictional CRMLA lender",now);
 add.run(tenant,secondId,"Fictional second entity",now);
 const before=capture();
 const work=(input,entity=entityId,actor=staff)=>loanRetentionWork(db,{type:"crmlaRegister",entityId:entity,input},actor,tenant,now);
 const facts={fileNumber:"000012",applicationOn:"2023-11-12",applicationReference:"Fictional dated receipt",
  applicants:["=1+1 Fictional Borrower"],outcome:{status:"Closed",on:"2023-12-15",reference:"Fictional closing file"},
  propertyAddress:"14 Example Street",amountCents:12345678,terms:"30 years fixed",program:"Fictional fixed program",officer:"Fictional loan officer"};
 const save=(facts,other={})=>({operation:"save",entryId:crypto.randomUUID(),requestId:crypto.randomUUID(),expected:0,facts,...other});
 const first=save(facts);
 assert.deepEqual(work(first).versions[0].review.gaps,["Disposition of the loan","Disposition of servicing"]);
 assert.equal(work(first).versions.length,1);
 assert.match(work(first,secondId).error,/changed/);
 assert.match(work(first,entityId,{...staff,brokerage:{...staff.brokerage,role:"Processor"}}).error,/pilot owners/);
 assert.match(work(save({...facts,fileNumber:" 000012 "})).error,/already uses/);
 assert.match(work(save({...facts,outcome:{...facts.outcome,on:"2026-11-13"}})).error,/already occurred/);
 assert.equal(crmlaRegisterFrom("2024-02-29"),"2021-02-28");
 const correction=save({...facts,outcome:{...facts.outcome,disposition:"Sold to fictional investor",servicing:"Retained"}},
  {entryId:first.entryId,expected:1,correction:"Fictional loan and servicing confirmation"});
 assert.deepEqual(work(correction).versions.map(item=>item.review.gaps.length),[0,2]);
 assert.match(work({...correction,requestId:crypto.randomUUID()}).error,/changed/);
 assert.equal(work(save({...facts,fileNumber:"older",applicationOn:"2023-11-11"})).versions.length,1);
 assert.equal(work(save({...facts,fileNumber:"pending",applicationOn:"2026-11-12",outcome:{status:"Pending"},
  amountCents:undefined})).versions[0].review.gaps[0],"Loan amount");
 const remove=save({...facts,fileNumber:"void-me"});
 assert.equal(work(remove).versions.length,1);
 assert.equal(work({operation:"void",entryId:remove.entryId,requestId:crypto.randomUUID(),expected:1,correction:"Fictional duplicate"}).versions[0].voided,true);
 const result=work({operation:"export",through:"2026-11-12"});
 assert.equal(result.from,"2023-11-12");
 assert.equal(result.entries,2);
 assert.equal(result.gaps,1);
 const book=unzipSync(Buffer.from(result.xlsx,"base64"));
 const sheet=number=>strFromU8(book[`xl/worksheets/sheet${number}.xml`]);
 assert.match(sheet(1),/t="inlineStr"[^>]*><is><t xml:space="preserve">=1\+1 Fictional Borrower/);
 assert.match(sheet(1),/<v>123456.78<\/v>/);
 assert.match(sheet(1),/Sold to fictional investor/);
 assert.doesNotMatch(sheet(1),/older|void-me/);
 assert.match(sheet(2),/Voided/);
 assert.match(sheet(2),/Disposition of servicing/);
 assert.match(sheet(3),/Fictional CRMLA lender/);
 assert.ok(restoreBlockers(before,capture()).some(reason=>reason.includes("retention evidence changed")));
});

test("Colorado records preserve Board deadlines, granted extensions and prior production findings", async t => {
 const {initializeStore}=await import("../src/lib/store.ts");
 const {loanRetentionWork}=await import("../src/lib/loan-retention.ts");
 const {reviewRetentionExport,auditRetentionExport,retentionExportResponse}=await import("../src/lib/loan-retention-export.ts");
 const {restoreBlockers}=await import("../src/lib/workspace-restore.ts");
 const {strFromU8,unzipSync}=await import("fflate");
 const {db,staff,capture}=ownerFixture(t);
 initializeStore(db,false);
 const scope=staff.brokerage.id, now="2026-11-13T06:00:00Z", entityId=crypto.randomUUID();
 db.prepare("INSERT INTO compliance_program_entities VALUES (?,?,?,'002341','Fictional scope',?)").run(scope,entityId,"Fictional Colorado mortgage company",now);
 db.exec(`INSERT INTO contacts (id,name,email,phone,role) VALUES ('borrower','Fictional Borrower','','','Borrower');
   INSERT INTO loans (id,contactId,officer,address,amount,purpose,stage,stageSince)
   VALUES ('co','borrower','LO','',1,'Purchase','Processing','2026-11-04'),
     ('outside','borrower','LO','',1,'Purchase','Processing','2026-11-04');`);
 const addApp=db.prepare("INSERT INTO applications (loanId,token,expiresAt,draft,updatedAt) VALUES (?,?, '2027-01-01',?, '2026-11-12')");
 for(const [id,state] of [["co","CO"],["outside","MI"]]) addApp.run(id,id,JSON.stringify({propertyLocation:{state}}));
 db.exec("ALTER TABLE loan_retention_reviews DROP COLUMN coloradoReview");
 initializeStore(db,false);
 db.exec("UPDATE loans SET disposition='Withdrawn',dispositionDate='2024-03-04' WHERE id='co'");
 const before=capture();
 const work=(input,at=now,actor=staff)=>loanRetentionWork(db,input,actor,scope,at);
 const save=(facts,expected=0,loanId="co")=>({type:"saveColoradoRecordkeeping",loanId,facts,expected,requestId:crypto.randomUUID(),
   ...(expected?{correction:"Fictional Board response update"}:{})});
 const event=(on,reference="Fictional source")=>({on,reference});
 const facts={entityId,scopeReference:"Fictional Colorado registration",inventory:"Fictional inventory",
  documents:{application:{status:"On file",reference:"Fictional retained 1003"}},
  archive:{medium:"Electronic",location:"Fictional records vault",securityReference:"Fictional access-control check"},
  retentionBasis:event("2024-02-29","Fictional retention review"),
  investigation:{notice:event("2026-11-02"),dueOn:"2026-11-12",extension:{requested:event("2026-11-10")}}};
 assert.match(work(save(facts,0,"outside")).error,/Colorado loan/);
 assert.match(work(save(facts),now,{...staff,brokerage:{...staff.brokerage,role:"Processor"}}).error,/pilot owners/);
 assert.match(work(save({...facts,entityId:crypto.randomUUID()})).error,/legal entity/);
 assert.match(work(save({...facts,archive:{...facts.archive,retrieval:event("2026-11-13")}})).error,/occurred/);
 const policy={type:"saveDispositionPolicy",id:crypto.randomUUID(),expected:0,fundedDays:30,closedDays:30,reference:"Fictional policy"};
 assert.equal(work(policy).kind,"disposition");
 const row=(at=now)=>work({type:"dispositionQueue",offset:0},at).rows.find(item=>item.id==="co");
 const decide=(item,options={})=>({type:"saveDispositionReview",id:crypto.randomUUID(),loanId:item.id,policyVersion:1,
  basis:item.basis,previous:item.decision?.id??null,outcome:"Recommend disposition",reference:"Fictional recommendation",offset:0,...options});
 assert.match(work(decide(row())).error,/Colorado borrower-file evidence/);
 const initial=save(facts);
 const first=work(initial);
 assert.equal(first.currentFinding.stateReviewDate,"2028-02-29");
 assert.equal(first.currentFinding.responseStatus,"Awaiting response");
 assert.equal(first.currentFinding.dueOn,"2026-11-12");
 assert.equal(work(initial).versions.length,1);
 assert.match(work(decide(row())).error,/open Colorado Board notice/);
 const read={type:"coloradoRecordkeepingHistory",loanId:"co"};
 assert.equal(work(read,"2026-11-13T08:00:00Z").currentFinding.responseStatus,"Overdue");
 const investigation={...facts.investigation,extension:{...facts.investigation.extension,approval:{...event("2026-11-11"),dueOn:"2026-11-16"}},
  response:event("2026-11-12","Fictional delivery receipt")};
 const corrected=save({...facts,investigation},1);
 const next=work(corrected);
 assert.equal(next.currentFinding.dueOn,"2026-11-16");
 assert.equal(next.currentFinding.responseStatus,"Responded on time");
 assert.ok(next.currentFinding.findings.some(item=>item.key==="responseContents"));
 assert.equal(next.versions[1].finding.dueOn,"2026-11-12");
 assert.match(work({...corrected,requestId:crypto.randomUUID()}).error,/changed/);
 const audit=JSON.parse(work({type:"exportRetentionAudit",policyVersion:null}).json);
 assert.equal(audit.coloradoRecordkeeping.length,2);
 const reviewed=reviewRetentionExport(db,staff,scope,"co");
 const archive=await retentionExportResponse(undefined,scope,reviewed,async fingerprint=>auditRetentionExport(db,staff,scope,"co",fingerprint));
 const manifest=JSON.parse(strFromU8(unzipSync(new Uint8Array(await archive.arrayBuffer()))["manifest.json"]));
 assert.equal(manifest.coloradoRecordkeeping[0].entity.nmls,"002341");
 assert.equal(manifest.coloradoRecordkeeping[1].finding.dueOn,"2026-11-12");
 const {coloradoDocuments}=await import("../src/lib/colorado-recordkeeping-model.ts");
 const complete={...facts,documents:Object.fromEntries(Object.keys(coloradoDocuments).map(key=>[key,{status:"On file",reference:"Fictional file evidence"}])),
  retentionBasis:event("2022-11-12"),archive:{...facts.archive,retrieval:event("2026-11-10")},
  investigation:{...investigation,dueOn:"2026-11-12",extension:undefined,
   response:{...event("2026-11-12"),allegations:"Fictional complete answer",questions:"Fictional notice response",documents:"Fictional production inventory"}}};
 assert.equal(work(save(complete,2)).versions[0].version,3);
 assert.match(work(decide(row())).error,/same-day response/);
 const confirmed={...complete,investigation:{...complete.investigation,dueAt:"2026-11-12T17:00:00-07:00",
  response:{...complete.investigation.response,at:"2026-11-12T23:59:00Z"}}};
 const old=row();
 assert.equal(work(save(confirmed,3)).versions[0].version,4);
 assert.match(work(decide(old)).error,/changed/);
 assert.equal(row().retainColoradoThroughToday,true);
 assert.match(work(decide(row())).error,/Colorado review date of 2026-11-12/);
 const tomorrow="2026-11-13T08:00:00Z";
 assert.match(work(decide(row(tomorrow)),tomorrow).error,/Record counsel/);
 const counsel={retainThrough:"2026-11-12",reference:"Fictional counsel retention and investigation review"};
 const review=decide(row(tomorrow),{counsel});
 assert.equal(work(review,tomorrow).kind,"disposition");
 assert.equal(work(review,tomorrow).kind,"disposition");
 const auditDecision=JSON.parse(work({type:"exportRetentionAudit",policyVersion:1},tomorrow).json).decisions[0];
 assert.equal(auditDecision.coloradoReview.evidence.version,4);
 assert.equal(auditDecision.coloradoReview.evidence.responseStatus,"Responded on time");
 assert.deepEqual(auditDecision.coloradoReview.counsel,counsel);
 assert.equal(db.prepare("SELECT count(*) AS n FROM loans WHERE id='co'").get().n,1);
 assert.ok(restoreBlockers(before,capture()).some(reason=>reason.includes("retention evidence changed")));
});

test("Colorado Board timing compares offsets and flags unproven same-day submissions", async () => {
 const {coloradoRecordkeepingFacts,reviewColoradoRecordkeeping}=await import("../src/lib/colorado-recordkeeping-model.ts");
 const event=(on,at)=>({on,reference:"Fictional receipt",...(at?{at}:{})});
 const base={entityId:crypto.randomUUID(),scopeReference:"Fictional Colorado scope",documents:{}};
 const notice={notice:event("2026-10-10"),dueOn:"2026-10-20",dueAt:"2026-10-20T17:00:00-06:00"};
 const now="2026-10-20T23:30:00Z";
 const assess=investigation=>reviewColoradoRecordkeeping(coloradoRecordkeepingFacts.parse({...base,investigation}),now);
 assert.equal(assess(notice).responseStatus,"Overdue");
 assert.equal(assess({...notice,response:event("2026-10-20")}).responseStatus,"Verify cutoff");
 assert.equal(assess({...notice,response:event("2026-10-20","2026-10-20T23:00:00Z")}).responseStatus,"Responded on time");
 assert.equal(assess({...notice,response:event("2026-10-20","2026-10-20T17:01:00-06:00")}).responseStatus,"Responded late");
 assert.equal(assess({...notice,dueAt:undefined,response:event("2026-10-20")}).responseStatus,"Verify cutoff");
 assert.equal(assess({...notice,response:event("2026-10-19")}).responseStatus,"Responded on time");
 assert.equal(assess({...notice,extension:{requested:event("2026-10-20","2026-10-20T17:00:00-06:00")}}).findings.some(item=>item.key==="extension"),true);
 const extended={...notice,extension:{requested:event("2026-10-20","2026-10-20T16:00:00-06:00"),
   approval:{...event("2026-10-20"),dueOn:"2026-10-22",dueAt:"2026-10-22T15:00:00-06:00"}}};
 assert.equal(assess(extended).dueAt,"2026-10-22T15:00:00-06:00");
 assert.equal(assess(extended).responseStatus,"Awaiting response");
 assert.equal(assess(extended).findings.some(item=>item.key==="extensionTime"),false);
 assert.equal(coloradoRecordkeepingFacts.safeParse({...base,investigation:{...notice,dueAt:"2026-10-20T01:00:00Z"}}).success,false);
 assert.equal(coloradoRecordkeepingFacts.safeParse({...base,investigation:{...notice,dueAt:"2026-10-20T17:00:00"}}).success,false);
});

test("Florida journal preserves earlier entry evidence, outcomes and an entity-scoped workbook", async t => {
 const {initializeStore}=await import("../src/lib/store.ts");
 const {loanRetentionWork}=await import("../src/lib/loan-retention.ts");
 const {restoreBlockers}=await import("../src/lib/workspace-restore.ts");
 const {strFromU8,unzipSync}=await import("fflate");
 const {db,staff,capture}=ownerFixture(t);
 initializeStore(db,false);
 const tenant=staff.brokerage.id, entityId=crypto.randomUUID(), otherId=crypto.randomUUID(), now="2026-11-12T16:00:00Z";
 const addEntity=db.prepare("INSERT INTO compliance_program_entities VALUES (?,?,?,'000123','Fictional Florida scope',?)");
 addEntity.run(tenant,entityId,"Fictional Florida broker",now);
 addEntity.run(tenant,otherId,"Fictional separate entity",now);
 const before=capture();
 const request=(input,entity=entityId,actor=staff)=>loanRetentionWork(db,{type:"floridaJournal",entityId:entity,input},actor,tenant,now);
 const facts={authority:"Mortgage broker",zone:"America/New_York",office:"Fictional branch",officeReference:"Fictional office ledger",
  applicants:["=1+1 Fictional Applicant"],applicationOn:"2026-10-26",enteredOn:"2026-10-27",
  disposition:"Denied",dispositionReference:"Fictional denial record",lender:{status:"Not applicable",reference:"Fictional no lender evidence"},
  calendar:{dueOn:"2026-11-05",reference:"Fictional approved branch calendar"}};
 const make=(facts,options={})=>({operation:"save",entryId:crypto.randomUUID(),requestId:crypto.randomUUID(),expected:0,facts,...options});
 const initial=make(facts);
 assert.equal(request(initial).versions[0].review.status,"Late");
 assert.equal(request(initial).versions.length,1);
 assert.match(request(initial,otherId).error,/changed/);
 assert.match(request(initial,entityId,{...staff,brokerage:{...staff.brokerage,role:"Processor"}}).error,/pilot owners/);
 const correction=make({...facts,disposition:"Withdrawn",dispositionReference:"Fictional withdrawal record",
  initiation:{on:"2026-11-05",reference:"Fictional legacy journal entry"}},{entryId:initial.entryId,expected:1,correction:"Fictional legacy entry located"});
 const history=request(correction);
 assert.deepEqual(history.versions.map(item=>[item.facts.disposition,item.review.status]),[["Withdrawn","On time"],["Denied","Late"]]);
 assert.equal(history.versions[0].review.retainThrough,"2029-11-05");
 assert.match(request({...correction,requestId:crypto.randomUUID()}).error,/changed/);
 assert.match(request(make({...facts,initiation:{on:"2026-11-13",reference:"Future journal date"}})).error,/cannot follow/);
 const second=make({...facts,transactionNumber:"00031",disposition:"Pending"});
 assert.equal(request(second).versions[0].version,1);
 assert.match(request(make({...facts,transactionNumber:" 00031 "})).error,/already uses/);
 const voided=request({operation:"void",entryId:second.entryId,expected:1,requestId:crypto.randomUUID(),correction:"Fictional duplicate"});
 assert.equal(voided.versions[0].voided,true);
 const result=request({operation:"export",from:"2026-10-01",through:"2026-11-12"});
 assert.equal(result.entries,1);
 const book=unzipSync(Buffer.from(result.xlsx,"base64"));
 assert.match(strFromU8(book["xl/worksheets/sheet1.xml"]),/t="inlineStr"[^>]*><is><t xml:space="preserve">=1\+1 Fictional Applicant/);
 assert.match(strFromU8(book["xl/worksheets/sheet2.xml"]),/Fictional legacy entry located/);
 assert.match(strFromU8(book["xl/worksheets/sheet2.xml"]),/Voided/);
 assert.ok(restoreBlockers(before,capture()).some(reason=>reason.includes("retention evidence changed")));
});

test("Florida retention tracks original entries, custody and OFR production across evidence versions", async t => {
 const {initializeStore}=await import("../src/lib/store.ts");
 const {loanRetentionWork}=await import("../src/lib/loan-retention.ts");
 const {reviewRetentionExport,auditRetentionExport,retentionExportResponse}=await import("../src/lib/loan-retention-export.ts");
 const {restoreBlockers}=await import("../src/lib/workspace-restore.ts");
 const {strFromU8,unzipSync}=await import("fflate");
 const {db,staff,capture}=ownerFixture(t);
 initializeStore(db,false);
 db.exec("ALTER TABLE loan_retention_reviews DROP COLUMN floridaReview");
 initializeStore(db,false);
 const scope=staff.brokerage.id, now="2026-11-13T05:30:00Z", entityId=crypto.randomUUID();
 db.prepare("INSERT INTO compliance_program_entities VALUES (?,?,?,'005678','Fictional scope',?)")
   .run(scope,entityId,"Fictional Florida brokerage",now);
 db.exec(`INSERT INTO contacts (id,name,email,phone,role) VALUES ('borrower','Fictional Borrower','','','Borrower');
   INSERT INTO loans (id,contactId,officer,address,amount,purpose,stage,stageSince)
   VALUES ('fl','borrower','LO','',1,'Purchase','Closed','2026-11-01'),
     ('pending','borrower','LO','',1,'Purchase','Processing','2026-11-01'),
     ('outside','borrower','LO','',1,'Purchase','Processing','2026-11-01');`);
 const addApp=db.prepare("INSERT INTO applications (loanId,token,expiresAt,draft,updatedAt) VALUES (?,?, '2027-01-01',?, '2026-11-12')");
 for(const [id,state] of [["fl","FL"],["pending","FL"],["outside","MI"]])
   addApp.run(id,id,JSON.stringify({propertyLocation:{state}}));
 db.prepare("INSERT INTO closing_progress (loanId,fundingDate) VALUES ('fl','2024-11-12')").run();
 const before=capture();
 const work=(command,actor=staff,at=now)=>loanRetentionWork(db,command,actor,scope,at);
 const policy={type:"saveDispositionPolicy",id:crypto.randomUUID(),expected:0,fundedDays:30,closedDays:30,reference:"Fictional Florida policy"};
 assert.equal(work(policy).kind,"disposition");
 const candidate=(at=now)=>work({type:"dispositionQueue",offset:0},staff,at).rows.find(row=>row.id==="fl");
 const recommend=(row,options={})=>({type:"saveDispositionReview",id:crypto.randomUUID(),loanId:"fl",policyVersion:1,
  basis:row.basis,previous:row.decision?.id??null,outcome:"Recommend disposition",reference:"Fictional Florida decision",offset:0,...options});
 const missing=candidate();
 assert.match(work(recommend(missing)).error,/Florida borrower-file evidence/);
 assert.equal(work(recommend(missing,{outcome:"Continue retaining"})).rows[0].decision.outcome,"Continue retaining");
 const event=(on)=>({on,reference:"Fictional dated evidence"});
 const onFile=(on)=>({status:"On file",latestOriginalEntry:event(on)});
 const exempt={status:"Not applicable",reference:"Fictional inventory basis"};
 const facts={entityId,authority:"Mortgage broker",authorityReference:"Fictional licensing record",
  zone:"America/Chicago",inventory:"Fictional inventory",
  records:{loanFile:onFile("2026-11-01"),accounts:onFile("2026-11-02"),expenseReceipts:onFile("2024-02-29"),
    closingStatements:exempt,other:exempt},
  custody:{method:"OFR-authorized location",location:"Fictional archive",authorization:"Fictional OFR authorization",
    secureStorage:"Fictional stationary secured storage review",
    locationChange:{status:"Location change",effectiveOn:"2026-10-01",filing:event("2026-09-01")}},
  examination:{notice:event("2026-11-06"),floridaLocation:"Fictional Florida production site",
    clock:{request:"Written OFR request",deadline:event("2026-11-12")}}};
 const save=(facts,expected=0,loanId="fl")=>({type:"saveFloridaRecordkeeping",loanId,facts,expected,requestId:crypto.randomUUID(),
   ...(expected?{correction:"Fictional inventory and production update"}:{})});
 assert.match(work(save(facts,0,"outside")).error,/Florida loan/);
 assert.match(work(save(facts),{...staff,brokerage:{...staff.brokerage,role:"Processor"}}).error,/pilot owners/);
 assert.match(work(save({...facts,custody:{...facts.custody,retrieval:event("2026-11-13")}})).error,/occurred/);
 assert.equal(work(save({...facts,records:{...facts.records,expenseReceipts:exempt}},0,"pending")).currentFinding.stateReviewDate,"2029-11-02");

 const original=save(facts);
 const first=work(original);
 assert.equal(first.currentFinding.stateReviewDate,null);
 assert.deepEqual(first.currentFinding.findings.map(finding=>finding.key),["retrieval","examination","expenseReceipts","closingStatements"]);
 assert.equal(first.currentFinding.amendmentDueOn,"2026-09-01");
 assert.equal(first.currentFinding.productionDueOn,"2026-11-12");
 const history={type:"floridaRecordkeepingHistory",loanId:"fl"};
 assert.ok(work(history,staff,"2026-11-13T06:30:00Z").currentFinding.findings.some(item=>item.key==="overdueProduction"));
 assert.equal(work(original).versions.length,1);
 assert.match(work(recommend(missing)).error,/changed/);
 assert.match(work(recommend(candidate())).error,/retrieval/);
 const updated={...facts,records:{...facts.records,closingStatements:onFile("2026-11-03"),expenseReceipts:onFile("2026-11-04")},
  custody:{...facts.custody,retrieval:event("2026-11-05")},
  examination:{...facts.examination,production:event("2026-11-07")}};
 const correction=save(updated,1);
 assert.match(work({...correction,correction:undefined}).error,/reason/);
 const latest=work(correction);
 assert.equal(latest.currentFinding.stateReviewDate,"2029-11-04");
 assert.deepEqual(latest.currentFinding.findings,[]);
 assert.equal(latest.versions[1].finding.stateReviewDate,null);
 assert.match(work({...correction,requestId:crypto.randomUUID()}).error,/changed/);

 assert.match(work(recommend(candidate())).error,/Retain the record through the Florida review date of 2029-11-04/);
 const cutoff="2029-11-05T05:30:00Z";
 assert.equal(candidate(cutoff).retainFloridaThroughToday,true);
 const afterCutoff="2029-11-05T06:30:00Z";
 const due=candidate(afterCutoff);
 assert.equal(due.retainFloridaThroughToday,false);
 assert.match(work(recommend(due),staff,afterCutoff).error,/counsel/);
 const counsel={retainThrough:"2029-11-04",reference:"Fictional counsel retention assessment"};
 assert.match(work(recommend(due,{counsel:{...counsel,retainThrough:"2029-11-03"}}),staff,afterCutoff).error,/earlier/);
 assert.match(work(recommend(due,{counsel:{...counsel,retainThrough:"2029-11-05"}}),staff,afterCutoff).error,/counsel-reviewed date/);
 const decision=recommend(due,{counsel});
 assert.equal(work(decision,staff,afterCutoff).rows[0].decision.id,decision.id);
 assert.equal(work(decision,staff,afterCutoff).rows[0].decision.id,decision.id);
 const audit=JSON.parse(work({type:"exportRetentionAudit",policyVersion:null}).json);
 assert.equal(audit.floridaRecordkeeping.length,3);
 const decisionProof=audit.decisions.find(row=>row.id===decision.id).floridaReview;
 assert.equal(decisionProof.evidence.version,2);
 assert.equal(decisionProof.evidence.facts.examination.production.on,"2026-11-07");
 assert.deepEqual(decisionProof.counsel,counsel);
 assert.equal(audit.decisions.find(row=>row.outcome==="Continue retaining").floridaReview.evidence.version,null);
 const reviewed=reviewRetentionExport(db,staff,scope,"fl");
 const archive=await retentionExportResponse(undefined,scope,reviewed,async fingerprint=>auditRetentionExport(db,staff,scope,"fl",fingerprint));
 const manifest=JSON.parse(strFromU8(unzipSync(new Uint8Array(await archive.arrayBuffer()))["manifest.json"]));
 assert.equal(manifest.floridaRecordkeeping[0].entity.nmls,"005678");
 assert.equal(manifest.floridaRecordkeeping[0].finding.stateReviewDate,"2029-11-04");
 assert.equal(manifest.floridaRecordkeeping[1].finding.stateReviewDate,null);
 assert.ok(restoreBlockers(before,capture()).some(reason=>reason.includes("retention evidence changed")));
});

test("Florida alternate storage checks the advance filing date and the documented production deadline", async () => {
 const {floridaRecordkeepingFacts,reviewFloridaRecordkeeping}=await import("../src/lib/florida-recordkeeping-model.ts");
 const event=(on)=>({on,reference:"Fictional evidence"});
 const item={status:"On file",latestOriginalEntry:event("2022-09-14")};
 const facts={entityId:crypto.randomUUID(),authority:"Mortgage broker",authorityReference:"Fictional registration",
  zone:"America/Chicago",inventory:"Fictional inventory",
  records:{loanFile:item,accounts:item,expenseReceipts:item,closingStatements:item,other:item},
  custody:{method:"OFR-authorized location",location:"Fictional Pensacola archive",authorization:"Fictional alternate storage notice",
    secureStorage:"Fictional permanent secured premises",retrieval:event("2026-10-01"),
    locationChange:{status:"Location change",effectiveOn:"2026-11-16",filing:event("2026-10-18")}},
  examination:{notice:event("2026-11-06"),floridaLocation:"Fictional OFR site",
    clock:{request:"Written OFR request",deadline:event("2026-11-12")},production:event("2026-11-13")}};
 const assess=(facts,asOf="2026-11-13")=>reviewFloridaRecordkeeping(floridaRecordkeepingFacts.parse(facts),{closed:true},asOf);
 const late=assess(facts);
 assert.equal(late.amendmentDueOn,"2026-10-17");
 assert.equal(late.productionDueOn,"2026-11-12");
 assert.deepEqual(late.findings.map(item=>item.key),["lateAmendment","lateProduction"]);
 const complete={...facts,custody:{...facts.custody,locationChange:{...facts.custody.locationChange,filing:event("2026-10-17")}},
  examination:{...facts.examination,production:event("2026-11-12")}};
 assert.deepEqual(assess(complete).findings,[]);
 const legacy={...complete,custody:{...complete.custody,secureStorage:undefined,locationChange:undefined},
  examination:{...complete.examination,clock:undefined}};
 assert.deepEqual(assess(legacy).findings.map(item=>item.key),["secureStorage","locationChange","requestType"]);
 assert.deepEqual(assess({...legacy,custody:{method:"Licensed principal place",location:legacy.custody.location,retrieval:legacy.custody.retrieval}}).findings,[]);
 const missingFiling={...complete,custody:{...complete.custody,locationChange:{...complete.custody.locationChange,filing:undefined}}};
 assert.match(assess(missingFiling).findings[0].message,/has passed/);
 assert.doesNotMatch(assess(missingFiling,"2026-10-17").findings[0].message,/has passed/);
 const missingDeadline={...complete,examination:{...complete.examination,clock:{request:"Written OFR request"}}};
 assert.deepEqual(assess(missingDeadline).findings.map(item=>item.key),["productionCalendar"]);
 assert.deepEqual(assess({...missingDeadline,examination:{...missingDeadline.examination,clock:{request:"Other request",reference:"Fictional telephone request"}}}).findings,[]);
 assert.equal(floridaRecordkeepingFacts.safeParse({...complete,examination:{...complete.examination,
  clock:{request:"Written OFR request",deadline:event("2026-11-08")}}}).success,false);
});

test("Texas examination logs preserve timing, owner scope, correction history and sortable exports", async t => {
 const {initializeStore}=await import("../src/lib/store.ts");
 const {loanRetentionWork}=await import("../src/lib/loan-retention.ts");
 const {restoreBlockers}=await import("../src/lib/workspace-restore.ts");
 const {strFromU8,unzipSync}=await import("fflate");
 const {db,staff,capture}=ownerFixture(t);
 initializeStore(db,false);
 const tenant=staff.brokerage.id;
 const entityId=crypto.randomUUID(), otherId=crypto.randomUUID();
 const firstTime="2026-11-08T05:45:00Z", laterTime="2026-11-12T16:00:00Z";
 const create=db.prepare("INSERT INTO compliance_program_entities VALUES (?,?,?,'000123','Fictional scope',?)");
 create.run(tenant,entityId,"Fictional Texas company",firstTime);
 create.run(tenant,otherId,"Fictional separate entity",firstTime);
 const before=capture();
 const request=(input,settings={})=>loanRetentionWork(db,{type:"texasLoanLog",entityId:settings.entityId??entityId,input},
  settings.staff??staff,tenant,settings.now??laterTime);
 const facts={log:"Origination",applicationOn:"2026-10-31",entryEventOn:"2026-10-31",
  fileNumber:"00001",applicants:[{last:"Fictional Applicant",first:"=1+1"}],property:{street:"10 Example St",city:"El Paso",state:"TX",zip:"79901"},
  occupancy:"Primary residence",disposition:"Denied",interestRate:6.125,purpose:"Purchase",product:"Conventional",
  initialOriginator:{name:"Fictional Originator",nmls:"000777"},lien:"First lien",
  evidence:"Fictional signed intake",zone:"America/Denver"};
 const make=(facts,settings={})=>({operation:"save",entryId:crypto.randomUUID(),requestId:crypto.randomUUID(),
  expected:0,authority:"Mortgage company",facts,...settings});
 const initial=make(facts);
 const save=request(initial,{now:firstTime});
 assert.equal(save.versions[0].version,1);
 assert.deepEqual(save.versions[0].timing,{due:"2026-11-07",late:false,initialDue:"2026-11-07",initialLate:false});
 assert.deepEqual(save.versions[0].gaps,[]);
 assert.equal(request(initial).versions.length,1);
 assert.match(request(make({...facts,fileNumber:" 00001 "})).error,/already uses/);
 assert.match(request(initial,{entityId:otherId}).error,/changed/);
 assert.match(request(make({...facts,fileNumber:"future",entryEventOn:"2026-11-13"})).error,/have already occurred/);
 assert.match(request(initial,{staff:{...staff,brokerage:{...staff.brokerage,role:"Processor"}}}).error,/pilot owners/);
 const correction=make({...facts,entryEventOn:"2026-11-01",disposition:"Withdrawn"},{entryId:initial.entryId,expected:1,
  correction:"Fictional withdrawal evidence located"});
 assert.equal(request(correction).versions[0].timing.late,true);
 assert.match(request({...correction,requestId:crypto.randomUUID()}).error,/changed/);
 assert.equal(request({operation:"history",entryId:initial.entryId},{entityId:otherId}).versions.length,0);

 const {applicationOn,interestRate,purpose,product,initialOriginator,lien,...base}=facts;
 const service=make({...base,log:"Third-party processing or underwriting",serviceStartedOn:"2026-10-31",disposition:"In process",
  client:{name:"Fictional client",nmls:"000222"},workers:[{name:"Fictional contractor",nmls:"000333",employment:"1099"}],
  fees:{charged:0,reference:"Fictional no fee"},closingDisclosureFee:"No closing disclosure",
  closingDisclosureReference:"Fictional in-process file"});
 assert.deepEqual(request(service,{now:firstTime}).versions[0].gaps,[]);
 const range={from:"2026-10-01",through:"2026-11-12"};
 const list=request({operation:"list",...range,log:"Origination",search:"00001",offset:0});
 assert.equal(list.items.length,1);
 assert.equal(list.items[0].facts.disposition,"Withdrawn");
 const voided=request({operation:"void",entryId:initial.entryId,expected:2,requestId:crypto.randomUUID(),correction:"Fictional duplicate entry"});
 assert.equal(voided.versions[0].voided,true);
 assert.match(request({...correction,expected:3,requestId:crypto.randomUUID()}).error,/voided/);
 const result=request({operation:"export",...range});
 assert.equal(result.origination,0);
 assert.equal(result.processing,1);
 assert.equal(result.late,1);
 const book=unzipSync(Buffer.from(result.xlsx,"base64"));
 const processing=strFromU8(book["xl/worksheets/sheet2.xml"]);
 const history=strFromU8(book["xl/worksheets/sheet3.xml"]);
 assert.match(processing,/000333/);
 assert.match(processing,/<v>0<\/v>/);
 assert.match(processing,/t="inlineStr"[^>]*><is><t xml:space="preserve">Fictional Applicant, =1\+1/);
 assert.match(history,/Voided/);
 assert.match(history,/Fictional withdrawal evidence located/);
 assert.ok(restoreBlockers(before,capture()).some(reason=>reason.includes("retention evidence changed")));
});

test("Texas borrower-file review retains lender retrieval, an unclosed file and examination history", async t => {
 const {initializeStore}=await import("../src/lib/store.ts");
 const {loanRetentionWork}=await import("../src/lib/loan-retention.ts");
 const {reviewRetentionExport,auditRetentionExport,retentionExportResponse}=await import("../src/lib/loan-retention-export.ts");
 const {restoreBlockers}=await import("../src/lib/workspace-restore.ts");
 const {strFromU8,unzipSync}=await import("fflate");
 const {db,staff,capture}=ownerFixture(t);
 initializeStore(db,false);
 db.exec("ALTER TABLE loan_retention_reviews DROP COLUMN texasReview");
 initializeStore(db,false);
 const scope=staff.brokerage.id, now="2026-11-13T05:30:00Z", entityId=crypto.randomUUID();
 db.prepare("INSERT INTO compliance_program_entities VALUES (?,?,?,'004456','Fictional scope',?)")
   .run(scope,entityId,"Fictional Texas mortgage company",now);
 db.exec(`INSERT INTO contacts (id,name,email,phone,role) VALUES ('borrower','Fictional Borrower','','','Borrower');
   INSERT INTO loans (id,contactId,officer,address,amount,purpose,stage,stageSince)
   VALUES ('tx','borrower','LO','',1,'Purchase','Funded','2026-11-02'),
     ('withdrawn','borrower','LO','',1,'Purchase','Processing','2026-11-01'),
     ('outside','borrower','LO','',1,'Purchase','Processing','2026-11-01');
   UPDATE loans SET disposition='Withdrawn',dispositionDate='2026-11-03' WHERE id='withdrawn';
   INSERT INTO past_client_profiles (loanId,closingDate) VALUES ('tx','2026-11-02');
   INSERT INTO closing_progress (loanId,fundingDate) VALUES ('tx','2026-11-02');`);
 const addApp=db.prepare("INSERT INTO applications (loanId,token,expiresAt,draft,updatedAt) VALUES (?,?, '2027-01-01',?, '2026-11-12')");
 for(const [id,state] of [["tx","TX"],["withdrawn","TX"],["outside","MI"]])
   addApp.run(id,id,JSON.stringify({propertyLocation:{state}}));
 const before=capture();
 const work=(command,actor=staff,at=now)=>loanRetentionWork(db,command,actor,scope,at);
 assert.equal(work({type:"saveDispositionPolicy",id:crypto.randomUUID(),expected:0,fundedDays:1,closedDays:1,
  reference:"Fictional Texas retention policy"}).kind,"disposition");
 const candidate=(at=now,loanId="tx")=>work({type:"dispositionQueue",offset:0},staff,at).rows.find(row=>row.id===loanId);
 const decide=(row,counsel)=>({type:"saveDispositionReview",id:crypto.randomUUID(),loanId:row.id,policyVersion:1,
  basis:row.basis,previous:row.decision?.id??null,outcome:"Recommend disposition",reference:"Fictional Texas recommendation",offset:0,counsel});
 const initialCandidate=candidate();
 assert.match(work(decide(initialCandidate)).error,/Texas borrower-file evidence/);
 const event=on=>({on,reference:"Fictional dated evidence"});
 const item={status:"On file",reference:"Fictional indexed evidence"};
 const exempt={status:"Not applicable",reference:"Fictional reviewed applicability"};
 const facts={entityId,authority:"SML mortgage company",authorityReference:"Fictional SML registration",
  zone:"America/Denver",role:"Brokered",application:event("2026-10-01"),inventory:"Fictional indexed loan file",
  records:{application:item,disclosures:item,communications:item,creditAndFees:item,settlement:item,
    lender:exempt,adverseOutcome:exempt,homeEquity:exempt,other:exempt},
  archive:{location:"NMLS MU1 designated location",reference:"Fictional MU1 location",retrieval:event("2026-11-05")},
  retentionBasis:event("2026-11-02"),examination:{notice:event("2026-11-07")}};
 const save=(facts,expected=0,loanId="tx")=>({type:"saveTexasRecordkeeping",loanId,facts,expected,requestId:crypto.randomUUID(),
   ...(expected?{correction:"Fictional lender and SML evidence update"}:{})});
 assert.match(work(save(facts,0,"outside")).error,/Texas loan/);
 assert.match(work(save(facts),{...staff,brokerage:{...staff.brokerage,role:"Processor"}}).error,/pilot owners/);
 assert.match(work(save({...facts,lenderCopies:event("2026-11-13")})).error,/occurred/);
 const submitted=save(facts);
 const initial=work(submitted);
 assert.deepEqual(initial.currentFinding.findings.map(item=>item.key),["lenderCopies","examination"]);
 assert.equal(work(submitted).versions.length,1);
 assert.match(work(decide(initialCandidate)).error,/changed/);
 assert.match(work(decide(candidate())).error,/lender/);
 const late=work(save({...facts,lenderCopies:event("2026-11-03"),examination:{...facts.examination,production:event("2026-11-09")}},1));
 assert.deepEqual(late.currentFinding.findings.map(item=>item.key),["lenderCopiesTiming"]);
 const corrected=save({...late.versions[0].facts,lenderCopies:event("2026-11-02")},2);
 assert.deepEqual(work(corrected).currentFinding.findings,[]);
 assert.match(work({...corrected,requestId:crypto.randomUUID()}).error,/changed/);
 const withdrawn=work(save({...facts,application:event("2024-11-22"),retentionBasis:event("2026-11-03"),
   records:{...facts.records,settlement:exempt,adverseOutcome:item},examination:undefined},0,"withdrawn"));
 assert.equal(withdrawn.currentFinding.stateReviewDate,null);
 assert.deepEqual(withdrawn.currentFinding.findings.map(item=>item.key),["ruleEdition"]);
 assert.match(work(decide(candidate(now,"withdrawn"))).error,/November 23, 2024/);
 assert.match(work(decide(candidate())).error,/Retain the record through the Texas review date/);
 const beforeMidnight="2029-11-03T05:30:00Z", afterMidnight="2029-11-03T06:30:00Z";
 assert.equal(candidate(beforeMidnight).retainTexasThroughToday,true);
 assert.equal(candidate(afterMidnight).retainTexasThroughToday,false);
 assert.match(work(decide(candidate(afterMidnight)),staff,afterMidnight).error,/counsel/);
 const counsel={retainThrough:"2029-11-02",reference:"Fictional counsel reviewed Texas dates"};
 const decision=decide(candidate(afterMidnight),counsel);
 assert.equal(work(decision,staff,afterMidnight).rows.find(row=>row.id==="tx").decision.id,decision.id);
 assert.equal(work(decision,staff,afterMidnight).rows.find(row=>row.id==="tx").decision.id,decision.id);
 const audit=JSON.parse(work({type:"exportRetentionAudit",policyVersion:null}).json);
 assert.equal(audit.texasRecordkeeping.length,4);
 const proof=audit.decisions.find(item=>item.id===decision.id).texasReview;
 assert.equal(proof.evidence.version,3);
 assert.equal(proof.evidence.facts.lenderCopies.on,"2026-11-02");
 assert.deepEqual(proof.counsel,counsel);
 const reviewed=reviewRetentionExport(db,staff,scope,"tx");
 const archive=await retentionExportResponse(undefined,scope,reviewed,async fingerprint=>auditRetentionExport(db,staff,scope,"tx",fingerprint));
 const manifest=JSON.parse(strFromU8(unzipSync(new Uint8Array(await archive.arrayBuffer()))["manifest.json"]));
 assert.equal(manifest.texasRecordkeeping[0].entity.nmls,"004456");
 assert.equal(manifest.texasRecordkeeping[0].finding.stateReviewDate,"2029-11-02");
 assert.deepEqual(manifest.texasRecordkeeping[2].finding.findings,initial.currentFinding.findings);
 assert.ok(restoreBlockers(before,capture()).some(reason=>reason.includes("retention evidence changed")));
});

test("New York application log preserves referrals, fees and denial evidence across entity-scoped revisions", async t => {
 const {initializeStore}=await import("../src/lib/store.ts");
 const {loanRetentionWork}=await import("../src/lib/loan-retention.ts");
 const {restoreBlockers}=await import("../src/lib/workspace-restore.ts");
 const {strFromU8,unzipSync}=await import("fflate");
 const {db,staff,capture}=ownerFixture(t);
 initializeStore(db,false);
 const tenant=staff.brokerage.id, entityId=crypto.randomUUID(), otherId=crypto.randomUUID(), now="2026-11-12T03:00:00Z";
 const addEntity=db.prepare("INSERT INTO compliance_program_entities VALUES (?,?,?,'000123','Fictional New York scope',?)");
 addEntity.run(tenant,entityId,"Fictional New York broker",now);
 addEntity.run(tenant,otherId,"Fictional separate broker",now);
 const before=capture();
 const request=(input,entity=entityId,actor=staff)=>loanRetentionWork(db,{type:"newYorkApplicationLog",entityId:entity,input},actor,tenant,now);
 const party={name:"Fictional Referral",address:"1 Fictional Street",description:"Real estate broker"};
 const facts={office:"Fictional branch",fileNumber:"000042",applicationOn:"2026-11-10",
  applicants:[{name:"=1+1 Fictional Applicant",address:"2 Fictional Street"}],propertyAddress:"3 Fictional Street",
  source:{status:"Referral",referrer:party},disposition:{status:"Pending"},placement:{status:"Unreviewed"},
  preclosingFees:{status:"Recorded",items:[{amountCents:1050,paidOn:"2026-11-10",purpose:"Credit report",direction:"Collected",counterparty:party}]},
  brokerageFees:{status:"Unreviewed"}};
 const make=(facts,options={})=>({operation:"save",entryId:crypto.randomUUID(),requestId:crypto.randomUUID(),expected:0,facts,...options});
 const initial=make(facts);
 assert.equal(request(initial).versions[0].review.firstLoggedOn,"2026-11-11");
 assert.equal(request(initial).versions[0].review.loggedAfterReceipt,true);
 assert.equal(request(initial).versions.length,1);
 assert.match(request(initial,otherId).error,/changed/);
 assert.match(request(initial,entityId,{...staff,brokerage:{...staff.brokerage,role:"Processor"}}).error,/pilot owners/);
 assert.match(request(make({...facts,fileNumber:" 000042 "})).error,/already uses/);
 assert.match(request(make({...facts,applicationOn:"2026-11-12"})).error,/already occurred/);
 assert.match(request(make({...facts,earlierLog:{on:"2026-11-12",reference:"Future log date"}})).error,/cannot follow/);
 const corrected=make({...facts,earlierLog:{on:"2026-11-10",reference:"Fictional branch log"},
  disposition:{status:"Final",outcome:"Denied",on:"2026-11-11",reference:"Fictional denied file"},
  placement:{status:"Not placed",reference:"Fictional placement review"},
  brokerageFees:{status:"Accounting record",reference:"Fictional ledger 42"}},
  {entryId:initial.entryId,expected:1,correction:"Fictional disposition and branch evidence"});
 const history=request(corrected);
 assert.deepEqual(history.versions.map(item=>item.review.loggedAfterReceipt),[false,true]);
 assert.deepEqual(history.versions[0].review.gaps,[]);
 assert.match(request({...corrected,requestId:crypto.randomUUID()}).error,/changed/);
 const listing={operation:"list",from:"2026-11-10",through:"2026-11-11",search:"000042",offset:0};
 assert.equal(request(listing).items.length,1);
 assert.equal(request(listing,otherId).items.length,0);
 const result=request({operation:"export",from:listing.from,through:listing.through});
 assert.equal(result.entries,1);
 assert.equal(result.gaps,0);
 const book=unzipSync(Buffer.from(result.xlsx,"base64"));
 const sheet=number=>strFromU8(book[`xl/worksheets/sheet${number}.xml`]);
 assert.match(sheet(1),/t="inlineStr"[^>]*><is><t xml:space="preserve">=1\+1 Fictional Applicant/);
 assert.match(sheet(1),/Fictional Referral/);
 assert.match(sheet(2),/<v>10.5<\/v>/);
 assert.match(sheet(4),/Fictional denied file/);
 assert.match(sheet(5),/Fictional ledger 42/);
 assert.match(sheet(5),/Fictional disposition and branch evidence/);
 assert.ok(restoreBlockers(before,capture()).some(reason=>reason.includes("retention evidence changed")));
 const voided=request({operation:"void",entryId:initial.entryId,expected:2,requestId:crypto.randomUUID(),correction:"Fictional duplicate"});
 assert.equal(voided.versions[0].voided,true);
 assert.equal(request({operation:"export",from:listing.from,through:listing.through}).entries,0);
});
