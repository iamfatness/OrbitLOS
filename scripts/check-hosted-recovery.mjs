import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
const require=createRequire(import.meta.url);
const {Miniflare,convertV4MiniflareOptions}=createRequire(require.resolve("wrangler"))("miniflare");
const folder=resolve(process.argv[2]);
const config=JSON.parse(await readFile(join(folder,"wrangler.json"),"utf8"));
assert.match(config.name,/^orbit-recovery-[a-f0-9]{8}$/);
const secrets=JSON.parse(await readFile(join(folder,"secrets.json"),"utf8"));
const server=join(folder,"server");
const files=(await readdir(server,{recursive:true,withFileTypes:true})).filter(file=>file.isFile()&&/\.m?js$/.test(file.name));
const modules=[{type:"ESModule",path:join(server,"recovery-entry.mjs")},...files.filter(file=>file.name!=="recovery-entry.mjs").map(file=>({type:"ESModule",path:join(file.parentPath,file.name)}))];
const runtime=new Miniflare({...convertV4MiniflareOptions({name:config.name,host:"127.0.0.1",modules,modulesRoot:server,
  compatibilityDate:config.compatibility_date,compatibilityFlags:config.compatibility_flags,bindings:{...config.vars,...secrets},
  r2Buckets:{DOCUMENTS:"fictional-recovery-documents"},durableObjects:{WORKSPACE:{className:"RecoveryWorkspace",useSQLite:true}}}),telemetry:{enabled:false}});
try {
  const {origin}=await runtime.ready;
  const request=(action,authorized=true)=>runtime.dispatchFetch(origin+"/__recovery",{method:"POST",headers:authorized?{Authorization:`Bearer ${secrets.RECOVERY_TOKEN}`}:{},body:action});
  assert.equal((await request("initialize",false)).status,404);
  for(const step of ["initialize","checkpoint","change"]){
    const response=await request(step);const result=await response.json();
    assert.equal(response.status,200,`${step}: ${result.error}`);console.log(`${step}: ${result.phase}`);
  }
  assert.equal((await request("verify")).status,409,"Cannot verify before restoration");
  console.log("Local fixture preparation passed. No hosted restore claim.");
} finally {await runtime.dispose();}
