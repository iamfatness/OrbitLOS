import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const folder=resolve(process.argv[2]||"");
const run=JSON.parse(await readFile(resolve(folder,"run.json"),"utf8"));
const url=new URL(process.argv[3]);
assert.match(run.name,/^orbit-recovery-[a-f0-9]{8}$/);
assert.equal(url.protocol,"https:");
assert.ok(url.hostname.startsWith(run.name+".")&&url.hostname.endsWith(".workers.dev"));
const secrets=JSON.parse(await readFile(resolve(folder,"secrets.json"),"utf8"));
let evidence=[];
try {evidence=JSON.parse(await readFile(resolve(folder,'evidence.json'),'utf8'));}
catch(error) {if(error.code!=="ENOENT")throw error;}
assert.ok(Array.isArray(evidence)&&evidence.every(item=>item.run===run.run&&item.source===run.source),"Evidence belongs to another run");
const anonymous=await fetch(new URL('/__recovery',url),{method:'POST',body:'initialize'});
assert.equal(anonymous.status,404);
const steps=['initialize','checkpoint','prepareChange','interrupt','restartInterrupted','reconcile','change','arm','restart','verify','replay','restartReplay','verifyReplay','directoryPrepare','directoryArmOld','directoryRejectOld','directoryRecover','directoryVerify','cleanup'];
const phases=['new','initialized','checkpointed','prepared','interrupted','reconciled','changed','armed','restarted','verified','replayed','replayRestarted','replayVerified','directoryPrepared','directoryOldArmed','directoryOldRejected','directoryRecoveryArmed','directoryVerified','cleaned'];
const statusResponse=await fetch(new URL('/__recovery',url),{method:'POST',headers:{Authorization:`Bearer ${secrets.RECOVERY_TOKEN}`},body:'status'});
assert.equal(statusResponse.status,200);
const current=await statusResponse.json();assert.equal(current.run,run.run);assert.equal(current.source,run.source);
if(current.artifactSha256)assert.equal(current.artifactSha256,run.artifactSha256,"Hosted artifact differs from prepared modules");
const phaseIndex=phases.indexOf(current.phase);assert.ok(phaseIndex>=0);
const start=phaseIndex+(phaseIndex>=4?1:0);
if(start===steps.length)console.log(JSON.stringify(current,null,2));
for(const step of steps.slice(start)){
 const response=await fetch(new URL('/__recovery',url),{method:'POST',headers:{Authorization:`Bearer ${secrets.RECOVERY_TOKEN}`},body:step,signal:AbortSignal.timeout(60000)});
 const result=await response.json();
 if(step==='interrupt') {
   assert.equal(response.status,409);assert.equal(result.error,'Simulated lost acknowledgment');
   evidence.push({step,run:run.run,source:run.source,expectedLostAcknowledgment:true});
   await writeFile(resolve(folder,'evidence.json'),JSON.stringify(evidence,null,2));
   console.log('interrupt: expected lost acknowledgment');continue;
 }
 assert.equal(response.status,200,`${step}: ${result.error}`);
 if(result.artifactSha256)assert.equal(result.artifactSha256,run.artifactSha256,"Hosted artifact differs from prepared modules");
 evidence.push({step,...result});
 await writeFile(resolve(folder,'evidence.json'),JSON.stringify(evidence,null,2));
 console.log(`${step}: ${result.phase}`);
}
console.log(JSON.stringify(evidence.at(-1),null,2));
