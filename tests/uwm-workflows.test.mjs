import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { registerHooks } from "node:module";
registerHooks({resolve(specifier, context, next) {try {return next(specifier,context);} catch(error) {
  if(error.code!=="ERR_MODULE_NOT_FOUND"||!specifier.startsWith("./"))throw error;return next(`${specifier}.ts`,context);
}}});
const {initializeUwmWorkflows,runUwmWorkflow,readUwmFile}=await import("../src/lib/uwm-workflows.ts");
const {initializeUwmOperations,correlateUwmImport}=await import("../src/lib/uwm-operations.ts");
const {initializeUwmWebhooks,saveUwmWebhook,parseUwmWebhook}=await import("../src/lib/uwm-webhooks.ts");
const loanId="21499b2a-1e3d-40f7-a752-f9781ec7fc24", brokerageId="11499b2a-1e3d-40f7-a752-f9781ec7fc24";
const staff={name:"Test officer",email:"officer@example.test",brokerage:{id:brokerageId,name:"Test",role:"Admin",pilot:false}};
const env={UWM_BROKERAGE_ID:brokerageId,UWM_USER_ENVIRONMENT:"stage",ORBIT_DEPLOYMENT:"stage",UWM_USER_CLIENT_ID:"fixture",UWM_USER_CLIENT_SECRET:"fixture",UWM_TOKEN_ENCRYPTION_KEY:"a".repeat(64),UWM_STORAGE_ORIGIN:"https://fixture.blob.core.windows.net",UWM_DOCUMENT_STORAGE_ORIGIN:"https://fixture.blob.core.windows.net"};
const base=()=>({id:crypto.randomUUID(),loanId,applicationRevision:1,confirmed:true});
const prepare=()=>({...base(),action:"prepare-import",xml:'<MESSAGE xmlns="http://www.mismo.org/residential/2009/schemas"></MESSAGE>',scan:{entityId:"1",contactId:"2"}});
function setup(t){
 const sqlite=new DatabaseSync(":memory:");t.after(()=>sqlite.close());
 const db={exec:s=>sqlite.exec(s),prepare:s=>sqlite.prepare(s),transaction:fn=>{sqlite.exec("BEGIN");try{const r=fn();sqlite.exec("COMMIT");return r;}catch(e){sqlite.exec("ROLLBACK");throw e;}}};
 db.exec("CREATE TABLE loans(id TEXT PRIMARY KEY,officerEmail TEXT); CREATE TABLE applications(loanId TEXT,revision INTEGER,reviewedAt TEXT,submittedAt TEXT,correctionNote TEXT); CREATE TABLE submissions(id TEXT,loanId TEXT,lender TEXT,externalId TEXT); CREATE TABLE loan_processing(loanId TEXT,processorEmail TEXT)");
 db.prepare("INSERT INTO loans VALUES(?,?)").run(loanId,staff.email);db.prepare("INSERT INTO applications VALUES(?,1,'reviewed','submitted',NULL)").run(loanId);
 initializeUwmOperations(db);initializeUwmWebhooks(db);initializeUwmWorkflows(db);
 let writes=0;
 const api={brokerAssociations:async()=>({body:{branches:[{entityId:1,contacts:[{contactId:2}]}]}}),
  createTransaction:async()=>{writes++;return {transactionId:"tx-fixture",uri:"https://fixture.blob.core.windows.net/xml?sig=private",fileName:"file.xml"};},
  uploadXml:async()=>{writes++;},scanTransaction:async()=>{writes++;return {readyToCommit:true,body:{success:true,errors:null,data:{transferStatus:"UpdateUploaded",fields:[]}}};},
  commitTransaction:async()=>{writes++;return {status:200,body:{}};}};
 return {db,api,writes:()=>writes};
}
test("import review, explicit commit and callback preserve sent revision and never repeat duplicate requests",async t=>{
 const {db,api,writes}=setup(t),input=prepare();
 const first=await runUwmWorkflow(db,env,staff,input,api);assert.equal(first.result.readyToCommit,true);assert.equal(writes(),3);
 await runUwmWorkflow(db,env,staff,input,api);assert.equal(writes(),3);
 const commit={...base(),action:"commit-import",importId:input.id};
 assert.equal((await runUwmWorkflow(db,env,staff,commit,api)).state,"Acknowledged");assert.equal(writes(),4);
 await runUwmWorkflow(db,env,staff,commit,api);assert.equal(writes(),4);
 const receipt=saveUwmWebhook(db,parseUwmWebhook("stage","import",JSON.stringify({TransactionId:"tx-fixture",LoanNumber:"1234567890",LoanStatus:"Completed",LogDateTime:"2026-11-11T00:00:00Z"})));
 db.prepare("UPDATE applications SET revision=2").run();assert.equal(correlateUwmImport(db,Number(receipt.receiptId)),"Completed");
 const view=await readUwmFile(db,env,staff,{loanId,view:"activity"});assert.equal(view.imports[0].applicationRevision,1);assert.equal(view.imports[0].lenderLoanNumber,"1234567890");
 assert.equal(JSON.stringify(db.prepare("SELECT * FROM uwm_live_requests").all()).includes("sig=private"),false);
});
test("unauthorized branch, stale application, wrong deployment and other staff cannot dispatch",async t=>{
 const {db,api,writes}=setup(t),input=prepare();
 assert.equal((await runUwmWorkflow(db,env,staff,{...input,scan:{entityId:"99",contactId:"2"}},api)).state,"Rejected");assert.equal(writes(),0);
 await assert.rejects(runUwmWorkflow(db,{...env,ORBIT_DEPLOYMENT:"production"},staff,prepare(),api));
 await assert.rejects(runUwmWorkflow(db,env,{...staff,email:"other@example.test",brokerage:{...staff.brokerage,role:"LO"}},prepare(),api));
 db.prepare("UPDATE applications SET revision=2").run();await assert.rejects(runUwmWorkflow(db,env,staff,prepare(),api),/Review/);assert.equal(writes(),0);
});
test("a dropped upload is durable and blocks duplicate and fresh-id retries",async t=>{
 const {db,api,writes}=setup(t),input=prepare();api.uploadXml=async()=>{throw new Error("timeout");};
 assert.equal((await runUwmWorkflow(db,env,staff,input,api)).state,"Unknown");assert.equal(writes(),1);
 await runUwmWorkflow(db,env,staff,input,api);assert.equal(writes(),1);
 await assert.rejects(runUwmWorkflow(db,env,staff,prepare(),api),/reconciliation/);
 assert.equal(db.prepare("SELECT transactionId FROM uwm_operations").get().transactionId,"tx-fixture");
});
test("concurrent double clicks reserve before awaiting broker access",async t=>{
 const {db,api,writes}=setup(t),input=prepare();let release;
 const original=api.brokerAssociations;api.brokerAssociations=()=>new Promise(resolve=>{release=()=>original().then(resolve);});
 const pending=runUwmWorkflow(db,env,staff,input,api);
 assert.equal((await runUwmWorkflow(db,env,staff,input,api)).state,"Dispatching");assert.equal(writes(),0);
 await assert.rejects(runUwmWorkflow(db,env,staff,prepare(),api),/reconciliation/);
 await release();await pending;assert.equal(writes(),3);
});
test("scan corrections preserve UWM metadata and only replace field values",async t=>{
 const {db,api}=setup(t),input=prepare();
 const field={id:"rule",xPath:"opaque",required:true,validated:false,value:null,label:"SSN",metaData:{original:true}};
 api.scanTransaction=async()=>({readyToCommit:false,body:{success:true,errors:null,data:{transferStatus:"New",fields:[field]}}});
 await runUwmWorkflow(db,env,staff,input,api);
 assert.equal((await runUwmWorkflow(db,env,staff,{...base(),action:"commit-import",importId:input.id},api)).state,"Rejected");
 api.amendTransaction=async(tx,body)=>{assert.equal(tx,"tx-fixture");assert.deepEqual(body.fields,[{...field,value:"synthetic"}]);return {readyToCommit:true,body:{success:true,errors:null,data:{transferStatus:"UpdateUploaded",fields:[{...field,value:"synthetic",validated:true}]}}};};
 assert.equal((await runUwmWorkflow(db,env,staff,{...base(),action:"amend-import",importId:input.id,values:["synthetic"]},api)).result.readyToCommit,true);
});
test("submitted or stale attachment revisions cannot be resubmitted",async t=>{
 const {db,api}=setup(t),input=prepare();await runUwmWorkflow(db,env,staff,input,api);
 db.prepare("UPDATE uwm_operations SET state='Completed',lenderLoanNumber='1234567890'").run();
 api.listConditionAttachments=async()=>({body:{attachments:[{attachmentId:7,revisionId:"new",SubmittedDateTime:null,documentType:"All Conditions",files:[{documentId:9}],conditions:["condition"],comments:""}]}});
 let sent=0;api.submitConditions=async()=>{sent++;return {body:{documentTypes:["All Conditions"],errors:[]}};};
 assert.equal((await runUwmWorkflow(db,env,staff,{...base(),action:"submit-documents",attachments:[{attachmentId:7,revisionId:"old"}]},api)).state,"Rejected");assert.equal(sent,0);
 assert.equal((await runUwmWorkflow(db,env,staff,{...base(),action:"submit-documents",attachments:[{attachmentId:7,revisionId:"new"}]},api)).state,"Acknowledged");assert.equal(sent,1);
});
test("only an administrator can reconcile an uncertain request, preserving evidence and stopping automatic retries",async t=>{
 const {db,api}=setup(t),input=prepare();api.uploadXml=async()=>{throw new Error("timeout");};
 await runUwmWorkflow(db,env,staff,input,api);
 const reconcile={...base(),action:"reconcile-request",requestId:input.id,outcome:"Not applied",evidence:"Checked UWM stage transaction with support; no loan was imported."};
 await assert.rejects(runUwmWorkflow(db,env,{...staff,brokerage:{...staff.brokerage,role:"LO"}},reconcile,api),/administrator/);
 assert.equal((await runUwmWorkflow(db,env,staff,reconcile,api)).state,"Acknowledged");
 assert.equal(db.prepare("SELECT state FROM uwm_live_requests WHERE id=?").get(input.id).state,"Reconciled");
 assert.equal(db.prepare("SELECT state FROM uwm_operations WHERE id=?").get(input.id).state,"Rejected");
 assert.match(db.prepare("SELECT details FROM uwm_request_evidence WHERE requestId=?").get(reconcile.id).details,/no loan was imported/);
 assert.equal((await runUwmWorkflow(db,env,staff,input,api)).state,"Reconciled");
});
test("an active lender request cannot be reconciled while the network call is still in progress",async t=>{
 const {db,api}=setup(t),input=prepare();let release;api.createTransaction=()=>new Promise(resolve=>{release=()=>resolve({transactionId:"inflight",uri:"fixture",fileName:"file.xml"});});
 const pending=runUwmWorkflow(db,env,staff,input,api);
 await new Promise(resolve=>setImmediate(resolve));
 const result=await runUwmWorkflow(db,env,staff,{...base(),action:"reconcile-request",requestId:input.id,outcome:"Not applied",evidence:"Attempted reconciliation before the request finished."},api);
 assert.equal(result.state,"Rejected");assert.equal(db.prepare("SELECT state FROM uwm_live_requests WHERE id=?").get(input.id).state,"Dispatching");
 release();await pending;
});


test("routing must be registered before XML upload and again before commit",async t=>{
 const {db,api,writes}=setup(t),input=prepare();let registered=false,calls=0;
 const upload=api.uploadXml;api.uploadXml=async(...args)=>{assert.equal(registered,true);return upload(...args);};
 const register=async(id,tx)=>{assert.equal(id,input.id);assert.equal(tx,"tx-fixture");registered=true;calls++;};
 assert.equal((await runUwmWorkflow(db,env,staff,input,api,register)).state,"Acknowledged");
 assert.equal((await runUwmWorkflow(db,env,staff,{...base(),action:"commit-import",importId:input.id},api,register)).state,"Acknowledged");assert.equal(calls,2);assert.equal(writes(),4);
});
test("routing registration failure holds the created transaction without uploading or committing",async t=>{
 const {db,api,writes}=setup(t);
 assert.equal((await runUwmWorkflow(db,env,staff,prepare(),api,async()=>{throw new Error("directory unavailable");})).state,"Unknown");
 assert.equal(writes(),1);assert.equal(db.prepare("SELECT transactionId FROM uwm_operations").get().transactionId,"tx-fixture");
});
