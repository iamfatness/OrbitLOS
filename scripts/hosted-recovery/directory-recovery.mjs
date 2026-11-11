import { directoryDrainObject, directoryDrainPath, directoryEvidencePath, directoryPauseKey, directoryRepairPath } from "./recovery-fixtures.mjs";

// Only the isolated rehearsal imports this module. Its journal lives in the
// fixture bucket, outside the Durable Object that is restored.
const journalKey = "directory-recovery-journal";
const directoryTables = [
  "brokerages", "brokerage_members", "brokerage_access_history", "revoked_pilot_portals",
  "staff_sessions", "staff_google_attempts", "brokerage_maintenance", "brokerage_maintenance_history",
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
  const { env, ctx, origin, application, directory, target, other, state, tenants:[a,b], journal } = fixture;
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
    await directory.removeStaffSession(state.directoryEndedSession);
    const open = await directory.manageWorkspaceMaintenance(a.admin);
    if (open.mode === "Open") {
      const paused = await directory.manageWorkspaceMaintenance(a.admin,{type:"pause",revision:open.revision,
        reason:"Preserve the fictional maintenance fence across shared directory recovery",confirmation:a.admin.brokerage.name});
      if (paused.mode !== "Paused") throw new Error("Could not pause the fictional workspace");
    }
    const paused = await directory.manageWorkspaceMaintenance(a.admin);
    const source = await directory.probeDirectoryPoint();
    const differences = changed(source.manifest,state.directoryOld.manifest);
    for (const name of ["brokerage_members","revoked_pilot_portals","uwm_transaction_routes","uwm_loan_routes","brokerage_recovery_edits","staff_sessions"]) {
      if (!differences.includes(name)) throw new Error(`Rehearsal did not cover changed ${name}`);
    }
    const ticket=crypto.randomUUID();
    if(!await coordinator.beginDirectoryWork(ticket,"http"))throw new Error("Could not admit the fictional outstanding request");
    const hex=bytes=>Array.from(bytes,byte=>byte.toString(16).padStart(2,"0")).join("");
    const randomToken=()=>hex(crypto.getRandomValues(new Uint8Array(32)));
    const hash=async token=>hex(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token))));
    const token=randomToken(), evidenceToken=randomToken(), repairToken=randomToken();
    const statusTokenSha256=await hash(token), evidenceTokenSha256=await hash(evidenceToken), repairTokenSha256=await hash(repairToken);
    next = {
      token,evidenceToken,repairToken,ticket,repairId:crypto.randomUUID(),evidenceId:crypto.randomUUID(),
      run:env.RECOVERY_RUN, source:env.RECOVERY_SOURCE, artifact:env.RECOVERY_ARTIFACT,
      phase:"directoryPrepared", old:state.directoryOld, current:source, routes,
      pauseRevision:paused.revision, tenants:[(await target.probeCapture()).hash,(await other.probeCapture()).hash],
      evidence:{ artifactSha256:env.RECOVERY_ARTIFACT },
    };
    await save();
    await env.DOCUMENTS.put(directoryPauseKey,JSON.stringify({incident:"fictional-recovery",statusTokenSha256,evidenceTokenSha256,repairTokenSha256}));
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
    if(!same(saved,repeated) || !(await accessEvidence("GET",journal.evidenceToken,journal.evidenceId,200)).matches)
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
    if(comparison.matches || comparison.groups.filter(group=>group.changed).length!==4)
      throw new Error("Independent evidence failed to detect stale access and routing");

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
    if(!(await accessEvidence("GET",journal.evidenceToken,journal.evidenceId,200)).matches)
      throw new Error("Directory evidence did not match after reconstruction");
    if(await directory.brokerageForPortal(state.link.token) || await directory.brokerageForPortal(state.realtor.token) ||
      await directory.leadOwner(a.id,a.officer.email,[]) || !await directory.leadOwner(b.id,b.officer.email,[]))
      throw new Error("Reconstruction did not preserve access restrictions");
    for(const route of journal.routes){
      const event={environment:"stage",kind:"conditions",body:"{}",loanNumber:route.loanNumber};
      if(await directory.uwmWebhookTarget(event)!==route.brokerageId)throw new Error("Reconstruction lost lender routing ownership");
    }
    const reconstructed=await directory.probeDirectorySnapshot();

    next = { ...journal, phase:"directoryOldRejected", reconstructed, evidence:{
      ...journal.evidence, olderDirectoryRejected:true, changedDirectoryTables:differences, pausedIngressRoutes:pausedRoutes, trackedDrainBeforeRestore:true, trackedDrainSurvivedRestore:true, sealedEvidenceDetectedStaleDirectory:true, reviewedReconstructionMatched:true, reconstructedCounts:applied.applied, repairReceiptRetryMatched:true,
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
        if (await directory.uwmWebhookTarget(event) !== route.brokerageId ||
            await directory.uwmWebhookTarget({ ...event, environment:"production" }))
          throw new Error("Directory restore changed lender routing ownership or environment isolation");
      }
    }
    next = { ...journal, phase:"directoryVerified", evidence:{
      ...journal.evidence, sharedDirectoryRestored:true, sealedEvidenceMatchedAfterRecovery:true, directoryTablesVerified:actual.length,
      directoryTenantDatabasesUnchanged:2, directoryPortalRevocationsPreserved:2,
      directoryLoggedOutSessionDenied:true, directoryMaintenanceFencePreserved:true, directoryRevokedStaffDenied:true, directoryOtherStaffPreserved:true, directoryRoutesVerified:journal.routes.length*3,
    } };
    await save();
  } else if (action === "directoryResume" && journal?.phase === "directoryVerified") {
    if (!same(await directory.probeDirectorySnapshot(),journal.current.manifest))
      throw new Error("Directory changed before reopening");
    await env.DOCUMENTS.delete(directoryPauseKey);
    const denied = await application.fetch(new Request(`${origin}/workspace?brokerage=${a.id}`,{
      headers:{Cookie:`__Host-orbit-session=${state.session}`},
    }),env,ctx);
    await denied.arrayBuffer();
    if (denied.status !== 403) {
      await env.DOCUMENTS.put(directoryPauseKey,"Fictional recovery verification failed");
      throw new Error("Revoked staff could enter the restored workspace");
    }
    next = { ...journal, phase:"directoryResumed", evidence:{ ...journal.evidence, directoryTrafficResumed:true } };
    await save();
  } else throw new Error("Command does not match the directory recovery phase");

  return { ...next.evidence, phase:next.phase, run:env.RECOVERY_RUN, source:env.RECOVERY_SOURCE };
}
