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
const evidence=[];
const anonymous=await fetch(new URL('/__recovery',url),{method:'POST',body:'initialize'});
assert.equal(anonymous.status,404);
const steps=['initialize','checkpoint','change','arm','restart','verify'];
const phases=['new','initialized','checkpointed','changed','armed','restarted','verified'];
const statusResponse=await fetch(new URL('/__recovery',url),{method:'POST',headers:{Authorization:`Bearer ${secrets.RECOVERY_TOKEN}`},body:'status'});
assert.equal(statusResponse.status,200);
const current=await statusResponse.json();assert.equal(current.run,run.run);assert.equal(current.source,run.source);
const start=phases.indexOf(current.phase);assert.ok(start>=0);
if(start===steps.length)console.log(JSON.stringify(current,null,2));
for(const step of steps.slice(start)){
 const response=await fetch(new URL('/__recovery',url),{method:'POST',headers:{Authorization:`Bearer ${secrets.RECOVERY_TOKEN}`},body:step,signal:AbortSignal.timeout(60000)});
 const result=await response.json();
 assert.equal(response.status,200,`${step}: ${result.error}`);
 evidence.push({step,...result});
 await writeFile(resolve(folder,'evidence.json'),JSON.stringify(evidence,null,2));
 console.log(`${step}: ${result.phase}`);
}
console.log(JSON.stringify(evidence.at(-1),null,2));
