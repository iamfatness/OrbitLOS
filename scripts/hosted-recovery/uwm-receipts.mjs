import assert from "node:assert/strict";

const journalKey = "fictional-uwm-receipt-recovery";
const environment = "stage";
const loanNumber = "1234567890";
const routeKey = { environment, kind: "conditions", loanNumber };
export const uwmRecoverySteps = ["initialize", "match", "armDestination", "verifyDestination", "armDirectoryOld",
  "verifyDirectoryOld", "armDirectoryLatest", "verify", "cleanup"];

export async function uwmReceiptRecovery(action, env, origin, ctx, application) {
  const { WORKSPACE, DOCUMENTS, FIXTURE_A, FIXTURE_B, FIXTURE_C, RECOVERY_RUN, RECOVERY_SOURCE, RECOVERY_ARTIFACT } = env;
  const directory = WORKSPACE.getByName("orbit-demo");
  const inbox = WORKSPACE.getByName(FIXTURE_A), target = WORKSPACE.getByName(FIXTURE_B), other = WORKSPACE.getByName(FIXTURE_C);
  const admin = (id, email = "uwm-fixture-owner@example.test") => ({email, name:"Fictional Recovery Owner",
    brokerage:{id, name:`Fictional receipt ${id.slice(0, 4)}`, role:"Admin", pilot:false, accessRevision:1}});
  const sourceAdmin = admin(FIXTURE_A), destinationAdmin = admin(FIXTURE_B);
  const sourceOnly = admin(FIXTURE_A,"uwm-fixture-inbox@example.test");
  const foreignAdmin = admin(FIXTURE_C,"uwm-fixture-other@example.test");
  const token = JSON.parse(env.UWM_WEBHOOK_CONFIG).stage.token;
  const meta = {run:RECOVERY_RUN,source:RECOVERY_SOURCE,artifactSha256:RECOVERY_ARTIFACT};
  let state = await (await DOCUMENTS.get(journalKey))?.json();
  const result = () => ({...meta,phase:state?.phase ?? "new",...state?.result});
  const save = () => DOCUMENTS.put(journalKey,JSON.stringify(state));
  const receive = async (kind, body) => {
    const request = new Request(`${origin}/api/webhooks/uwm/${environment}/${kind}`, {
      method:"POST", headers:{"Content-Type":"application/json","X-API-Key":token}, body:JSON.stringify(body),
    });
    const response = await application.fetch(request,env,ctx);
    assert.equal(response.status,200,`Fictional ${kind} delivery failed`);
    return (await response.json()).receipt;
  };
  const condition = (id) => ({id,category:"Income",bucketKey:"income",conditionDescription:"Fictional receipt recovery",
    conditionSatisfactionDate:null,loanNumber,loanStatus:"Approved With Conditions"});
  const receipt = (workspace, actor, id) => workspace.uwmWebhookReceipts(actor,Number.MAX_SAFE_INTEGER,id);
  const checkCopy = () => inbox.matchUwmReceipt(sourceAdmin,state.inboxReceiptId);
  const sourceStatus = async () => (await receipt(inbox,sourceAdmin)).find(row=>row.id===state.inboxReceiptId);
  const sameCopy = async (id) => {
    const [original,copy] = await Promise.all([receipt(inbox,sourceAdmin,state.inboxReceiptId),receipt(target,destinationAdmin,id)]);
    assert.ok(original && copy);
    assert.equal(copy.digest,original.digest);
    assert.equal(copy.body,original.body);
  };
  const restart = async (workspace) => { try { await workspace.probeUwmReceiptRestart(); } catch { /* Read after restart proves the outcome. */ } };

  if (action === "status") {
    if (!state) state = await directory.probeState();
    return result();
  }
  if (action === "initialize") {
    assert.equal(state,undefined,"Fixture already initialized");
    await directory.probeUwmReceiptDirectory([sourceAdmin,destinationAdmin,sourceOnly,foreignAdmin]);
    const loan = await target.write({type:"loan",contactId:"",borrower:"Fictional Receipt Buyer",borrowerEmail:"uwm-recovery-buyer@example.test",
      address:"",amount:280000,purpose:"Purchase",stage:"Lead",officer:destinationAdmin.name,partnerId:null},destinationAdmin);
    assert.ok(loan.loanWork?.loanId,loan.error);
    const [operationId,transactionId] = [crypto.randomUUID(),crypto.randomUUID()];
    await target.probeUwmReceiptCommit(loan.loanWork.loanId,operationId,transactionId,destinationAdmin.email);
    await directory.registerUwmTransactionRoute(destinationAdmin,operationId,transactionId,environment);
    const pending = await receive("conditions",condition("held-before-import"));
    const directoryBefore = await directory.probeUwmReceiptBookmark();
    assert.equal(await directory.uwmWebhookRoute(routeKey),null);
    const completion = await receive("import",{TransactionId:transactionId,LoanNumber:loanNumber,LoanStatus:"Completed",LogDateTime:"2026-11-11T08:00:00Z"});
    const route = await directory.uwmWebhookRoute(routeKey);
    assert.deepEqual(route,{brokerageId:FIXTURE_B,operationId,transactionId});
    assert.equal(await target.verifyUwmLoanRoute(route,routeKey),true);
    assert.equal(await target.verifyUwmLoanRoute(route,{...routeKey,environment:"production"}),false);
    state = {phase:"initialized",route,directoryBefore,inboxReceiptId:pending.receiptId,importReceiptId:completion.receiptId,
      destinationBefore:await target.probeUwmReceiptBookmark(),result:{syntheticCallbackVerified:true}};
  } else if (action === "match" && state?.phase === "initialized") {
    assert.ok((await inbox.matchUwmReceipt(sourceOnly,state.inboxReceiptId)).error,"Inbox-only admin was allowed");
    assert.deepEqual(await checkCopy(),{status:"Matched"});
    const matches = (await receipt(target,destinationAdmin)).filter(row=>row.kind==="conditions");
    assert.equal(matches.length,1);
    state.copyId = matches[0].id;
    await sameCopy(state.copyId);
    state.phase = "matched";
  } else if (action === "armDestination" && state?.phase === "matched") {
    await target.probeUwmReceiptArm(state.destinationBefore);
    state.phase = "destinationArmed";
    await save();
    await restart(target);
    return result();
  } else if (action === "verifyDestination" && state?.phase === "destinationArmed") {
    assert.equal(await receipt(target,destinationAdmin,state.copyId),null,"Destination did not rewind");
    assert.equal((await sourceStatus()).status,"Matched");
    assert.equal(await target.verifyUwmLoanRoute(state.route,routeKey),true);
    assert.equal((await receipt(target,destinationAdmin,state.importReceiptId)).kind,"import");
    const newDelivery = await receive("conditions",condition("after-restore"));
    assert.equal(newDelivery.receiptId,state.copyId,"Fixture did not reuse the old destination receipt ID");
    assert.deepEqual(await Promise.all([checkCopy(),checkCopy()]),[{status:"Matched"},{status:"Matched"}]);
    const matches = (await receipt(target,destinationAdmin)).filter(row=>row.kind==="conditions" && row.id!==newDelivery.receiptId);
    assert.equal(matches.length,1);
    state.restoredCopyId = matches[0].id;
    await sameCopy(state.restoredCopyId);
    assert.equal(await inbox.probeUwmMatchId(state.inboxReceiptId),state.restoredCopyId);
    state.phase = "destinationVerified";
    Object.assign(state.result,{destinationPointInTimeRestore:true,matchRecoveredOnce:true,reusedIdDidNotMisidentifyReceipt:true,inboxOnlyAdminDenied:true});
  } else if (action === "armDirectoryOld" && state?.phase === "destinationVerified") {
    state.directoryUndo = await directory.probeUwmReceiptArm(state.directoryBefore);
    state.phase = "directoryOldArmed";
    await save();
    await restart(directory);
    return result();
  } else if (action === "verifyDirectoryOld" && state?.phase === "directoryOldArmed") {
    assert.equal(await directory.uwmWebhookRoute(routeKey),null,"Old directory unexpectedly retained the lender mapping");
    assert.ok((await checkCopy()).error,"An unverified directory was allowed to match the receipt");
    await sameCopy(state.restoredCopyId);
    state.phase = "directoryOldVerified";
  } else if (action === "armDirectoryLatest" && state?.phase === "directoryOldVerified") {
    await directory.probeUwmReceiptArm(state.directoryUndo);
    state.phase = "directoryLatestArmed";
    await save();
    await restart(directory);
    return result();
  } else if (action === "verify" && state?.phase === "directoryLatestArmed") {
    assert.deepEqual(await directory.uwmWebhookRoute(routeKey),state.route);
    assert.equal(await target.verifyUwmLoanRoute(state.route,routeKey),true);
    assert.deepEqual(await checkCopy(),{status:"Matched"});
    assert.equal(await inbox.probeUwmMatchId(state.inboxReceiptId),state.restoredCopyId);
    await sameCopy(state.restoredCopyId);
    assert.equal((await receipt(target,destinationAdmin)).filter(row=>row.kind==="conditions").length,2);
    assert.deepEqual(await receipt(other,foreignAdmin),[]);
    assert.equal((await sourceStatus()).status,"Matched");
    state.phase = "verified";
    Object.assign(state.result,{directoryPointInTimeRestore:true,unverifiedDirectoryRefused:true,verifiedLoanRouteRecovered:true,
      originalInboxReceiptPreserved:true,repeatAfterRestoreUnchanged:true,otherBrokerageUnchanged:true});
  } else if (action === "cleanup" && state?.phase === "verified") {
    state.phase = "cleaned";
    await directory.probeSave(state);
    await DOCUMENTS.delete(journalKey);
    return result();
  } else throw new Error("Command does not match the fictional UWM receipt recovery phase");
  await save();
  return result();
}
