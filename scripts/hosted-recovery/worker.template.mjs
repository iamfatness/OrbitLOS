// Test-only wrapper copied next to the built Worker by prepare-hosted-recovery.mjs.
// Never included by the production entry point or its deployment configuration.
import application, { OrbitWorkspace } from "./index.js";
import { recordFictionalReplacement } from "./recovery-replacement.mjs";
import { sampleDraft, finalStep } from "./recovery-fixtures.mjs";

const tables = ["loans", "tasks", "applications", "document_requests", "document_files", "loan_audit", "activity", "workspace_access_history", "realtor_portals", "submissions", "document_acceptances", "document_accepted_files", "closing_plans", "uwm_live_requests", "uwm_import_checks", "uwm_request_evidence"];
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
          "INSERT INTO brokerage_members (brokerageId,email,name,role,status) VALUES (?,?,?,?,'Active')",
          item.id, actor.email, actor.name, actor.brokerage.role);
      }
    });
  }
  probeIdentity() {
    if (![this.env.FIXTURE_A,this.env.FIXTURE_B].includes(this.ctx.id.name)) throw new Error("Fictional tenant only");
    return { tenant: this.ctx.id.name, run: this.env.RECOVERY_RUN, source: this.env.RECOVERY_SOURCE };
  }
  async probeCapture() {
    const identity = this.probeIdentity();
    const rows = Object.fromEntries(tables.map(table => [table,this.ctx.storage.sql.exec(`SELECT * FROM ${table} ORDER BY rowid`).toArray()]));
    return { ...identity, hash: await digest(JSON.stringify(rows)), counts: Object.fromEntries(Object.entries(rows).map(([key,value]) => [key,value.length])) };
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
  async probeReplay(receipt, actor) {
    const identity = this.probeIdentity();
    if (receipt.tenant !== identity.tenant || receipt.run !== identity.run || receipt.source !== identity.source || receipt.status !== "acknowledged") throw new Error("Unverified recovery receipt");
    const current = this.probeDocument(receipt.command.loanId);
    if (![receipt.before,receipt.after].some(expected => JSON.stringify(expected) === JSON.stringify(current))) throw new Error("Receipt conflicts with restored document");
    requireOk(await this.write(receipt.command,actor));
    if (JSON.stringify(this.probeDocument(receipt.command.loanId)) !== JSON.stringify(receipt.after)) throw new Error("Receipt replay differs from acknowledged state");
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
  probeDamage(loanId) {
    const identity = this.probeIdentity();
    if (loanId !== `demo-presenter:${identity.tenant}:closing`) throw new Error("Fictional loan only");
    this.ctx.storage.sql.exec("DELETE FROM loans WHERE id=?",loanId);
  }
}
async function command(action, env, origin, ctx) {
  const tenants = fixtures(env), [a,b] = tenants;
  const directory = env.WORKSPACE.getByName("orbit-demo"), target = env.WORKSPACE.getByName(a.id), other = env.WORKSPACE.getByName(b.id);
  let state = await directory.probeState();
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
    const session = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll("+","-").replaceAll("/","_").replace(/=+$/, "");
    const sessionHash = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(session))))).replaceAll("+","-").replaceAll("/","_").replace(/=+$/, "");
    await directory.createStaffSession(sessionHash,{email:a.officer.email,name:a.officer.name},Date.now()+3600000,Date.now());
    state.session = session;
    await directory.probeSave(state);
    return { phase: state.phase, run: state.run, source: state.source };
  }
  if (!state || state.run !== env.RECOVERY_RUN || state.source !== env.RECOVERY_SOURCE) throw new Error("Run provenance unavailable");
  if (action === "checkpoint" && state.phase === "initialized") {
    state.checkpoint = await target.probeCheckpoint();
    state.otherBefore = await other.probeCapture();
    let refused = false;
    try { await other.probeArm(state.checkpoint); } catch { refused = true; }
    if (!refused) throw new Error("Cross-tenant restore was not refused");
    state.phase = "checkpointed";
  } else if (action === "change" && state.phase === "checkpointed") {
    const before = await target.probeDocument(a.loanId);
    state.receipt = {tenant:a.id,run:state.run,source:state.source,status:"pending",before,
      command:{type:"setDocumentDeadline",loanId:a.loanId,requestId:before.id,revision:before.revision,deadlineRevision:before.deadlineRevision,dueOn:"2030-02-03"}};
    await directory.probeSave(state);
    requireOk(await target.write(state.receipt.command,a.admin));
    state.receipt.after = await target.probeDocument(a.loanId);
    state.receipt.status = "acknowledged";
    await directory.probeSave(state);
    const stale = await target.write({...state.receipt.command,deadlineRevision:before.deadlineRevision+5,dueOn:"2030-03-04"},a.admin);
    if (!stale.error) throw new Error("Conflicting deadline change was accepted");
    requireOk(await target.write({type:"revokeApplication",loanId:a.loanId,token:state.link.token},a.officer));
    requireOk(await target.write({type:"revokeRealtorPortal",realtorId:state.realtor.realtorId},a.admin));
    const changed = await directory.manage(a.admin,[],{type:"revoke",email:a.officer.email});
    if (changed.error) throw new Error(changed.error);
    const doc = await other.probeDocument(b.loanId);
    requireOk(await other.write({type:"setDocumentDeadline",loanId:b.loanId,requestId:doc.id,revision:doc.revision,deadlineRevision:doc.deadlineRevision,dueOn:"2030-01-02"},b.officer));
    await target.probeDamage(a.loanId);
    state.otherAfter = await other.probeCapture();
    if (state.otherBefore.hash === state.otherAfter.hash || (await target.probeCapture()).hash === state.checkpoint.hash) throw new Error("Fixture changes were not observable");
    state.phase = "changed";
  } else if (action === "arm" && state.phase === "changed") {
    state.undoBookmark = await target.probeArm(state.checkpoint);
    state.restoreStartedAt = Date.now();
    state.phase = "armed";
  } else if (action === "restart" && state.phase === "armed") {
    try { await target.probeRestart(); } catch { /* Abort is expected, but only verify can prove restoration. */ }
    state.phase = "restarted";
  } else if (action === "verify" && state.phase === "restarted") {
    const recovered = await target.probeCapture(), unaffected = await other.probeCapture();
    if (recovered.hash !== state.checkpoint.hash) throw new Error("Target state differs from checkpoint");
    if (unaffected.hash !== state.otherAfter.hash) throw new Error("Other brokerage changed during recovery");
    const lenderEvidence=await target.probeVerifyLenderEvidence(a,state.lenderEvidence);
    if (await directory.brokerageForPortal(state.link.token)) throw new Error("Revoked borrower link reopened");
    if (await directory.leadOwner(a.id,a.officer.email,[])) throw new Error("Revoked staff membership reopened");
    const portalResponse = await application.fetch(new Request(`${origin}/api/demo-application`, { method: "POST", headers: { Origin: origin, "Content-Type":"application/json" }, body:JSON.stringify({type:"read",token:state.link.token}) }),env,ctx);
    if (portalResponse.status !== 404) throw new Error("Normal borrower route did not reject revoked link");
    const realtorResponse = await application.fetch(new Request(`${origin}/api/realtor-referrals`, {method:"POST",headers:{Origin:origin,"Content-Type":"application/json"},body:JSON.stringify({type:"read",token:state.realtor.token})}),env,ctx);
    if (realtorResponse.status !== 404) throw new Error("Normal realtor route did not reject revoked link");
    const staffResponse = await application.fetch(new Request(`${origin}/workspace?brokerage=${a.id}`, {headers:{Cookie:`__Host-orbit-session=${state.session}`}}),env,ctx);
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
      foreignWriteRejected: true, undoBookmarkRecorded: !!state.undoBookmark,acceptedRevisionsPreserved:lenderEvidence.acceptedRevisions,
      lenderReceiptsPreserved:lenderEvidence.lenderReceipts,historicalPdfBytesMatched:state.lenderEvidence.files.length,manualClearancePreserved:true,loanAuditPreserved:recovered.counts.loan_audit>0 };
  } else if (action === "replay" && state.phase === "verified") {
    for (const invalid of [{...state.receipt,status:"pending"},{...state.receipt,tenant:b.id}]) {
      let refused=false;
      try {await target.probeReplay(invalid,a.admin);} catch {refused=true;}
      if (!refused) throw new Error("Invalid recovery receipt was accepted");
    }
    await target.probeReplay(state.receipt,a.admin);
    state.replayed = await target.probeCapture();
    if (state.replayed.counts.activity !== state.checkpoint.counts.activity+1 || state.replayed.counts.workspace_access_history !== state.checkpoint.counts.workspace_access_history+1) throw new Error("Replay did not record exactly one history event");
    state.phase="replayed";
  } else if (action === "restartReplay" && state.phase === "replayed") {
    try {await target.probeRestart();} catch { /* Next command proves persistence. */ }
    state.phase="replayRestarted";
  } else if (action === "verifyReplay" && state.phase === "replayRestarted") {
    await target.probeReplay(state.receipt,a.admin);
    if ((await target.probeCapture()).hash !== state.replayed.hash) throw new Error("Repeat replay changed history or work");
    if ((await other.probeCapture()).hash !== state.otherAfter.hash) throw new Error("Replay changed the other brokerage");
    state.phase="replayVerified";
    Object.assign(state.result,{acknowledgedEditReplayed:true,repeatReplayAfterRestartUnchanged:true,pendingReceiptRejected:true,foreignReceiptRejected:true});
  } else if (action === "cleanup" && state.phase === "replayVerified") {
    for(const file of state.lenderEvidence.files)await target.probeCleanup(file);
    state.phase = "cleaned";
  } else throw new Error("Command does not match recovery phase");
  await directory.probeSave(state);
  return {...state.result,phase:state.phase,run:state.run};
}
const recoveryWorker = {
  async fetch(request, env, ctx) {
    if (!env.RECOVERY_TOKEN || request.headers.get("Authorization") !== `Bearer ${env.RECOVERY_TOKEN}`) return new Response("Not found",{status:404});
    const url = new URL(request.url);
    if (url.pathname === "/__recovery" && request.method === "POST") {
      if (Number(request.headers.get("Content-Length")||0)>128) return new Response("Too large",{status:413});
      const action = await request.text();
      if (!["status","initialize","checkpoint","change","arm","restart","verify","replay","restartReplay","verifyReplay","cleanup"].includes(action)) return new Response("Unknown step",{status:400});
      try { return Response.json(await command(action,env,url.origin,ctx),{headers:{"Cache-Control":"no-store"}}); }
      catch(error) { return Response.json({error:error.message},{status:409,headers:{"Cache-Control":"no-store"}}); }
    }
    // Rehearsal routing is closed; no anonymous app or arbitrary RPC surface.
    return new Response("Not found",{status:404});
  },
};

export default recoveryWorker;
