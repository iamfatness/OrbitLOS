import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { registerHooks } from "node:module";
registerHooks({resolve(specifier, context, next) {try {return next(specifier,context);} catch(error) {
  if(error.code!=="ERR_MODULE_NOT_FOUND"||!specifier.startsWith("./"))throw error;return next(`${specifier}.ts`,context);
}}});
const {initializeUwmWorkflows,reconcileUwmImportReceipt,runUwmWorkflow,readUwmFile}=await import("../src/lib/uwm-workflows.ts");
const {initializeUwmOperations,correlateUwmImport}=await import("../src/lib/uwm-operations.ts");
const {initializeUwmWebhooks,saveUwmWebhook,parseUwmWebhook}=await import("../src/lib/uwm-webhooks.ts");
const loanId="21499b2a-1e3d-40f7-a752-f9781ec7fc24", brokerageId="11499b2a-1e3d-40f7-a752-f9781ec7fc24";
const staff={name:"Test officer",email:"officer@example.test",brokerage:{id:brokerageId,name:"Test",role:"Admin",pilot:false}};
const env={UWM_BROKERAGE_ID:brokerageId,UWM_USER_ENVIRONMENT:"stage",ORBIT_DEPLOYMENT:"stage",UWM_USER_CLIENT_ID:"fixture",UWM_USER_CLIENT_SECRET:"fixture",UWM_TOKEN_ENCRYPTION_KEY:"a".repeat(64),UWM_STORAGE_ORIGIN:"https://fixture.blob.core.windows.net",UWM_DOCUMENT_STORAGE_ORIGIN:"https://fixture.blob.core.windows.net"};
const base=()=>({id:crypto.randomUUID(),loanId,applicationRevision:1,confirmed:true});
const prepare=()=>({...base(),action:"prepare-import",xml:'<MESSAGE xmlns="http://www.mismo.org/residential/2009/schemas"></MESSAGE>',scan:{entityId:"1",contactId:"2"}});
function importReceipt(db, {environment="stage",transactionId="tx-fixture",state="Completed",loanNumber="1234567890",hour="00",message}={}) {
  const receipt = saveUwmWebhook(db, parseUwmWebhook(environment, "import", JSON.stringify({
    TransactionId: transactionId, LoanNumber: loanNumber, LoanStatus: state, Message: message, LogDateTime: `2026-11-11T${hour}:00:00Z`,
  })));
  return Number(receipt.receiptId);
}
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
 const receipt=importReceipt(db);
 db.prepare("UPDATE applications SET revision=2").run();assert.equal(reconcileUwmImportReceipt(db,receipt),"Completed");
 assert.equal((await runUwmWorkflow(db,env,staff,commit,api)).result.receiptId,receipt);
 const view=await readUwmFile(db,env,staff,{loanId,view:"activity"});assert.equal(view.imports[0].applicationRevision,1);assert.equal(view.imports[0].lenderLoanNumber,"1234567890");
 assert.equal(JSON.stringify(db.prepare("SELECT * FROM uwm_live_requests").all()).includes("sig=private"),false);
});
test("a matching completion settles a lost commit response and allows the next synthetic lender action", async (t) => {
  const { db, api, writes } = setup(t);
  const input = prepare();
  await runUwmWorkflow(db, env, staff, input, api);
  assert.equal(reconcileUwmImportReceipt(db, importReceipt(db, { hour: "01" })), "Needs review");
  const original = api.commitTransaction;
  api.commitTransaction = async () => { await original(); throw new Error("connection lost"); };
  const commit = { ...base(), action: "commit-import", importId: input.id };
  assert.equal((await runUwmWorkflow(db, env, staff, commit, api)).state, "Unknown");
  assert.equal(writes(), 4);
  const submit = { ...base(), action: "submit-documents", attachments: [{ attachmentId: 7, revisionId: "current" }] };
  await assert.rejects(runUwmWorkflow(db, env, staff, submit, api), /needs reconciliation/);
  assert.equal(reconcileUwmImportReceipt(db, importReceipt(db, { environment: "production" })), "Unmatched");
  assert.equal(reconcileUwmImportReceipt(db, importReceipt(db, { transactionId: "another-transaction" })), "Unmatched");
  assert.equal((await runUwmWorkflow(db, env, staff, commit, api)).state, "Unknown");

  const receipt = importReceipt(db);
  assert.equal(reconcileUwmImportReceipt(db, receipt), "Completed");
  const reconciled = await runUwmWorkflow(db, env, staff, commit, api);
  assert.equal(reconciled.state, "Reconciled");
  assert.equal(reconciled.result.receiptId, receipt);
  assert.equal(reconcileUwmImportReceipt(db, importReceipt(db, { hour: "02" })), "Duplicate outcome");
  assert.equal(reconcileUwmImportReceipt(db, importReceipt(db, { loanNumber: "1234567891" })), "Conflicting outcome");
  assert.deepEqual(await runUwmWorkflow(db, env, staff, commit, api), reconciled);
  assert.equal(writes(), 4);
  assert.equal(db.prepare("SELECT state FROM uwm_live_requests WHERE id=?").get(input.id).state, "Acknowledged");

  api.listConditionAttachments = async (number) => {
    assert.equal(number, "1234567890");
    return { body: { attachments: [{ attachmentId: 7, revisionId: "current", SubmittedDateTime: null,
      documentType: "All Conditions", files: [{ documentId: 9 }], conditions: ["condition"], comments: "" }] } };
  };
  let submitted = 0;
  api.submitConditions = async () => { submitted++; return { body: { documentTypes: ["All Conditions"], errors: [] } }; };
  assert.equal((await runUwmWorkflow(db, env, staff, submit, api)).state, "Acknowledged");
  assert.equal(submitted, 1);
});

test("a corrected 1003 replaces only a scanned, uncommitted import", async (t) => {
  const { db, api, writes } = setup(t);
  const first = prepare();
  await runUwmWorkflow(db, env, staff, first, api);
  db.prepare("UPDATE applications SET revision=2").run();
  const read = () => readUwmFile(db, env, staff, { loanId, view: "activity" });
  assert.equal((await read()).imports[0].state, "Superseded");
  const oldCommit = { ...base(), action: "commit-import", importId: first.id };
  await assert.rejects(runUwmWorkflow(db, env, staff, oldCommit, api), /Review the current application/);
  assert.equal(writes(), 3);
  const create = api.createTransaction;
  api.createTransaction = async () => ({ ...await create(), transactionId: "tx-replacement" });
  const replacement = { ...prepare(), applicationRevision: 2 };
  assert.equal((await runUwmWorkflow(db, env, staff, replacement, api)).result.transactionId, "tx-replacement");
  const rows = (await read()).imports;
  const prior = rows.find(row => row.id === first.id);
  assert.deepEqual([prior.applicationRevision, prior.state, prior.transactionId, prior.committed], [1, "Superseded", "tx-fixture", 0]);
  const commit = { ...base(), applicationRevision: 2, action: "commit-import", importId: replacement.id };
  assert.equal((await runUwmWorkflow(db, env, staff, commit, api)).state, "Acknowledged");
  db.prepare("UPDATE applications SET revision=3").run();
  assert.equal((await read()).imports.find(row => row.id === replacement.id).state, "Acknowledged");
  const blocked = await runUwmWorkflow(db, env, staff, { ...prepare(), applicationRevision: 3 }, api);
  assert.match(blocked.error, /needs reconciliation/);
  assert.equal(writes(), 7);
  assert.equal(reconcileUwmImportReceipt(db, importReceipt(db)), "Needs review");
  assert.equal(reconcileUwmImportReceipt(db, importReceipt(db, { transactionId: "tx-replacement" })), "Completed");
});

test("an import callback received during the HTTP call remains authoritative on return", async (t) => {
  for (const state of ["Completed", "NotCompleted"]) await t.test(state, async (subtest) => {
    const { db, api, writes } = setup(subtest);
    const input = prepare();
    await runUwmWorkflow(db, env, staff, input, api);
    const original = api.commitTransaction;
    const expected = state === "Completed" ? "Completed" : "Failed";
    const receipt = importReceipt(db, { state, loanNumber: state === "Completed" ? "1234567890" : null,
      message: state === "NotCompleted" ? "  Correct the sample property ZIP.  " : "Success" });
    api.commitTransaction = async () => {
      const response = await original();
      assert.equal(reconcileUwmImportReceipt(db, receipt), expected);
      if (state === "NotCompleted") throw new Error("connection lost after the callback");
      return response;
    };
    const commit = { ...base(), action: "commit-import", importId: input.id };
    const result = await runUwmWorkflow(db, env, staff, commit, api);
    assert.equal(result.state, "Reconciled");
    assert.equal(result.result.outcome, expected);
    assert.equal(result.result.receiptId, receipt);
    assert.equal(db.prepare("SELECT state FROM uwm_operations").get().state, expected);
    const view = await readUwmFile(db, env, staff, { loanId, view: "activity" });
    assert.equal(view.imports[0].applicationRevision, 1);
    assert.equal(view.imports[0].transactionId, "tx-fixture");
    assert.equal(view.imports[0].failureReason, state === "NotCompleted" ? "Correct the sample property ZIP." : null);
    if (state === "NotCompleted") {
      const duplicate = importReceipt(db, { state, loanNumber: null, hour: "01", message: "Different wording" });
      assert.equal(reconcileUwmImportReceipt(db, duplicate), "Duplicate outcome");
      assert.equal((await readUwmFile(db, env, staff, { loanId, view: "activity" })).imports[0].failureReason, "Correct the sample property ZIP.");
    }
    assert.deepEqual(await runUwmWorkflow(db, env, staff, commit, api), result);
    assert.equal(writes(), 4);
  });
});

test("activity recovers a previously recorded receipt without changing the saved application or calling UWM", async (t) => {
  const { db, api, writes } = setup(t);
  const input = prepare();
  await runUwmWorkflow(db, env, staff, input, api);
  api.commitTransaction = async () => { throw new Error("connection lost"); };
  const commit = { ...base(), action: "commit-import", importId: input.id };
  assert.equal((await runUwmWorkflow(db, env, staff, commit, api)).state, "Unknown");
  const receipt = importReceipt(db);
  assert.equal(correlateUwmImport(db, receipt), "Completed");
  db.prepare("UPDATE applications SET revision=2").run();
  const view = await readUwmFile(db, env, staff, { loanId, view: "activity" });
  assert.equal(view.requests.find((request) => request.id === commit.id).state, "Reconciled");
  assert.equal((await runUwmWorkflow(db, env, staff, commit, api)).result.receiptId, receipt);
  assert.equal(db.prepare("SELECT revision FROM applications").get().revision, 2);
  assert.equal(writes(), 3);
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
test("an assigned processor verifies an uncertain upload using the original held document", async t=>{
  const {db,api}=setup(t);
  await runUwmWorkflow(db,env,staff,prepare(),api);
  db.prepare("UPDATE uwm_operations SET state='Completed',lenderLoanNumber='1234567890'").run();
  db.prepare("INSERT INTO loan_processing VALUES (?,?)").run(loanId,"processor@example.test");
  const processor={...staff,email:"processor@example.test",brokerage:{...staff.brokerage,role:"Processor"}};
  let uploads=0, reads=0;
  api.createConditionUpload=async()=>({documentId:9,fileName:"sample.pdf",sasUri:"https://fixture.example/private?sig=private"});
  api.uploadConditionBytes=async()=>{uploads++;throw new Error("connection lost");};
  const original={...base(),action:"upload-document",fileName:"sample.pdf",content:"YQ=="};
  assert.equal((await runUwmWorkflow(db,env,processor,original,api)).state,"Unknown");
  db.prepare("UPDATE applications SET revision=2").run();
  const lookup={...base(),action:"check-document-request",requestId:original.id};
  api.listConditionDocuments=async()=>({body:{documents:[{documentId:++reads===1?10:9,fileName:"sample.pdf"}]}});
  assert.equal((await runUwmWorkflow(db,env,processor,lookup,api)).state,"Unknown");
  await assert.rejects(runUwmWorkflow(db,env,{...processor,email:"unassigned@example.test"},lookup,api),/unavailable/);
  assert.equal((await runUwmWorkflow(db,env,processor,lookup,api)).state,"Acknowledged");
  assert.equal((await runUwmWorkflow(db,env,processor,lookup,api)).state,"Acknowledged");
  assert.equal(reads,2);
  assert.equal(uploads,1);
  const view=await readUwmFile(db,env,processor,{loanId,view:"activity"});
  const saved=view.requests.find(row=>row.id===original.id);
  assert.deepEqual([saved.applicationRevision,saved.documentId,saved.fileName],[1,9,"sample.pdf"]);
  assert.equal(JSON.stringify(view).includes("sig=private"),false);
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
