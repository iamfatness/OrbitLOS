// Test-only wrapper copied next to the built Worker by prepare-hosted-recovery.mjs.
// Never included by the production entry point or its deployment configuration.
import application, { OrbitWorkspace } from "./index.js";
import { directoryRecoveryCommand, readDirectoryJournal, snapshotDirectory } from "./directory-recovery.mjs";
import { recordFictionalReplacement } from "./recovery-replacement.mjs";
import { sampleDraft, finalStep } from "./recovery-fixtures.mjs";
import { expectedDeadline, reviewPending, remainingReplay, sameDocument } from "./recovery-reconciliation.mjs";

const tables = ["loans", "tasks", "applications", "document_requests", "document_files", "loan_audit", "activity", "workspace_access_history", "realtor_portals", "submissions", "document_acceptances", "document_accepted_files", "closing_plans", "uwm_live_requests", "uwm_operations", "uwm_import_checks", "uwm_request_evidence", "recovery_edit_proofs", "recovery_replay_proofs"];
const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",
  typeof value === "string" ? new TextEncoder().encode(value) : value))).map(byte => byte.toString(16).padStart(2, "0")).join("");
const requireOk = result => { if (result?.error || !result?.message) throw new Error(result?.error || "Fixture mutation failed"); return result; };
function fixtures(env) {
  return [env.FIXTURE_A, env.FIXTURE_B].map((id, index) => {
    const brokerage = { id, name: `Fictional Recovery ${index + 1}`, role: "Admin", pilot: true, accessRevision: 1 };
    const admin = { email: `recovery-admin-${index}@example.test`, name: "Fictional Recovery Admin", brokerage };
    const officer = { email: `recovery-lo-${index}@example.test`, name: "Fictional Recovery LO", brokerage: { ...brokerage, role: "LO" } };
    return { id, scenario: id, loanId: `demo-presenter:${id}:closing`, admin, officer };
  });
}
export class RecoveryWorkspace extends OrbitWorkspace {
  async probeSave(state) {
    if (this.ctx.id.name !== "orbit-demo") throw new Error("Directory only");
    await this.ctx.storage.put("hosted-recovery", state);
  }
  async probeState() { return this.ctx.storage.get("hosted-recovery"); }
  probeDirectory(tenants) {
    if (this.ctx.id.name !== "orbit-demo") throw new Error("Directory only");
    this.ctx.storage.transactionSync(() => {
      for (const item of tenants) {
        this.ctx.storage.sql.exec("INSERT INTO brokerages (id,name,pilot) VALUES (?,?,1)", item.id, item.admin.brokerage.name);
        for (const actor of [item.admin,item.officer]) this.ctx.storage.sql.exec(
          "INSERT INTO brokerage_members (brokerageId,email,name,role,status,accessRevision) VALUES (?,?,?,?,'Active',1)",
          item.id, actor.email, actor.name, actor.brokerage.role);
      }
    });
  }
  probeIdentity() {
    if (![this.env.FIXTURE_A,this.env.FIXTURE_B].includes(this.ctx.id.name)) throw new Error("Fictional tenant only");
    return { tenant: this.ctx.id.name, run: this.env.RECOVERY_RUN, source: this.env.RECOVERY_SOURCE };
  }
  probeProviderRecords(item) {
    this.probeIdentity();
    if(item.id!==this.ctx.id.name)throw new Error("Fictional provider fixture tenant mismatch");
    const revision=this.ctx.storage.sql.exec("SELECT revision FROM applications WHERE loanId=?",item.loanId).one().revision;
    const at=new Date().toISOString(), states=["Prepared","Dispatching","Acknowledged","Unknown"];
    const kinds=["import","float","lock","condition-delivery"];
    // Storage recovery fixtures only. No provider client or network request is used.
    this.ctx.storage.transactionSync(()=>{
      states.forEach((state,index)=>{
        const operation=crypto.randomUUID();
        this.ctx.storage.sql.exec(`INSERT INTO uwm_operations
          (id,loanId,applicationRevision,environment,kind,requestDigest,actor,state,transactionId,receiptId,startedAt,updatedAt)
          VALUES (?,?,?,'stage',?,?,?,?,?,?,?,?)`,operation,item.loanId,revision,kinds[index],String(index+1).repeat(64),item.admin.email,state,
          index===0?"fictional-recovery-transaction":null,index===2?101:null,at,at);
        if(index===0)this.ctx.storage.sql.exec("INSERT INTO uwm_import_checks VALUES (?,?,0,0)",operation,JSON.stringify({fixture:true,ready:false}));
        if(index>0){
          const request=crypto.randomUUID();
          this.ctx.storage.sql.exec(`INSERT INTO uwm_live_requests
            (id,loanId,environment,actor,action,digest,state,result,createdAt,updatedAt)
            VALUES (?,?,'stage',?,?,?,?,?,?,?)`,request,item.loanId,item.admin.email,kinds[index],String(index+1).repeat(64),state,
            index===2?JSON.stringify({fixture:true,receipt:101}):null,at,at);
          this.ctx.storage.sql.exec("INSERT INTO uwm_request_evidence VALUES (?,?,?)",request,revision,JSON.stringify({fixture:true,kind:kinds[index]}));
        }
      });
    });
  }
  async probeCapture() {
    const identity = this.probeIdentity();
    const rows = Object.fromEntries(tables.map(table => [table,this.ctx.storage.sql.exec(`SELECT * FROM ${table} ORDER BY rowid`).toArray()]));
    return { ...identity, hash: await digest(JSON.stringify(rows)), counts: Object.fromEntries(Object.entries(rows).map(([key,value]) => [key,value.length])) };
  }
  probeDirectorySnapshot() {
    if (this.ctx.id.name !== "orbit-demo") throw new Error("Directory only");
    return snapshotDirectory(this.ctx.storage);
  }
  async probeDirectoryPoint() {
    const manifest = await this.probeDirectorySnapshot();
    return { manifest, bookmark: await this.ctx.storage.getCurrentBookmark(),
      run: this.env.RECOVERY_RUN, source: this.env.RECOVERY_SOURCE };
  }
  probeDirectoryArm(point) {
    if (this.ctx.id.name !== "orbit-demo" || point.run !== this.env.RECOVERY_RUN || point.source !== this.env.RECOVERY_SOURCE)
      throw new Error("Directory recovery provenance mismatch");
    return this.ctx.storage.onNextSessionRestoreBookmark(point.bookmark);
  }
  probeDirectoryRestart() {
    if (this.ctx.id.name !== "orbit-demo") throw new Error("Directory only");
    this.ctx.abort("Isolated directory restore restart");
  }
  probeDirectoryRoutes(routes) {
    if (this.ctx.id.name !== "orbit-demo") throw new Error("Directory only");
    const { storage } = this.ctx;
    storage.transactionSync(() => {
      for (const route of routes) {
        if (![this.env.FIXTURE_A, this.env.FIXTURE_B].includes(route.brokerageId)) throw new Error("Fictional routes only");
        storage.sql.exec("INSERT OR IGNORE INTO uwm_transaction_routes VALUES ('stage',?,?,?)",
          route.transactionId, route.brokerageId, route.operationId);
        storage.sql.exec("INSERT OR IGNORE INTO uwm_loan_routes VALUES ('stage',?,?,?)",
          route.loanNumber, route.brokerageId, route.transactionId);
      }
    });
  }
  probeCheckpointBookmark(id,brokerageId) {
    if(this.ctx.id.name!=="orbit-demo")throw new Error("Directory only");
    return this.ctx.storage.sql.exec("SELECT bookmark FROM brokerage_recovery_checkpoints WHERE id=? AND brokerageId=?",id,brokerageId).one().bookmark;
  }
  async probeCheckpoint() {
    const capture = await this.probeCapture();
    return { ...capture, bookmark: await this.ctx.storage.getCurrentBookmark() };
  }
  async probeArm(checkpoint) {
    const identity = this.probeIdentity();
    if (checkpoint.tenant !== identity.tenant || checkpoint.run !== identity.run || checkpoint.source !== identity.source) throw new Error("Checkpoint provenance mismatch");
    return this.ctx.storage.onNextSessionRestoreBookmark(checkpoint.bookmark);
  }
  probeRestart() { this.probeIdentity(); this.ctx.abort("Isolated fictional recovery restart"); }
  probeApplication(loanId) { this.probeIdentity(); return this.ctx.storage.sql.exec("SELECT token,expiresAt FROM applications WHERE loanId=?",loanId).one(); }
  probeRealtor() { this.probeIdentity(); return this.ctx.storage.sql.exec("SELECT token,realtorId FROM realtor_portals").one(); }
  probeDocument(loanId) { this.probeIdentity(); return this.ctx.storage.sql.exec("SELECT id,revision,deadlineRevision,dueOn FROM document_requests WHERE loanId=? AND kind='Homeowners insurance' ORDER BY id LIMIT 1",loanId).one(); }
  async probeLenderEvidence(item,origin) {
    this.probeIdentity();
    if (item.id!==this.ctx.id.name) throw new Error("Fictional tenant mismatch");
    const write=async input=>requireOk(await this.write({...input,loanId:item.loanId},item.admin));
    const link=this.probeApplication(item.loanId);
    const initial=this.borrower({type:"read",token:link.token},true);
    if (!initial.application) throw new Error(initial.error||"Fictional 1003 unavailable");
    if (!initial.application.submittedAt) {
      const submitted=this.borrower({type:"submit",token:link.token,revision:initial.application.revision,step:finalStep,draft:sampleDraft},true);
      if (submitted.error || !submitted.application?.submittedAt) throw new Error(submitted.error||"Fictional 1003 did not submit");
      await write({type:"reviewApplication",revision:submitted.application.revision});
    }
    const previous=this.ctx.storage.sql.exec("SELECT targetDate FROM closing_plans WHERE loanId=?",item.loanId).toArray()[0]?.targetDate??null;
    await write({type:"saveClosingTarget",previous,targetDate:"2030-02-10"});
    await write({type:"submission",lender:"Fictional Recovery Wholesale",externalId:"RECOVERY-FILE-01",status:"In underwriting"});
    const read=()=>this.read(item.admin);
    const submissionId=read().submissions.find(file=>file.loanId===item.loanId&&file.externalId==="RECOVERY-FILE-01").id;
    const conditionId=crypto.randomUUID();
    await write({type:"saveManualCondition",submissionId,conditionId,revision:0,category:"Income",description:"Review the fictional recovery pay stub.",owner:item.admin.name});
    await write({type:"requestDocument",kind:"Pay stub",instructions:"Provide the fictional recovery pay stub.",condition:{submissionId,conditionId}});
    const post=async(path,input)=>{
      const response=await application.fetch(new Request(`${origin}/api/borrower-documents/${path}`,{method:"POST",headers:{Origin:origin,"Content-Type":"application/json"},body:JSON.stringify({...input,token:link.token})}),this.env,this.ctx);
      const result=await response.json();
      if(!response.ok)throw new Error(result.error||"Fictional PDF route failed");
      return result;
    };
    const code=await post("verify",{type:"sendCode"});
    const verified=await post("verify",{type:"verifyCode",code:code.demoCode});
    let uploads=0;
    const replacement=await recordFictionalReplacement({read,write,borrower:async input=>{
      if(uploads++)await new Promise(resolve=>setTimeout(resolve,1100));
      return post("upload",{requestId:input.requestId,revision:input.revision,session:verified.session,fixture:uploads===1?"clean":"replacement"});
    },submissionId,conditionId});
    const requestId=read().documentRequests.find(request=>request.conditionId===conditionId).id;
    const accepted=this.ctx.storage.sql.exec("SELECT revision FROM document_acceptances WHERE requestId=? ORDER BY revision",requestId).toArray().map(row=>row.revision);
    if (JSON.stringify(accepted)!==JSON.stringify(replacement.document.evidence.acceptedRevisions)) throw new Error("Acceptance history does not match receipt fixture");
    if (this.ctx.storage.sql.exec("SELECT count(*) AS total FROM loan_audit WHERE loanId=?",item.loanId).one().total<1) throw new Error("Loan audit fixture is empty");
    const files=[];
    for(const row of this.ctx.storage.sql.exec("SELECT revision,objectId FROM document_accepted_files WHERE requestId=? ORDER BY revision",requestId).toArray()){
      const objectKey=`${item.id}/${row.objectId}.pdf`;
      const object=await this.env.DOCUMENTS.get(objectKey);
      if(!object)throw new Error("Accepted PDF was removed during replacement");
      files.push({requestId,acceptedRevision:row.revision,objectId:row.objectId,objectKey,hash:await digest(await object.arrayBuffer())});
    }
    if(files.length!==2||files[0].hash===files[1].hash)throw new Error("Expected distinct prior and replacement PDFs");
    return {requestId,submissionId,conditionId,replacement,files};
  }
  probeVerifyLenderEvidence(item,evidence) {
    this.probeIdentity();
    const state=this.read(item.admin);
    const request=state.documentRequests.find(row=>row.id===evidence.requestId);
    const condition=state.submissions.find(row=>row.id===evidence.submissionId)?.conditions.find(row=>row.id===evidence.conditionId);
    const accepted=this.ctx.storage.sql.exec("SELECT revision FROM document_acceptances WHERE requestId=? ORDER BY revision",evidence.requestId).toArray().map(row=>row.revision);
    const expected=evidence.replacement;
    if (request?.status!=="Accepted"||request.revision!==expected.document.evidence.revision||JSON.stringify(accepted)!==JSON.stringify(expected.document.evidence.acceptedRevisions)) throw new Error("Restored accepted revisions differ");
    if (!condition?.satisfiedAt||condition.satisfiedAt!==expected.condition.evidence.clearance.at||condition.manual.confirmedDelivery!==expected.condition.evidence.clearance.reference) throw new Error("Restored clearance differs");
    for (const receipt of expected.condition.evidence.receipts) {
      if (!condition.manual.deliveries.some(row=>row.reference===receipt.reference&&row.documentRevision===receipt.documentRevision)) throw new Error("Restored lender receipt differs");
    }
    return {acceptedRevisions:accepted.length,lenderReceipts:condition.manual.deliveries.length};
  }
  async probeReviewPending(receipt) {
    const identity = this.probeIdentity();
    const current = this.probeDocument(receipt.command.loanId);
    return { classification: reviewPending(receipt,current,identity), observed: current };
  }
  async probeReplayBatch(receipts, actor) {
    const identity = this.probeIdentity();
    const current = this.probeDocument(receipts[0].command.loanId);
    for (const receipt of remainingReplay(receipts,current,identity)) {
      requireOk(await this.write(receipt.command,actor));
      if (!sameDocument(this.probeDocument(receipt.command.loanId),receipt.after)) throw new Error("Receipt replay differs from reviewed state");
    }
  }
  async probeBytes(evidence) {
    this.probeIdentity();
    const row = this.ctx.storage.sql.exec("SELECT objectId FROM document_accepted_files WHERE requestId=? AND revision=?",evidence.requestId,evidence.acceptedRevision).one();
    if (row.objectId !== evidence.objectId) return false;
    const object = await this.env.DOCUMENTS.get(evidence.objectKey);
    return !!object && await digest(await object.arrayBuffer()) === evidence.hash;
  }
  async probeCleanup(evidence) {
    const identity = this.probeIdentity();
    if (evidence.objectKey!==`${identity.tenant}/${evidence.objectId}.pdf`) throw new Error("Fixture object mismatch");
    await this.env.DOCUMENTS.delete(evidence.objectKey);
  }
  async probeByteFailures(evidence) {
    const identity = this.probeIdentity();
    if (evidence.objectKey!==`${identity.tenant}/${evidence.objectId}.pdf`) throw new Error("Fixture object mismatch");
    const object = await this.env.DOCUMENTS.get(evidence.objectKey);
    if (!object) throw new Error("Sample document unavailable before negative checks");
    const original = await object.arrayBuffer();
    try {
      await this.env.DOCUMENTS.delete(evidence.objectKey);
      if (await this.probeBytes(evidence)) throw new Error("Missing bytes passed reconciliation");
      await this.env.DOCUMENTS.put(evidence.objectKey,"Deliberately corrupted fictional bytes");
      if (await this.probeBytes(evidence)) throw new Error("Corrupted bytes passed reconciliation");
    } finally { await this.env.DOCUMENTS.put(evidence.objectKey,original); }
    if (!await this.probeBytes(evidence)) throw new Error("Sample bytes not restored after negative checks");
  }
  probeProtectedEvidence(change) {
    this.probeIdentity();
    this.ctx.storage.sql.exec("UPDATE uwm_operations SET state=? WHERE kind='import'",change?"Unknown":"Prepared");
  }

}
async function command(action, env, origin, ctx) {
  const tenants = fixtures(env), [a,b] = tenants;
  const directory = env.WORKSPACE.getByName("orbit-demo"), target = env.WORKSPACE.getByName(a.id), other = env.WORKSPACE.getByName(b.id);
  let state = await directory.probeState();
  const journal = await readDirectoryJournal(env);
  if (action === "status" && journal && state?.phase !== "cleaned") return { ...journal.evidence, phase:journal.phase, run:env.RECOVERY_RUN, source:env.RECOVERY_SOURCE };
  if (action.startsWith("directory")) return directoryRecoveryCommand(action,{env,ctx,origin,application,directory,target,other,state,tenants,journal});
  if (journal && action !== "cleanup") throw new Error("Directory recovery is in progress");
  if (action === "status") return {...state?.result,phase:state?.phase ?? "new",run:env.RECOVERY_RUN,source:env.RECOVERY_SOURCE};
  if (action === "initialize") {
    if (state) throw new Error("Run already initialized");
    await directory.probeDirectory(tenants);
    for (const item of tenants) {
      const workspace = env.WORKSPACE.getByName(item.id);
      requireOk(await workspace.loadPilot(item.admin,{type:"loadPilotScenario",id:item.scenario,previousId:null,officerEmail:item.officer.email,presenter:true},item.officer));
      requireOk(await workspace.write({type:"startApplication",loanId:item.loanId},item.officer));
      const doc = await workspace.probeDocument(item.loanId);
      requireOk(await workspace.write({type:"setDocumentDeadline",loanId:item.loanId,requestId:doc.id,revision:doc.revision,deadlineRevision:doc.deadlineRevision,dueOn:"2030-01-01"},item.officer));
    }
    const lenderEvidence=await target.probeLenderEvidence(a,origin);
    state = { phase: "initialized", run: env.RECOVERY_RUN, source: env.RECOVERY_SOURCE,lenderEvidence,
      link: await target.probeApplication(a.loanId), realtor: await target.probeRealtor() };
    await target.probeVerifyLenderEvidence(a,lenderEvidence);
    await target.probeProviderRecords(a);
    const session = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll("+","-").replaceAll("/","_").replace(/=+$/, "");
    const sessionHash = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(session))))).replaceAll("+","-").replaceAll("/","_").replace(/=+$/, "");
    await directory.createStaffSession(sessionHash,{email:a.officer.email,name:a.officer.name},Date.now()+3600000,Date.now());
    state.session = session;
    await directory.probeSave(state);
    return { phase: state.phase, run: state.run, source: state.source };
  }
  if (!state || state.run !== env.RECOVERY_RUN || state.source !== env.RECOVERY_SOURCE) throw new Error("Run provenance unavailable");
  if (action === "checkpoint" && state.phase === "initialized") {
    let view=await directory.manageWorkspaceMaintenance(a.admin);
    view=await directory.manageWorkspaceMaintenance(a.admin,{type:"pause",revision:view.revision,reason:"Create isolated product checkpoint",confirmation:a.admin.brokerage.name});
    const input={action:"create",id:crypto.randomUUID(),revision:view.revision,label:"Before isolated restore acceptance"};
    const saved=await directory.workspaceCheckpoints(a.admin,input);
    const repeated=await directory.workspaceCheckpoints(a.admin,input);
    if(saved.checkpoint.id!==repeated.checkpoint.id || saved.view.revision!==repeated.view.revision)throw new Error("Checkpoint retry duplicated a save");
    state.directoryEndedSession=crypto.randomUUID();
    await directory.createStaffSession(state.directoryEndedSession,a.admin,Date.now()+3600000,Date.now());
    state.directoryOld=await directory.probeDirectoryPoint();
    state.productCheckpoint=saved.checkpoint;
    state.checkpoint={...await target.probeCapture(),bookmark:await directory.probeCheckpointBookmark(saved.checkpoint.id,a.id)};
    const compare=await directory.workspaceCheckpoints(a.admin,{action:"compare",id:saved.checkpoint.id,revision:saved.view.revision});
    if(compare.comparison.changed.length || compare.comparison.schemaChanged || compare.comparison.kvChanged)throw new Error("New product checkpoint differs from capture");
    view=await directory.manageWorkspaceMaintenance(a.admin,{type:"review",revision:saved.view.revision,review:"Captured complete checkpoint and verified immediate comparison.",checks:[true,true,true]});
    view=await directory.manageWorkspaceMaintenance(a.admin,{type:"reopen",revision:view.revision,confirmation:a.admin.brokerage.name});
    if(view.mode!=="Open")throw new Error("Checkpoint fixture failed to reopen");
    state.otherBefore = await other.probeCapture();
    let refused = false;
    try { await other.probeArm(state.checkpoint); } catch { refused = true; }
    if (!refused) throw new Error("Cross-tenant restore was not refused");
    state.phase = "checkpointed";
  } else if (action === "prepareChange" && state.phase === "checkpointed") {
    const before = await target.probeDocument(a.loanId);
    state.receipt = {tenant:a.id,run:state.run,source:state.source,status:"pending",before,
      command:{type:"setDocumentDeadline",loanId:a.loanId,requestId:before.id,revision:before.revision,deadlineRevision:before.deadlineRevision,dueOn:"2030-02-03"}};
    await directory.probeSave(state);
    requireOk(await target.write(state.receipt.command,a.admin));
    state.receipt.after = await target.probeDocument(a.loanId);
    state.receipt.status = "acknowledged";
    await directory.probeSave(state);
    const pendingBefore = state.receipt.after;
    state.interrupted = {tenant:a.id,run:state.run,source:state.source,status:"pending",before:pendingBefore,
      command:{type:"setDocumentDeadline",loanId:a.loanId,requestId:pendingBefore.id,revision:pendingBefore.revision,
        deadlineRevision:pendingBefore.deadlineRevision,dueOn:"2030-02-10"}};
    state.phase = "prepared";
    await directory.probeSave(state);
    if ((await target.probeReviewPending(state.interrupted)).classification !== "not-observed") throw new Error("Undispatched edit was inferred as committed");
    let refused = false;
    try { await target.probeReplayBatch([state.interrupted],a.admin); } catch { refused = true; }
    if (!refused) throw new Error("Unreviewed edit was replayed");
  } else if (action === "interrupt" && state.phase === "prepared") {
    requireOk(await target.write(state.interrupted.command,a.admin));
    // Deliberately lose the outer acknowledgment after the normal application
    // command commits. Directory intent remains pending across the restart.
    throw new Error("Simulated lost acknowledgment");
  } else if (action === "restartInterrupted" && state.phase === "prepared") {
    try { await target.probeRestart(); } catch { /* Reconciliation proves persistence. */ }
    state.phase = "interrupted";
  } else if (action === "reconcile" && state.phase === "interrupted") {
    const review = await target.probeReviewPending(state.interrupted);
    if (review.classification !== "matches-intended-revision") throw new Error("Interrupted write requires manual reconciliation");
    state.interrupted.after = expectedDeadline(state.interrupted);
    state.interrupted.review = {decision:"preserve-observed",by:a.admin.email,at:new Date().toISOString(),observed:review.observed};
    state.interrupted.status = "reconciled";
    state.phase = "reconciled";
  } else if (action === "change" && state.phase === "reconciled") {
    const before = state.receipt.before;
    const stale = await target.write({...state.receipt.command,deadlineRevision:before.deadlineRevision+5,dueOn:"2030-03-04"},a.admin);
    if (!stale.error) throw new Error("Conflicting deadline change was accepted");
    requireOk(await target.write({type:"revokeApplication",loanId:a.loanId,token:state.link.token},a.officer));
    requireOk(await target.write({type:"revokeRealtorPortal",realtorId:state.realtor.realtorId},a.admin));
    const changed = await directory.manage(a.admin,[],{type:"revoke",email:a.officer.email});
    if (changed.error) throw new Error(changed.error);
    const doc = await other.probeDocument(b.loanId);
    requireOk(await other.write({type:"setDocumentDeadline",loanId:b.loanId,requestId:doc.id,revision:doc.revision,deadlineRevision:doc.deadlineRevision,dueOn:"2030-01-02"},b.officer));
    state.otherAfter = await other.probeCapture();
    if (state.otherBefore.hash === state.otherAfter.hash || (await target.probeCapture()).hash === state.checkpoint.hash) throw new Error("Fixture changes were not observable");
    const paused=await directory.manageWorkspaceMaintenance(a.admin,{type:"pause",revision:(await directory.manageWorkspaceMaintenance(a.admin)).revision,
      reason:"Isolated restore rehearsal: preserve review decisions across tenant recovery.",confirmation:a.admin.brokerage.name});
    if(paused.error || paused.mode!=="Paused")throw new Error(paused.error||"Fixture did not pause");
    const changedComparison=await directory.workspaceCheckpoints(a.admin,{action:"compare",id:state.productCheckpoint.id,revision:paused.revision});
    if(!changedComparison.comparison.changed.some(table=>table.name==="document_requests"&&table.before===table.now))throw new Error("Same-count deadline change was not detected");
    const inspected=await target.inspectWorkspaceMaintenance(a.admin,{revision:paused.revision,documents:0,requests:0});
    const evidence=inspected.inspection?.documents.items.find(item=>item.recordId===a.loanId && item.availability==="Available");
    if(!evidence)throw new Error(inspected.error||"Retained fixture PDF was not inspectable");
    const saved=await directory.saveMaintenanceDecision(a.admin,{id:crypto.randomUUID(),revision:paused.revision,documents:0,requests:0,
      reference:evidence.reference,fingerprint:evidence.fingerprint,outcome:"Preserve observed result",
      note:"Both fictional accepted PDFs remain stored. Preserve this evidence and verify the restored record before reopening."});
    if(saved.error || !saved.decision)throw new Error(saved.error||"Fixture decision not saved");
    if(inspected.inspection.requests.total!==7)throw new Error("Populated provider inspection missed fixture work");
    state.maintenance={revision:saved.view.revision,cycle:saved.view.startedAt,decision:saved.decision,
      requests:inspected.inspection.requests.items.map(item=>({reference:item.reference,state:item.state,fingerprint:item.fingerprint}))};
    const editInspection=await target.inspectWorkspaceRecoveryEdits(a.admin,{revision:saved.view.revision,offset:0});
    state.internalEdits=editInspection.items.filter(item=>item.command.loanId===a.loanId && ["2030-02-03","2030-02-10"].includes(item.command.dueOn));
    if(state.internalEdits.length!==2 || state.internalEdits.some(item=>item.state!=="Recorded"||!item.proof||!item.sourceProof))
      throw new Error("Actual document edits did not retain both recovery receipts");
    let gated=false;try{await target.read(a.admin);}catch{gated=true;}
    if(!gated)throw new Error("Normal workspace read remained open before restore");
    // Product restores refuse rewinding lender operation evidence. Prove the
    // refusal with an isolated, reversible fixture mutation, then restore the
    // original evidence before testing ordinary workspace recovery.
    await target.probeProtectedEvidence(true);
    const blocked=await directory.workspaceRestore(a.admin,{action:"preview",checkpointId:state.productCheckpoint.id,revision:saved.view.revision});
    if(!blocked.preview.blockers.some(message=>message.includes("Lender evidence")))throw new Error("Protected lender evidence was not blocked");
    await target.probeProtectedEvidence(false);
    state.phase = "changed";
  } else if (action === "arm" && state.phase === "changed") {
    const view=await directory.manageWorkspaceMaintenance(a.admin);
    const preview=await directory.workspaceRestore(a.admin,{action:"preview",checkpointId:state.productCheckpoint.id,revision:view.revision});
    if(preview.preview.blockers.length)throw new Error(preview.preview.blockers.join(" "));
    if(!preview.preview.comparison.impact?.total)throw new Error("Restore preview did not name affected business records");
    const input={action:"start",id:crypto.randomUUID(),checkpointId:state.productCheckpoint.id,revision:view.revision,
      fingerprint:preview.preview.fingerprint,confirmation:a.admin.brokerage.name,checks:[true,true,true],note:"Hosted owner acceptance of exact checkpoint and document evidence."};
    const reserved=await directory.workspaceRestore(a.admin,input),repeated=await directory.workspaceRestore(a.admin,input);
    if(reserved.job.id!==repeated.job.id||reserved.view.revision!==repeated.view.revision)throw new Error("Restore reservation retry duplicated work");
    state.restoreJob=reserved.job;state.restoreStartedAt=Date.now();
    const blocked=await directory.manageWorkspaceMaintenance(a.admin,{type:"review",revision:reserved.view.revision,checks:[true,true,true],review:"This must be blocked while restore is pending."});
    if(!blocked.error)throw new Error("Pending restore allowed reopening review");
    const source=await directory.authorizedWorkspaceRestore(a.admin,reserved.job.id);
    if(!source.source.bookmark||source.job.sourceCheckpointId!==reserved.job.id)throw new Error("Before-restore checkpoint not durably retained");
    state.phase="armed";
    await directory.probeSave(state);
    try{await directory.workspaceRestore(a.admin,{action:"resume",id:reserved.job.id});}catch{/* Arming aborts the target RPC. Verify is authoritative. */}
  } else if (action === "restart" && state.phase === "armed") {
    try { await target.probeRestart(); } catch { /* Abort is expected, but only verify can prove restoration. */ }
    state.phase = "restarted";
  } else if (action === "verify" && state.phase === "restarted") {
    const verified=await directory.workspaceRestore(a.admin,{action:"resume",id:state.restoreJob.id});
    if(verified.job.state!=="Restored")throw new Error("Product restore was not verified");
    const repeated=await directory.workspaceRestore(a.admin,{action:"resume",id:state.restoreJob.id});
    if(repeated.view.revision!==verified.view.revision)throw new Error("Repeated restore verification duplicated history");
    const recovered = await target.probeCapture(), unaffected = await other.probeCapture();
    if (recovered.hash !== state.checkpoint.hash) throw new Error("Target state differs from checkpoint");
    if (unaffected.hash !== state.otherAfter.hash) throw new Error("Other brokerage changed during recovery");
    let paused=await directory.manageWorkspaceMaintenance(a.admin);
    if(paused.error || paused.mode!=="Paused" || paused.revision<=state.maintenance.revision || paused.startedAt!==state.maintenance.cycle)
      throw new Error("Tenant restore changed directory maintenance state");
    const comparison=await directory.workspaceCheckpoints(a.admin,{action:"compare",id:state.productCheckpoint.id,revision:paused.revision});
    if(comparison.comparison.changed.length || comparison.comparison.schemaChanged || comparison.comparison.kvChanged)throw new Error("Restored full database differs from product checkpoint manifest");
    state.checkpointComparison={tables:comparison.comparison.unchanged,changed:0,schemaChanged:false,kvChanged:false,alarmChanged:comparison.comparison.alarmChanged};
    let gated=false;try{await target.read(a.admin);}catch{gated=true;}
    if(!gated)throw new Error("Restored tenant reopened without review");
    const inspected=await target.inspectWorkspaceMaintenance(a.admin,{revision:paused.revision,documents:0,requests:0});
    const evidence=inspected.inspection?.documents.items.find(item=>item.reference===state.maintenance.decision.reference);
    if(!evidence || JSON.stringify(evidence.decisions[0])!==JSON.stringify(state.maintenance.decision))
      throw new Error("Review decision did not survive tenant restore");
    if(evidence.fingerprint!==state.maintenance.decision.fingerprint)throw new Error("Retained PDF metadata changed after restore");
    const requests=inspected.inspection.requests.items.map(item=>({reference:item.reference,state:item.state,fingerprint:item.fingerprint}));
    if(JSON.stringify(requests)!==JSON.stringify(state.maintenance.requests))throw new Error("Provider request state or evidence changed after restore");
    if(recovered.counts.uwm_operations!==4 || recovered.counts.uwm_live_requests!==3 || recovered.counts.uwm_import_checks!==1 || recovered.counts.uwm_request_evidence!==3)
      throw new Error("Populated provider records did not restore");
    const editInspection=await target.inspectWorkspaceRecoveryEdits(a.admin,{revision:paused.revision,offset:0});
    for(const original of state.internalEdits){
      const restored=editInspection.items.find(item=>item.id===original.id);
      if(!restored || restored.state!=="Recorded" || JSON.stringify(restored.proof)!==JSON.stringify(original.proof) || restored.sourceProof || restored.canConfirm)
        throw new Error("Tenant restore lost directory receipt or retained a rolled-back atomic proof");
      if(original.command.dueOn==="2030-02-03" && restored.finding!=="Original revision present")
        throw new Error("Restored edit did not expose its original revision");
    }
    for(const dueOn of ["2030-02-03","2030-02-10"]){
      const page=await target.inspectWorkspaceRecoveryEdits(a.admin,{revision:paused.revision,offset:0});
      const item=page.items.find(edit=>edit.command.dueOn===dueOn);
      if(!item?.canReplay)throw new Error("Confirmed original edit is not eligible for operator recovery");
      const result=await directory.recoverWorkspaceEdit(a.admin,{revision:paused.revision,offset:0,id:item.id,fingerprint:item.fingerprint,
        note:"Isolated owner acceptance: recover the exact confirmed deadline after tenant restoration."});
      const after=await target.probeCapture();
      const repeat=await directory.recoverWorkspaceEdit(a.admin,{id:item.id,resume:true});
      if(JSON.stringify(result.view)!==JSON.stringify(repeat.view)||(await target.probeCapture()).hash!==after.hash)
        throw new Error("Repeated product recovery changed saved work or directory history");
      paused=result.view;
    }
    const refused=await directory.manageWorkspaceMaintenance(a.admin,{type:"reopen",revision:paused.revision,confirmation:a.admin.brokerage.name});
    if(!refused.error)throw new Error("Restored tenant reopened without a new review");
    const reviewed=await directory.manageWorkspaceMaintenance(a.admin,{type:"review",revision:paused.revision,checks:[true,true,true],
      review:"Isolated checkpoint, retained PDFs and directory decision verified. Reopening only for the remaining fictional acceptance checks."});
    if(reviewed.error)throw new Error(reviewed.error);
    const opened=await directory.manageWorkspaceMaintenance(a.admin,{type:"reopen",revision:reviewed.revision,confirmation:a.admin.brokerage.name});
    if(opened.error || opened.mode!=="Open")throw new Error(opened.error||"Reviewed fixture failed to reopen");
    const lenderEvidence=await target.probeVerifyLenderEvidence(a,state.lenderEvidence);
    if (await directory.brokerageForPortal(state.link.token)) throw new Error("Revoked borrower link reopened");
    if (await directory.leadOwner(a.id,a.officer.email,[])) throw new Error("Revoked staff membership reopened");
    const portalResponse = await application.fetch(new Request(`${origin}/api/demo-application`, { method: "POST", headers: { Origin: origin, "Content-Type":"application/json" }, body:JSON.stringify({type:"read",token:state.link.token}) }),env,ctx);
    await portalResponse.arrayBuffer();
    if (portalResponse.status !== 404) throw new Error("Normal borrower route did not reject revoked link");
    const realtorResponse = await application.fetch(new Request(`${origin}/api/realtor-referrals`, {method:"POST",headers:{Origin:origin,"Content-Type":"application/json"},body:JSON.stringify({type:"read",token:state.realtor.token})}),env,ctx);
    await realtorResponse.arrayBuffer();
    if (realtorResponse.status !== 404) throw new Error("Normal realtor route did not reject revoked link");
    const staffResponse = await application.fetch(new Request(`${origin}/workspace?brokerage=${a.id}`, {headers:{Cookie:`__Host-orbit-session=${state.session}`}}),env,ctx);
    await staffResponse.arrayBuffer();
    if (staffResponse.status !== 403) throw new Error("Normal workspace route did not reject revoked staff");
    for(const file of state.lenderEvidence.files){
      if (!await target.probeBytes(file)) throw new Error("Restored document metadata has missing or different bytes");
      await target.probeByteFailures(file);
    }
    const wrong = await target.write({type:"startApplication",loanId:a.loanId},b.officer);
    if (!wrong.error) throw new Error("Foreign brokerage write accepted");
    state.phase = "verified";
    state.result = { run: state.run, source: state.source, artifactSha256:env.RECOVERY_ARTIFACT, phase: state.phase, restoreAndVerifyMs: Date.now()-state.restoreStartedAt,
      restoredCounts: recovered.counts, crossTenantCheckpointRejected: true, otherBrokeragePreserved: true, revokedBorrowerBlocked: true,
      revokedOfficerBlocked: true, revokedRealtorBlocked:true, documentBytesMatched: true, missingBytesRejected:true, corruptedBytesRejected:true,
      productCheckpoint:true,productRestore:true,protectedLenderEvidenceBlocked:true,sourceCheckpointRetained:true,restoreRetryUnchanged:true,pendingRestoreBlocksReview:true,checkpointComparison:state.checkpointComparison,operatorReplayApplied:2,operatorRepeatUnchanged:true,
      internalEditReceiptsSurvivedRestore:state.internalEdits.length,rolledBackAtomicProofsAbsent:true,originalRevisionDetected:true,
      syntheticProviderStatesPreserved:true,providerEvidenceFingerprintsPreserved:true,
      maintenancePauseSurvivedRestore:true,decisionSurvivedTenantRestore:true,unreviewedReopenRejected:true,reviewedReopenSucceeded:true,
      foreignWriteRejected: true, undoBookmarkRecorded: !!state.undoBookmark,acceptedRevisionsPreserved:lenderEvidence.acceptedRevisions,
      lenderReceiptsPreserved:lenderEvidence.lenderReceipts,historicalPdfBytesMatched:state.lenderEvidence.files.length,manualClearancePreserved:true,loanAuditPreserved:recovered.counts.loan_audit>0 };
  } else if (action === "replay" && state.phase === "verified") {
    for (const invalid of [{...state.receipt,status:"pending"},{...state.receipt,tenant:b.id}]) {
      let refused=false;
      try {await target.probeReplayBatch([invalid],a.admin);} catch {refused=true;}
      if (!refused) throw new Error("Invalid recovery receipt was accepted");
    }
    // Product recovery already applied both confirmed edits in order.
    // The legacy full-chain reconciliation must now recognize that outcome.
    await target.probeReplayBatch([state.receipt,state.interrupted],a.admin);
    state.replayed = await target.probeCapture();
    if (state.replayed.counts.activity !== state.checkpoint.counts.activity+2 || state.replayed.counts.workspace_access_history !== state.checkpoint.counts.workspace_access_history+2) throw new Error("Replay did not record exactly two history events");
    state.phase="replayed";
  } else if (action === "restartReplay" && state.phase === "replayed") {
    try {await target.probeRestart();} catch { /* Next command proves persistence. */ }
    state.phase="replayRestarted";
  } else if (action === "verifyReplay" && state.phase === "replayRestarted") {
    await target.probeReplayBatch([state.receipt,state.interrupted],a.admin);
    if ((await target.probeCapture()).hash !== state.replayed.hash) throw new Error("Repeat replay changed history or work");
    if ((await other.probeCapture()).hash !== state.otherAfter.hash) throw new Error("Replay changed the other brokerage");
    state.phase="replayVerified";
    Object.assign(state.result,{acknowledgedEditReplayed:true,repeatReplayAfterRestartUnchanged:true,pendingReceiptRejected:true,foreignReceiptRejected:true,undispatchedEditNotAcknowledged:true,
      lostAcknowledgmentReconciledAfterRestart:true,reviewedEditReplayed:true,operatorRecoveredChain:true});
  } else if (action === "cleanup" && state.phase === "replayVerified" && journal?.phase === "directoryResumed") {
    for(const file of state.lenderEvidence.files)await target.probeCleanup(file);
    state.phase = "cleaned";
    Object.assign(state.result,journal.evidence);

  } else throw new Error("Command does not match recovery phase");
  await directory.probeSave(state);
  if (action === "cleanup") await env.DOCUMENTS.delete([
    "directory-recovery-journal",`operations/directory-recovery/evidence/${journal.evidenceId}.json`,
  ]);
  return {...state.result,phase:state.phase,run:state.run};
}
const recoveryWorker = {
  async fetch(request, env, ctx) {
    if (!env.RECOVERY_TOKEN || request.headers.get("Authorization") !== `Bearer ${env.RECOVERY_TOKEN}`) return new Response("Not found",{status:404});
    const url = new URL(request.url);
    if (url.pathname === "/__recovery" && request.method === "POST") {
      if (Number(request.headers.get("Content-Length")||0)>128) return new Response("Too large",{status:413});
      const action = await request.text();
      if (!["status","initialize","checkpoint","prepareChange","interrupt","restartInterrupted","reconcile","change","arm","restart","verify","replay","restartReplay","verifyReplay","directoryPrepare","directoryArmOld","directoryRejectOld","directoryRecover","directoryVerify","directoryResume","cleanup"].includes(action)) return new Response("Unknown step",{status:400});
      try { return Response.json(await command(action,env,url.origin,ctx),{headers:{"Cache-Control":"no-store"}}); }
      catch(error) { return Response.json({error:error.message},{status:409,headers:{"Cache-Control":"no-store"}}); }
    }
    // Rehearsal routing is closed; no anonymous app or arbitrary RPC surface.
    return new Response("Not found",{status:404});
  },
};

export default recoveryWorker;
