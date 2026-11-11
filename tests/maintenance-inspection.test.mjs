import assert from "node:assert/strict";
import {registerHooks} from "node:module";
import {DatabaseSync} from "node:sqlite";
import {randomUUID} from "node:crypto";
import test from "node:test";
registerHooks({resolve(specifier,context,next){try{return next(specifier,context);}catch(error){
  if(error.code!=="ERR_MODULE_NOT_FOUND"||!specifier.startsWith("./"))throw error;return next(`${specifier}.ts`,context);
}}});
const {inspectMaintenanceStore}=await import("../src/lib/maintenance-inspection.ts");
function fixture(){
  const sqlite=new DatabaseSync(":memory:"),db={exec:q=>sqlite.exec(q),prepare:q=>sqlite.prepare(q),transaction:run=>run()};
  db.exec(`CREATE TABLE document_requests(id TEXT,kind TEXT,loanId TEXT,revision INTEGER);
    CREATE TABLE document_files(requestId TEXT,objectId TEXT,pendingId TEXT,attemptedAt INTEGER,uploadMode TEXT);
    CREATE TABLE document_acceptances(requestId TEXT,revision INTEGER);
    CREATE TABLE document_accepted_files(requestId TEXT,revision INTEGER,objectId TEXT);
    CREATE TABLE uwm_live_requests(id TEXT,loanId TEXT,action TEXT,state TEXT,updatedAt TEXT,environment TEXT,result TEXT);
    CREATE TABLE uwm_operations(id TEXT,loanId TEXT,kind TEXT,state TEXT,updatedAt TEXT,environment TEXT);`);
  return {db,close:()=>sqlite.close()};
}
test("inspection checks retained/current bytes once, reports absent and unavailable distinctly, and never writes",async()=>{
  const {db,close}=fixture();try{
    const id=randomUUID(),objectId=randomUUID(),missing=randomUUID(),failed=randomUUID();
    db.prepare("INSERT INTO document_requests VALUES(?,'Pay stub','loan',5)").run(id);
    db.prepare("INSERT INTO document_files VALUES(?,?,NULL,0,'mock')").run(id,objectId);
    for(const [rev,obj] of [[2,missing],[3,failed],[4,null],[5,objectId]]){
      db.prepare("INSERT INTO document_acceptances VALUES(?,?)").run(id,rev);
      if(obj)db.prepare("INSERT INTO document_accepted_files VALUES(?,?,?)").run(id,rev,obj);
    }
    db.exec("CREATE TABLE referral_leads(id TEXT,name TEXT); INSERT INTO referral_leads VALUES('loan','Fictional Rivera');");
    const before=db.prepare("SELECT total_changes() AS n").get().n,calls=[];
    const result=await inspectMaintenanceStore(db,{revision:2},async key=>{calls.push(key);if(key===failed)throw Error("secret storage error");return key===missing?null:{size:321};});
    assert.equal(result.documents.items[0].recordName,"Fictional Rivera");
    assert.equal(result.documents.total,5);assert.equal(calls.length,3);
    assert.deepEqual(result.documents.items.map(row=>row.availability),["Missing","Check unavailable","No retained file","Available","Available"]);
    assert.equal(result.records.find(row=>row.label==="Loans").count,null);
    assert.ok(result.unavailable.includes("Loans"));
    assert.equal(db.prepare("SELECT total_changes() AS n").get().n,before);
    assert.ok(!JSON.stringify(result).includes(objectId));assert.ok(!JSON.stringify(result).includes("secret storage"));
  }finally{close();}
});
test("inspection pages all unresolved rows, distinguishes acknowledgments, and omits payloads and finished operations",async()=>{
  const {db,close}=fixture();try{
    for(let i=0;i<30;i++)db.prepare("INSERT INTO uwm_live_requests VALUES(?,?,'lock','Unknown','2026-11-11T12:00:00Z','stage',?)")
      .run(String(i).padStart(2,"0"),"loan",'sensitive provider payload');
    db.prepare("INSERT INTO uwm_live_requests VALUES('ack','loan','lock','Acknowledged','2026-11-11','stage',NULL)").run();
    db.prepare("INSERT INTO uwm_live_requests VALUES('done','loan','reconcile-request','Acknowledged','2026-11-11','stage',NULL)").run();
    db.prepare("INSERT INTO uwm_operations VALUES('finished','loan','import','Completed','2026-11-11','stage')").run();
    db.prepare("INSERT INTO uwm_operations VALUES('prepared','loan','import','Prepared','2026-11-11','stage')").run();
    const first=await inspectMaintenanceStore(db,{revision:2},async()=>null);
    assert.equal(first.requests.total,32);assert.equal(first.requests.items.length,25);assert.equal(first.requests.next,25);
    const last=await inspectMaintenanceStore(db,{revision:2,requests:first.requests.next},async()=>null);
    assert.equal(last.requests.items.length,7);assert.equal(last.requests.next,null);
    assert.equal(new Set([...first.requests.items,...last.requests.items].map(row=>row.reference)).size,32);
    assert.ok(!JSON.stringify(first).includes("sensitive provider payload"));
    await assert.rejects(inspectMaintenanceStore(db,{revision:2,requests:-1},async()=>null));
  }finally{close();}
});
test("inspection of an uninitialized restored database leaves it untouched and explicitly unavailable",async()=>{
  const sqlite=new DatabaseSync(":memory:"),db={prepare:q=>sqlite.prepare(q)};
  try{
    const result=await inspectMaintenanceStore(db,{revision:2},async()=>{throw Error("Must not read storage");});
    assert.ok(result.records.every(row=>row.count===null));assert.ok(result.unavailable.length>=8);
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM sqlite_schema").get().n,0);
  }finally{sqlite.close();}
});
test("document paging stays bounded and never follows path-like object references",async()=>{
  const {db,close}=fixture();try{
    for(let i=0;i<28;i++){
      const id=String(i).padStart(2,"0");
      db.prepare("INSERT INTO document_requests VALUES(?,'Pay stub','loan',1)").run(id);
      db.prepare("INSERT INTO document_files VALUES(?,?,NULL,0,'mock')").run(id,i===0?'../other-tenant/private':randomUUID());
    }
    let calls=0;
    const result=await inspectMaintenanceStore(db,{revision:2},async()=>{calls++;return {size:10};});
    assert.equal(result.documents.items.length,25);assert.equal(calls,24);assert.equal(result.documents.next,25);
    assert.equal(result.documents.items[0].availability,"Check unavailable");
    const next=await inspectMaintenanceStore(db,{revision:2,documents:25},async()=>({size:10}));
    assert.equal(next.documents.items.length,3);assert.equal(next.documents.next,null);
    await assert.rejects(inspectMaintenanceStore(db,{revision:2,documents:50},async()=>null),/page changed/);
  }finally{close();}
});
