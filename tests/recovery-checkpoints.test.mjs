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

 db.prepare("INSERT INTO applications (loanId,token,expiresAt,draft,updatedAt) VALUES ('mi','fictional-token',?,?,?)")
  .run(now,JSON.stringify({propertyLocation:{state:"oh"}}),now);
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
