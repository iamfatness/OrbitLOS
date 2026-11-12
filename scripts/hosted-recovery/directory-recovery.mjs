import { directoryDrainObject, directoryDrainPath, directoryEvidencePath, directoryPauseKey, directoryRecoveryHoldPath, directoryRepairPath, directorySignInResetPath } from "./recovery-fixtures.mjs";

// Only the isolated rehearsal imports this module. Its journal lives in the
// fixture bucket, outside the Durable Object that is restored.
const journalKey = "directory-recovery-journal";
const directoryTables = [
  "brokerages", "brokerage_members", "brokerage_access_history", "revoked_pilot_portals",
  "staff_sessions", "staff_google_attempts", "staff_workspace_preferences", "brokerage_maintenance", "brokerage_maintenance_history",
  "brokerage_maintenance_decisions", "brokerage_recovery_edits", "brokerage_recovery_replays",
  "brokerage_recovery_checkpoints", "brokerage_checkpoint_parts", "brokerage_restore_jobs",
  "uwm_transaction_routes", "uwm_loan_routes",
];

export async function snapshotDirectory(storage) {
  // Consume each cursor synchronously, then hash outside the SQL transaction.
  // Every covered column is text, integer or null.
  const rows = storage.transactionSync(() => directoryTables.map(name => {
    const entries = storage.sql.exec(`SELECT * FROM "${name}" ORDER BY rowid LIMIT 2001`).toArray();
    if (entries.length > 2000) throw new Error("Directory fixture exceeds its inspection limit");
    return entries;
  }));
  const encoder = new TextEncoder();
  const manifest = await Promise.all(rows.map(async (entries, index) => {
    const bytes = await crypto.subtle.digest("SHA-256", encoder.encode(JSON.stringify(entries)));
    const hash = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
    return { name: directoryTables[index], count: entries.length, hash };
  }));
  return manifest;
}

export async function readDirectoryJournal(env) {
  const object = await env.DOCUMENTS.get(journalKey);
  if (!object) return null;
  const journal = await object.json();
  if (journal.run !== env.RECOVERY_RUN || journal.source !== env.RECOVERY_SOURCE ||
      journal.artifact !== env.RECOVERY_ARTIFACT) throw new Error("Directory journal provenance mismatch");
  return journal;
}

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const changed = (expected, actual) => expected.filter((table, index) => !same(table, actual[index])).map(table => table.name);

async function checkPausedIngress(application, env, origin, ctx) {
  const routes = [
    ["GET", "/workspace"], ["GET", "/auth/google/callback"],
    ["POST", "/api/demo-application"], ["POST", "/api/realtor-referrals"],
    ["POST", "/api/borrower-documents/upload"], ["POST", "/api/shared-lead-documents"],
    ["POST", "/api/webhooks/uwm/stage/import"], ["POST", "/api/demo-request"],
  ];
  // Only the independent coordinator can be reached from these requests.
  const isolated={WORKSPACE:{getByName(name){
    if(name!==directoryDrainObject)throw new Error("Protected handler reached the directory");
    return env.WORKSPACE.getByName(name);
  }}};

  for (const [method,path] of routes) {
    const response = await application.fetch(new Request(origin+path,{method}),isolated,ctx);
    if (response.status !== 503 || response.headers.get("X-Orbit-Maintenance") !== "directory-recovery" ||
        response.headers.get("Cache-Control") !== "private, no-store") throw new Error(`Traffic pause did not cover ${path}`);
  }
  const unavailable = await application.fetch(new Request(origin+"/workspace"),{
    WORKSPACE:{getByName:()=>{throw new Error("Fictional coordinator failure");}},
  },ctx);
  if (unavailable.status !== 503 || unavailable.headers.get("X-Orbit-Maintenance") !== "directory-recovery")
    throw new Error("Workspace admission opened when the coordinator failed");
  const publicAsset = await application.fetch(new Request(origin+"/fonts/InterVariable.woff2"),
    {ASSETS:{fetch:()=>new Response("Fictional public asset")}},ctx);
  if (publicAsset.status !== 200) throw new Error("Directory pause blocked public assets");
  return routes.length;
}

async function restart(directory) {
  try {
    await directory.probeDirectoryRestart();
  } catch {
    // Only the next manifest can confirm that the armed restart took effect.
  }
}

export async function directoryRecoveryCommand(action, fixture) {
  const { env, ctx, origin, application, directory, target, other, state, tenants:[a,b,unrelated], journal } = fixture;
  let next = journal;
  const save = () => env.DOCUMENTS.put(journalKey, JSON.stringify(next));
  const coordinator=env.WORKSPACE.getByName(directoryDrainObject);
  async function readDrain(token) {
    const response=await application.fetch(new Request(origin+directoryDrainPath,{
      headers:{Authorization:`Bearer ${token}`},
    }),env,ctx);
    if(response.status!==200)throw new Error("Operator drain status unavailable");
    return response.json();
  }

  async function accessEvidence(method, token, id, expected) {
    const response = await application.fetch(new Request(`${origin}${directoryEvidencePath}?id=${id}`,{
      method, headers:{Authorization:`Bearer ${token}`},
    }),env,ctx);
    if(response.status!==expected)throw new Error(`Evidence ${method} returned ${response.status}, expected ${expected}`);
    return response.json();
  }

  if (action === "directoryPrepare" && !journal && state?.phase === "replayVerified") {
    const routes = [a,b].map((item,index) => ({
      brokerageId: item.id, transactionId: `fictional-recovery-transaction-${index}`,
      loanNumber: `fictional-recovery-loan-${index}`, operationId: crypto.randomUUID(),
    }));
    await directory.probeDirectoryRoutes(routes);
    if (!await directory.rememberStaffWorkspace(state.directoryEndedSession, Date.now(), [], b.id, true))
      throw new Error("Could not save the newer fictional workspace default");
    await directory.removeStaffSession(state.directoryEndedSession);
    if(!await directory.consumeGoogle(state.directoryOldAttempt,"fictional-browser",Date.now()))
      throw new Error("Fictional pending sign-in was not populated before the older point");
    const open = await directory.manageWorkspaceMaintenance(a.admin);
    if (open.mode === "Open") {
      const paused = await directory.manageWorkspaceMaintenance(a.admin,{type:"pause",revision:open.revision,
        reason:"Preserve the fictional maintenance fence across shared directory recovery",confirmation:a.admin.brokerage.name});
      if (paused.mode !== "Paused") throw new Error("Could not pause the fictional workspace");
    }
    const paused = await directory.manageWorkspaceMaintenance(a.admin);
    const source = await directory.probeDirectoryPoint();
    const differences = changed(source.manifest,state.directoryOld.manifest);
    for (const name of ["brokerage_members","revoked_pilot_portals","uwm_transaction_routes","uwm_loan_routes","brokerage_recovery_edits","staff_sessions","staff_workspace_preferences"]) {
      if (!differences.includes(name)) throw new Error(`Rehearsal did not cover changed ${name}`);
    }
    const ticket=crypto.randomUUID();
    if(!await coordinator.beginDirectoryWork(ticket,"http"))throw new Error("Could not admit the fictional outstanding request");
    const hex=bytes=>Array.from(bytes,byte=>byte.toString(16).padStart(2,"0")).join("");
    const randomToken=()=>hex(crypto.getRandomValues(new Uint8Array(32)));
    const hash=async token=>hex(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token))));
    const token=randomToken(), evidenceToken=randomToken(), repairToken=randomToken(), resetToken=randomToken(), holdToken=randomToken();
    const statusTokenSha256=await hash(token), evidenceTokenSha256=await hash(evidenceToken), repairTokenSha256=await hash(repairToken), signInResetTokenSha256=await hash(resetToken), holdTokenSha256=await hash(holdToken);
    next = {
      endedSession:state.directoryEndedSession, oldAttempt:state.directoryOldAttempt,
      token,evidenceToken,repairToken,resetToken,holdToken,ticket,holdId:crypto.randomUUID(),resetId:crypto.randomUUID(),repairId:crypto.randomUUID(),evidenceId:crypto.randomUUID(),
      run:env.RECOVERY_RUN, source:env.RECOVERY_SOURCE, artifact:env.RECOVERY_ARTIFACT,
      phase:"directoryPrepared", old:state.directoryOld, current:source, routes,
      pauseRevision:paused.revision, tenants:[(await target.probeCapture()).hash,(await other.probeCapture()).hash],
      evidence:{ artifactSha256:env.RECOVERY_ARTIFACT },
    };
    await save();
    await env.DOCUMENTS.put(directoryPauseKey,JSON.stringify({incident:"fictional-recovery",statusTokenSha256,evidenceTokenSha256,repairTokenSha256,signInResetTokenSha256,holdTokenSha256}));
  } else if (action === "directoryArmOld" && journal?.phase === "directoryPrepared") {
    if (!same(await directory.probeDirectorySnapshot(),journal.current.manifest)) throw new Error("Directory changed after capture");
    await checkPausedIngress(application,env,origin,ctx);
    if ((await readDrain(journal.token)).http < 1) throw new Error("Outstanding ticket was not visible");
    await accessEvidence("POST",journal.evidenceToken,journal.evidenceId,409);
    await coordinator.endDirectoryWork(journal.ticket);
    let count;
    for(let attempt=0;attempt<20;attempt++){
      count=await readDrain(journal.token);
      if(!count.active)break;
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    if (count?.active !== 0) throw new Error("Outstanding work blocked the restore");
    const saved=await accessEvidence("POST",journal.evidenceToken,journal.evidenceId,201);
    const repeated=await accessEvidence("POST",journal.evidenceToken,journal.evidenceId,200);
    if(saved.evidence.version!==3 || !same(saved,repeated) || !(await accessEvidence("GET",journal.evidenceToken,journal.evidenceId,200)).matches)
      throw new Error("Independent evidence capture did not seal the reviewed state");
    const undo = await directory.probeDirectoryArm(journal.old);
    next = { ...journal, undo, phase:"directoryOldArmed" };
    await save();
    await restart(directory);
  } else if (action === "directoryRejectOld" && journal?.phase === "directoryOldArmed") {
    const actual = await directory.probeDirectorySnapshot();
    if (!same(actual,journal.old.manifest)) throw new Error("Directory did not restore to the older bookmark");
    const differences = changed(journal.current.manifest,actual);
    if (!differences.includes("revoked_pilot_portals") || !differences.includes("uwm_transaction_routes"))
      throw new Error("Older directory did not demonstrate lost access and routing evidence");
    const pausedRoutes = await checkPausedIngress(application,env,origin,ctx);
    const comparison=await accessEvidence("GET",journal.evidenceToken,journal.evidenceId,200);
    if(comparison.matches || comparison.accessMatches || comparison.groups.filter(group=>group.changed).length!==4)
      throw new Error("Independent evidence failed to detect stale access and routing");
    if (!same(comparison.workspacePreferences, { status: "changed", saved: 1, current: 1 }))
      throw new Error("Independent evidence missed a same-count workspace preference rollback");
    const maintenanceChanges=comparison.maintenance.changes.filter(item=>item.brokerageId===a.id);
    if(comparison.maintenance.status!=="changed" ||
      !maintenanceChanges.some(item=>item.group==="maintenance") ||
      !maintenanceChanges.some(item=>item.group==="edits"))
      throw new Error("Independent evidence failed to detect stale maintenance and covered edits");

    if ((await readDrain(journal.token)).active !== 0) throw new Error("Verified drain did not survive directory restart");
    const repairUrl=`${origin}${directoryRepairPath}?id=${journal.evidenceId}`;
    async function repair(method, token, url=repairUrl) {
      return application.fetch(new Request(url,{method,headers:{Authorization:`Bearer ${token}`}}),env,ctx);
    }
    if((await repair("GET",journal.evidenceToken)).status!==404)throw new Error("Evidence credential could open repair");
    const reviewResponse=await repair("GET",journal.repairToken);
    if(reviewResponse.status!==200)throw new Error("Directory repair preview unavailable");
    const review=await reviewResponse.json();
    if(review.conflicts || review.changes.staffRevocations!==1 || review.changes.portalRevocations!==2 ||
      review.changes.transactionRoutes!==2 || review.changes.loanRoutes!==2)throw new Error("Directory repair missed saved records");
    const confirmed=`${repairUrl}&confirm=repair&requestId=${journal.repairId}&fingerprint=${review.fingerprint}`;
    const result=await repair("POST",journal.repairToken,confirmed);
    if(result.status!==200)throw new Error("Reviewed directory repair was refused");
    const applied=await result.json(), retry=await repair("POST",journal.repairToken,confirmed);
    if(retry.status!==200 || !same(await retry.json(),applied))throw new Error("Directory repair retry changed the receipt");
    const repairedComparison=await accessEvidence("GET",journal.evidenceToken,journal.evidenceId,200);
    if(!repairedComparison.accessMatches || repairedComparison.matches ||
      !same(repairedComparison.maintenance,comparison.maintenance) ||
      !same(repairedComparison.workspacePreferences,comparison.workspacePreferences))
      throw new Error("Access reconstruction masked unresolved directory evidence");
    if(await directory.brokerageForPortal(state.link.token) || await directory.brokerageForPortal(state.realtor.token) ||
      await directory.leadOwner(a.id,a.officer.email,[]) || !await directory.leadOwner(b.id,b.officer.email,[]))
      throw new Error("Reconstruction did not preserve access restrictions");
    for(const route of journal.routes){
      const event={environment:"stage",kind:"conditions",body:"{}",loanNumber:route.loanNumber};
      const candidate = await directory.uwmWebhookRoute(event);
      if (candidate?.brokerageId !== route.brokerageId || candidate.operationId !== route.operationId)
        throw new Error("Reconstruction lost lender routing ownership");
    }
    if(!await directory.getStaffSession(journal.endedSession,Date.now()))
      throw new Error("Older checkpoint did not revive the fictional signed-out session");
    const resetUrl=origin+directorySignInResetPath;
    const reset=(method,token,url=resetUrl)=>application.fetch(new Request(url,{
      method,headers:{Authorization:`Bearer ${token}`},
    }),env,ctx);
    if((await reset("GET",journal.repairToken)).status!==404)throw new Error("Repair credential could open sign-in reset");
    const resetReview=await reset("GET",journal.resetToken);
    if(resetReview.status!==200)throw new Error("Sign-in reset preview unavailable");
    const preview=await resetReview.json();
    if(!preview.sessions || preview.attempts!==1)throw new Error("Preview did not find revived sign-in state");
    const resetRequest=`${resetUrl}?requestId=${journal.resetId}&fingerprint=${preview.fingerprint}&confirm=sign-out-all-staff`;
    const resetResult=await reset("POST",journal.resetToken,resetRequest);
    if(resetResult.status!==200)throw new Error("Sign-in reset was refused");
    const invalidated=(await resetResult.json()).invalidated;
    const resetRetry=await reset("POST",journal.resetToken,resetRequest);
    if(resetRetry.status!==200 || !same((await resetRetry.json()).invalidated,invalidated))
      throw new Error("Sign-in reset did not return the same receipt");
    const cleared=await (await reset("GET",journal.resetToken)).json();
    if(cleared.sessions!==0 || cleared.attempts!==0 ||
      await directory.getStaffSession(journal.endedSession,Date.now()) ||
      await directory.consumeGoogle(journal.oldAttempt,"fictional-browser",Date.now()))
      throw new Error("Older sign-in state still grants access after reset");
    const holdUrl=(id)=>`${origin}${directoryRecoveryHoldPath}?id=${journal.evidenceId}&brokerage=${id}`;
    const hold=(method,token,url=holdUrl(a.id))=>application.fetch(new Request(url,{
      method,headers:{Authorization:`Bearer ${token}`},
    }),env,ctx);
    if((await hold("GET",journal.evidenceToken)).status!==404)throw new Error("Evidence credential could reserve a hold");
    const holdPreview=await hold("GET",journal.holdToken);
    const unaffected=await hold("GET",journal.holdToken,holdUrl(unrelated.id));
    if(holdPreview.status!==200 || unaffected.status!==200)throw new Error("Recovery hold preview unavailable");
    const holdReview=await holdPreview.json();
    if(!holdReview.canHold || (await unaffected.json()).canHold)throw new Error("Recovery hold did not isolate the affected brokerage");
    const holdRequest=`${holdUrl(a.id)}&requestId=${journal.holdId}&fingerprint=${holdReview.fingerprint}&reference=Fictional-Restore&confirm=hold-for-review`;
    const held=await hold("POST",journal.holdToken,holdRequest);
    if(held.status!==200)throw new Error(`Recovery hold was refused: ${held.status}`);
    const holdResult=await held.json();
    const holdRetry=await hold("POST",journal.holdToken,holdRequest);
    if(holdRetry.status!==200 || !same(await holdRetry.json(),holdResult))throw new Error("Recovery hold retry changed its receipt");
    const stateAfterHold=await directory.manageWorkspaceMaintenance(a.admin);
    if(stateAfterHold.mode!=="Paused" || stateAfterHold.reviewedAt || stateAfterHold.revision!==holdResult.revision ||
      stateAfterHold.history.filter(event=>event.action==="Held after directory recovery").length!==1)
      throw new Error("Recovery hold did not invalidate the old review exactly once");
    const pauseObject=await env.DOCUMENTS.get(directoryPauseKey);
    const markerBody=await pauseObject.text();
    const temporarySessions=[];
    try {
      const encode=bytes=>btoa(String.fromCharCode(...bytes)).replaceAll("+","-").replaceAll("/","_").replace(/=+$/,"");
      for(const item of [a,unrelated]){
        const token=encode(crypto.getRandomValues(new Uint8Array(32)));
        const hash=encode(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token))));
        await directory.createStaffSession(hash,item.admin,Date.now()+60000,Date.now());
        temporarySessions.push({item,token,hash});
      }
      await env.DOCUMENTS.delete(directoryPauseKey);
      for(const {item,token} of temporarySessions){
        // A read-only method check reaches staff routing without provider activity.
        const response=await application.fetch(new Request(`${origin}/api/uwm-file/read?brokerage=${item.id}`,{
          headers:{Cookie:`__Host-orbit-session=${token}`},
        }),env,ctx);
        await response.arrayBuffer();
        if(response.status!==(item===a?503:405))throw new Error(`Recovery hold leaked or affected another brokerage: ${response.status}`);
      }
    } finally {
      await env.DOCUMENTS.put(directoryPauseKey,markerBody);
      for(const {hash} of temporarySessions)await directory.removeStaffSession(hash);
    }
    for(let attempt=0;attempt<20;attempt++){
      if(!(await readDrain(journal.token)).active)break;
      if(attempt===19)throw new Error("Scoped hold verification did not drain");
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    const reconstructed=await directory.probeDirectorySnapshot();

    next = { ...journal, phase:"directoryOldRejected", reconstructed, evidence:{
      ...journal.evidence, olderDirectoryRejected:true, changedDirectoryTables:differences, pausedIngressRoutes:pausedRoutes, trackedDrainBeforeRestore:true, trackedDrainSurvivedRestore:true, sealedEvidenceDetectedStaleDirectory:true, reviewedReconstructionMatched:true, maintenanceDriftDetected:true, maintenanceDriftSurvivedAccessRepair:true, maintenanceGroupsChanged:maintenanceChanges.map(item=>item.group), workspacePreferenceDriftDetected:true, workspacePreferenceDriftSurvivedAccessRepair:true, reconstructedCounts:applied.applied, repairReceiptRetryMatched:true, olderSignInStateInvalidated:true, signInResetCounts:invalidated, signInResetRetryMatched:true, affectedBrokerageHeld:true, unaffectedBrokerageAccessible:true, holdRetryMatched:true, holdInvalidatedReopeningReview:true, heldMaintenanceGroups:holdResult.groups,
    } };
    await save();
  } else if (action === "directoryRecover" && journal?.phase === "directoryOldRejected") {
    const actual = await directory.probeDirectorySnapshot();
    if (same(actual,journal.reconstructed)) {
      await directory.probeDirectoryArm({ ...journal.current, bookmark:journal.undo });
      next = { ...journal, phase:"directoryRecoveryArmed" };
      await save();
      await restart(directory);
    } else if (same(actual,journal.current.manifest)) {
      // Resume after an interrupted acknowledgment if the target is already exact.
      next = { ...journal, phase:"directoryRecoveryArmed" };
      await save();
    } else throw new Error("Directory matches neither reviewed recovery point");
  } else if (action === "directoryVerify" && journal?.phase === "directoryRecoveryArmed") {
    const actual = await directory.probeDirectorySnapshot();
    if (!same(actual,journal.current.manifest)) throw new Error("Directory recovery does not match current evidence");
    if (!(await accessEvidence("GET",journal.evidenceToken,journal.evidenceId,200)).matches)
      throw new Error("Independent evidence comparison did not confirm recovery");
    if ((await target.probeCapture()).hash !== journal.tenants[0] || (await other.probeCapture()).hash !== journal.tenants[1])
      throw new Error("Directory restore changed a tenant");
    if (await directory.brokerageForPortal(state.link.token) || await directory.brokerageForPortal(state.realtor.token))
      throw new Error("A revoked portal link was re-enabled");
    if (await directory.leadOwner(a.id,a.officer.email,[]) || !await directory.leadOwner(b.id,b.officer.email,[]))
      throw new Error("Directory recovery changed staff access");
    if (await directory.getStaffSession(state.directoryEndedSession,Date.now()))
      throw new Error("A signed-out session was restored");
    const paused = await directory.manageWorkspaceMaintenance(a.admin);
    if (paused.mode !== "Paused" || paused.revision !== journal.pauseRevision)
      throw new Error("The current maintenance fence did not survive");
    for (const route of journal.routes) {
      for (const kind of ["import","conditions","ulad"]) {
        const event = { environment:"stage", kind, body:"{}", transactionId:route.transactionId, loanNumber:route.loanNumber };
        const candidate = await directory.uwmWebhookRoute(event);
        if (candidate?.brokerageId !== route.brokerageId || candidate.operationId !== route.operationId ||
            await directory.uwmWebhookRoute({ ...event, environment:"production" }))
          throw new Error("Directory restore changed lender routing ownership or environment isolation");
        if (kind === "import") continue;
        // One brokerage is deliberately paused. In the open brokerage, a
        // restored directory mapping still needs a canonical import receipt.
        let verification;
        try { verification = await env.WORKSPACE.getByName(route.brokerageId).verifyUwmLoanRoute(candidate,event); }
        catch (error) {
          if (route.brokerageId !== a.id || !String(error).includes("paused for maintenance")) throw error;
          verification = "paused";
        }
        if (verification !== (route.brokerageId === a.id ? "paused" : false))
          throw new Error("Directory restore unexpectedly enabled lender delivery without eligible evidence");
      }
    }
    next = { ...journal, phase:"directoryVerified", evidence:{
      ...journal.evidence, sharedDirectoryRestored:true, sealedEvidenceMatchedAfterRecovery:true, directoryTablesVerified:actual.length,
      directoryTenantDatabasesUnchanged:2, directoryPortalRevocationsPreserved:2,
      directoryLoggedOutSessionDenied:true, directoryMaintenanceFencePreserved:true, directoryRevokedStaffDenied:true, directoryOtherStaffPreserved:true, directoryRoutesVerified:journal.routes.length*3, restoredUnverifiedRoutesHeld:true,
    } };
    await save();
  } else if (action === "directoryResume" && journal?.phase === "directoryVerified") {
    if (!same(await directory.probeDirectorySnapshot(),journal.current.manifest))
      throw new Error("Directory changed before reopening");
    const encode=bytes=>btoa(String.fromCharCode(...bytes)).replaceAll("+","-").replaceAll("/","_").replace(/=+$/,"");
    const token=encode(crypto.getRandomValues(new Uint8Array(32)));
    const hash=encode(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token))));
    await directory.createStaffSession(hash,a.admin,Date.now()+60000,Date.now());
    await env.DOCUMENTS.delete(directoryPauseKey);
    try {
      const entry = await application.fetch(new Request(`${origin}/workspace`,{
        headers:{Cookie:`__Host-orbit-session=${token}`},
      }),env,ctx);
      if (entry.status !== 303 || entry.headers.get("Location") !== `/workspace?brokerage=${b.id}`)
        throw new Error("A new session did not open the recovered workspace preference");
    } catch (error) {
      await env.DOCUMENTS.put(directoryPauseKey,"Fictional workspace preference verification failed");
      throw error;
    } finally {
      await directory.removeStaffSession(hash);
    }
    const denied = await application.fetch(new Request(`${origin}/workspace?brokerage=${a.id}`,{
      headers:{Cookie:`__Host-orbit-session=${state.session}`},
    }),env,ctx);
    await denied.arrayBuffer();
    if (denied.status !== 403) {
      await env.DOCUMENTS.put(directoryPauseKey,"Fictional recovery verification failed");
      throw new Error("Revoked staff could enter the restored workspace");
    }
    next = { ...journal, phase:"directoryResumed", evidence:{ ...journal.evidence, directoryTrafficResumed:true, recoveredWorkspacePreferenceOpened:true } };
    await save();
  } else throw new Error("Command does not match the directory recovery phase");

  return { ...next.evidence, phase:next.phase, run:env.RECOVERY_RUN, source:env.RECOVERY_SOURCE };
}
