import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { registerHooks } from "node:module";
registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context); } catch(error) {
    if(error.code !== "ERR_MODULE_NOT_FOUND" || !specifier.startsWith("./")) throw error;
    return next(`${specifier}.ts`,context);
  }
} });
const access = await import("../src/lib/uwm-user-access.ts");
const {uwmPublicClient,UwmRequestError} = await import("../src/lib/uwm-public-client.ts");
const ops = await import("../src/lib/uwm-operations.ts");
const hooks = await import("../src/lib/uwm-webhooks.ts");
const brokerageId="11499b2a-1e3d-40f7-a752-f9781ec7fc24", loanId="21499b2a-1e3d-40f7-a752-f9781ec7fc24";
const staff={name:"Stage user",email:"stage@example.test",brokerage:{id:brokerageId,name:"Test shop",role:"Admin",pilot:false}};
const env={UWM_BROKERAGE_ID:brokerageId,UWM_USER_ENVIRONMENT:"stage",ORBIT_DEPLOYMENT:"stage",UWM_USER_CLIENT_ID:"fixture-client",UWM_USER_CLIENT_SECRET:"fixture-secret",UWM_TOKEN_ENCRYPTION_KEY:"a".repeat(64)};
const grant={access_token:"fixture-access-token",refresh_token:"fixture-refresh-token",expires_in:3600};
test("user access cannot reuse pricing credentials or mix a partial client pair",()=>{
 const pricing={...env,UWM_USER_CLIENT_ID:undefined,UWM_USER_CLIENT_SECRET:undefined,UWM_CLIENT_ID:"pricing-id",UWM_CLIENT_SECRET:"pricing-secret"};
 assert.throws(()=>access.uwmUserSettings(pricing),/configure UWM/);
 assert.throws(()=>access.uwmUserSettings({...pricing,UWM_USER_CLIENT_ID:"user-id"}),/configure UWM/);
 assert.equal(access.uwmUserSettings({...env,...{UWM_CLIENT_ID:"pricing-id",UWM_CLIENT_SECRET:"pricing-secret",UWM_ENVIRONMENT:"production"}}).environment,"stage");
});
function database(t) {
 const sqlite=new DatabaseSync(":memory:"); t.after(()=>sqlite.close());
 const db={exec:s=>sqlite.exec(s),prepare:s=>sqlite.prepare(s),transaction:fn=>{
  sqlite.exec("BEGIN");try{const value=fn();sqlite.exec("COMMIT");return value;}catch(error){sqlite.exec("ROLLBACK");throw error;}
 }};
 db.exec("CREATE TABLE loans(id TEXT PRIMARY KEY,officerEmail TEXT); CREATE TABLE applications(loanId TEXT,revision INTEGER,reviewedAt TEXT,submittedAt TEXT,correctionNote TEXT); CREATE TABLE submissions(id TEXT,loanId TEXT,lender TEXT,externalId TEXT)");
 db.prepare("INSERT INTO loans VALUES(?,?)").run(loanId,staff.email);
 db.prepare("INSERT INTO applications VALUES(?,1,'reviewed','submitted',NULL)").run(loanId);
 access.initializeUwmUserAccess(db); ops.initializeUwmOperations(db);hooks.initializeUwmWebhooks(db);return db;
}
async function connect(t,db) {
 t.mock.method(globalThis,"fetch",async()=>Response.json(grant));
 await access.connectUwmUser(db,env,staff,{username:"fixture-user",password:"fixture-password"});
}
test("user password grant encrypts tokens and never stores the password",async t=>{
 const db=database(t);let form;
 t.mock.method(globalThis,"fetch",async(url,init)=>{form=init.body;assert.equal(url,"https://sso.uwm.com/adfs/oauth2/token");assert.equal(init.redirect,"manual");return Response.json(grant);});
 await access.connectUwmUser(db,env,staff,{username:"fixture-user",password:"fixture-password"});
 assert.equal(form.get("grant_type"),"password");assert.equal(form.get("scope"),"https://api.uwm.com/loanorigination-stg");
 const serialized=JSON.stringify(db.prepare("SELECT * FROM uwm_user_access").all());
 for(const value of ["fixture-password",grant.access_token,grant.refresh_token])assert.equal(serialized.includes(value),false);
 assert.equal(await access.uwmUserToken(db,env,staff),grant.access_token);
 assert.equal(access.uwmUserStatus(db,env,staff).configured,true);
 assert.equal("encrypted" in access.uwmUserStatus(db,env,staff),false);
});
test("disconnect cannot be undone by a late sign-in response",async t=>{
 const db=database(t);let release;
 t.mock.method(globalThis,"fetch",()=>new Promise(resolve=>{release=resolve;}));
 const pending=access.connectUwmUser(db,env,staff,{username:"user",password:"password"});
 access.disconnectUwmUser(db,staff);release(Response.json(grant));
 await assert.rejects(pending,/connection changed/);
 assert.equal(db.prepare("SELECT count(*) AS n FROM uwm_user_access").get().n,0);
});
test("expired tokens refresh; changed brokerage/encryption context and deployment fail closed",async t=>{
 const db=database(t);await connect(t,db);
 db.prepare("UPDATE uwm_user_access SET expiresAt=0").run();
 t.mock.method(globalThis,"fetch",async(url,init)=>{assert.equal(init.body.get("grant_type"),"refresh_token");assert.equal(init.body.get("refresh_token"),grant.refresh_token);return Response.json({access_token:"refreshed",expires_in:3600});});
 assert.equal(await access.uwmUserToken(db,env,staff),"refreshed");
 db.prepare("UPDATE uwm_user_access SET expiresAt=0").run();
 assert.equal(await access.uwmUserToken(db,env,staff),"refreshed");
 await assert.rejects(access.uwmUserToken(db,{...env,UWM_TOKEN_ENCRYPTION_KEY:"b".repeat(64)},staff),/Reconnect/);
 await assert.rejects(access.uwmUserToken(db,{...env,ORBIT_DEPLOYMENT:"production"},staff),/environment/);
 await assert.rejects(access.uwmUserToken(db,env,{...staff,brokerage:{...staff.brokerage,id:crypto.randomUUID()}}),/unavailable/);
});
test("public operations use user tokens, exact environment paths and acknowledge empty responses",async t=>{
 const db=database(t);await connect(t,db);const calls=[];
 t.mock.method(globalThis,"fetch",async(url,init)=>{calls.push({url,init});return new Response(null,{status:204});});
 const client=uwmPublicClient(db,env,staff);
 await client.brokerAssociations();await client.float("123",{fixture:true});await client.lock("123",{fixture:true});
 await client.extendLock("123",{fixture:true});await client.cancelLock("123");
 assert.ok(calls.every(call=>call.url.startsWith("https://stg.api.uwm.com/")&&call.init.redirect==="manual"&&call.init.headers.Authorization===`Bearer ${grant.access_token}`));
 assert.equal(calls[2].url,"https://stg.api.uwm.com/public/products/v1/loans/123/lock");
 assert.equal(calls[4].init.method,"PUT");
 assert.equal(calls[4].init.body,undefined);
});
test("transport does not retry redirects, server failures or unreadable acknowledgments",async t=>{
 const db=database(t);await connect(t,db);const client=uwmPublicClient(db,env,staff);
 for(const status of [302,429,500]) {
  let count=0;t.mock.method(globalThis,"fetch",async()=>{count++;return new Response("",{status});});
  await assert.rejects(client.lock("123",{}),error=>error instanceof UwmRequestError&&error.status===status);
  assert.equal(count,1);
 }
 t.mock.method(globalThis,"fetch",async()=>new Response("not-json",{status:200}));
 await assert.rejects(client.lock("123",{}),error=>error.outcome==="unknown");
});
function input(kind="import") {return {id:crypto.randomUUID(),loanId,applicationRevision:1,environment:"stage",kind,requestDigest:ops.uwmRequestDigest("fixture-request")};}
test("timeouts and duplicate operation requests never repeat a lender action",async t=>{
 const db=database(t),operation=input("lock");let count=0;
 const send=async()=>{count++;throw new UwmRequestError("timeout",null,"unknown");};
 assert.equal((await ops.dispatchUwmOperation(db,staff,operation,send)).state,"Unknown");
 assert.equal((await ops.dispatchUwmOperation(db,staff,operation,send)).state,"Unknown");
 assert.equal(count,1);assert.throws(()=>ops.prepareUwmOperation(db,staff,input("lock")),/reconciliation/);
});
test("import callback correlates exact transaction and sent revision without changing current application",async t=>{
 const db=database(t),operation=input();
 ops.prepareUwmOperation(db,staff,operation);ops.bindUwmTransaction(db,operation.id,"tx-1");
 assert.equal((await ops.dispatchUwmOperation(db,staff,operation,async()=>({status:200,body:{}}))).state,"Acknowledged");
 db.prepare("UPDATE applications SET revision=2").run();
 const save=(environment,loanNumber)=>hooks.saveUwmWebhook(db,hooks.parseUwmWebhook(environment,"import",JSON.stringify({TransactionId:"tx-1",LoanNumber:loanNumber,LoanStatus:"Completed",LogDateTime:"2026-11-10T21:00:00Z"})));
 assert.equal(ops.correlateUwmImport(db,Number(save("production","123").receiptId)),"Unmatched");
 const receipt=Number(save("stage","123").receiptId);
 assert.equal(ops.correlateUwmImport(db,receipt),"Completed");assert.equal(ops.correlateUwmImport(db,receipt),"Duplicate outcome");
 assert.equal(ops.correlateUwmImport(db,Number(save("stage","456").receiptId)),"Conflicting outcome");
 assert.equal(db.prepare("SELECT revision FROM applications").get().revision,2);
 assert.equal(db.prepare("SELECT applicationRevision FROM uwm_operations").get().applicationRevision,1);
});
test("review changes, mismatched operation identity and unauthorized loans are rejected",async t=>{
 const db=database(t),operation=input();ops.prepareUwmOperation(db,staff,operation);
 assert.throws(()=>ops.prepareUwmOperation(db,staff,{...operation,requestDigest:"b".repeat(64)}),/different request/);
 db.prepare("UPDATE applications SET revision=2").run();
 await assert.rejects(ops.dispatchUwmOperation(db,staff,operation,async()=>assert.fail()),/changed/);
 assert.throws(()=>ops.prepareUwmOperation(db,{...staff,email:"other@example.test",brokerage:{...staff.brokerage,role:"LO"}},input()),/unavailable/);
});

const conditionBody={attachments:[{documentType:"All Conditions",comments:"Reviewed fixture",files:[{documentId:1}],conditions:["condition-1"]}]};
test("transaction creation and commit omit bodies; scans require authorized mapping and cannot confuse missing fields with ready",async t=>{
 const db=database(t);await connect(t,db);const client=uwmPublicClient(db,env,staff);let next,calls=[];
 t.mock.method(globalThis,"fetch",async(url,init)=>{calls.push({url,init});return Response.json(next);});
 next={success:true,data:{transactionId:"tx-1",uri:"https://example.test/file?sig=fixture",fileName:"loan.xml"},errors:null,validationErrors:null};
 assert.equal((await client.createTransaction()).transactionId,"tx-1");assert.equal(calls[0].init.body,undefined);
 next={message:"File Imported Successfully",transactionId:"tx-1"};await client.commitTransaction("tx-1");assert.equal(calls[1].init.body,undefined);
 next={success:true,data:{transferStatus:"New",fields:[{required:true,validated:false,id:"missing"}]},errors:null,validationErrors:null};
 assert.equal((await client.scanTransaction("tx-1",{entityId:"branch",contactId:"contact"})).readyToCommit,false);
 next.data={transferStatus:"UpdateUploaded",fields:[]};
 assert.equal((await client.scanTransaction("tx-1",{entityId:"branch",contactId:"contact"})).readyToCommit,true);
 const count=calls.length;await assert.rejects(client.scanTransaction("tx-1",{}));assert.equal(calls.length,count);
 next={success:false,data:{transactionId:"tx-1",uri:"https://example.test/file",fileName:"loan.xml"},errors:["invalid"],validationErrors:null};
 await assert.rejects(client.createTransaction(),e=>e.outcome==="unknown");
});
test("document upload reserves a target without bytes, verifies origin and digest, and never sends bearer credentials to storage",async t=>{
 const db=database(t);await connect(t,db);const calls=[],origin="https://fixture.blob.core.windows.net";
 const client=uwmPublicClient(db,{...env,UWM_DOCUMENT_STORAGE_ORIGIN:origin},staff);
 t.mock.method(globalThis,"fetch",async(url,init)=>{calls.push({url,init});return url.startsWith(origin)?new Response(null,{status:201}):Response.json({sasUri:`${origin}/docs/test.pdf?sig=fixture`,documentId:1,fileName:"test.pdf",location:"Public Documentations"});});
 const target=await client.createConditionUpload("1234567890","test.pdf");assert.equal(calls[0].init.body,undefined);
 const bytes=new TextEncoder().encode("fixture document"),digest=ops.uwmRequestDigest(bytes);
 await client.uploadConditionBytes(target.sasUri,bytes,digest);
 assert.equal(calls[1].init.method,"POST");assert.equal(calls[1].init.headers.Authorization,undefined);assert.equal(calls[1].init.redirect,"manual");
 await assert.rejects(client.uploadConditionBytes(target.sasUri.replace(origin,"https://unapproved.test"),bytes,digest));
 await assert.rejects(client.uploadConditionBytes(target.sasUri,bytes,"a".repeat(64)));assert.equal(calls.length,2);
});
test("condition submissions treat missing, partial and 422 acknowledgments as unknown without retrying",async t=>{
 const db=database(t);await connect(t,db);const client=uwmPublicClient(db,env,staff);let count=0;
 for(const [status,body] of [[200,{documentTypes:["All Conditions"],errors:["partial"]}],[200,{documentTypes:[],errors:[]}],[200,null],[422,{documentTypes:["All Conditions"],errors:["other failure"]}]]){
  t.mock.method(globalThis,"fetch",async()=>{count++;return Response.json(body,{status});});
  await assert.rejects(client.submitConditions("1234567890",conditionBody),e=>e.outcome==="unknown");
 }
 assert.equal(count,4);
 t.mock.method(globalThis,"fetch",async()=>Response.json({documentTypes:["All Conditions"],errors:[]}));
 assert.equal((await client.submitConditions("1234567890",conditionBody)).status,200);
});
test("NotCompleted callbacks finish failed imports; null and undocumented statuses are retained for review",async t=>{
 const db=database(t),operation=input();ops.prepareUwmOperation(db,staff,operation);ops.bindUwmTransaction(db,operation.id,"tx-fail");
 await ops.dispatchUwmOperation(db,staff,operation,async()=>({status:200,body:{}}));
 for(const status of [null,"Failed","NotCompleted"]){
  const receipt=hooks.saveUwmWebhook(db,hooks.parseUwmWebhook("stage","import",JSON.stringify({TransactionId:"tx-fail",LoanNumber:null,LoanStatus:status,Message:"fixture",LogDateTime:"2026-11-10T21:00:00Z"})));
  assert.equal(ops.correlateUwmImport(db,Number(receipt.receiptId)),status==="NotCompleted"?"Failed":"Needs review");
 }
});
