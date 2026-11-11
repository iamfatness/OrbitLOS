import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { extname, join, resolve } from "node:path";
const require=createRequire(import.meta.url);
const {Miniflare,convertV4MiniflareOptions}=createRequire(require.resolve("wrangler"))("miniflare");
const folder=resolve(process.argv[2]);
const config=JSON.parse(await readFile(join(folder,"wrangler.json"),"utf8"));
assert.match(config.name,/^orbit-recovery-[a-f0-9]{8}$/);
const secrets=JSON.parse(await readFile(join(folder,"secrets.json"),"utf8"));
const server=join(folder,"server");
const preview=process.argv[3]==="--preview";
const types={".js":"text/javascript",".css":"text/css",".woff2":"font/woff2",".svg":"image/svg+xml",".png":"image/png",".webp":"image/webp"};
const files=(await readdir(server,{recursive:true,withFileTypes:true})).filter(file=>file.isFile()&&/\.m?js$/.test(file.name));
const modules=[{type:"ESModule",path:join(server,"recovery-entry.mjs")},...files.filter(file=>file.name!=="recovery-entry.mjs").map(file=>({type:"ESModule",path:join(file.parentPath,file.name)}))];
if(preview)modules.unshift({type:"ESModule",path:join(server,"local-preview.mjs"),contents:`import recovery from './recovery-entry.mjs'; import application from './index.js'; export {RecoveryWorkspace} from './recovery-entry.mjs'; export default {fetch(request,env,ctx) {return new URL(request.url).pathname==='/__recovery'?recovery.fetch(request,env,ctx):application.fetch(request,env,ctx);}};`});
const runtime=new Miniflare({...convertV4MiniflareOptions({name:config.name,host:"127.0.0.1",modules,modulesRoot:server,
  compatibilityDate:config.compatibility_date,compatibilityFlags:config.compatibility_flags,bindings:{...config.vars,...secrets},
  ...(preview?{serviceBindings:{ASSETS:async request=>{
    const pathname=new URL(request.url).pathname;
    try {return new Response(await readFile(new URL(`../dist/client${pathname}`,import.meta.url)),{headers:{"Content-Type":types[extname(pathname)]||"application/octet-stream"}});}
    catch {return new Response(null,{status:404});}
  }}}:{}),
  r2Buckets:{DOCUMENTS:"fictional-recovery-documents"},durableObjects:{WORKSPACE:{className:"RecoveryWorkspace",useSQLite:true}}}),telemetry:{enabled:false}});
try {
  const {origin}=await runtime.ready;
  const request=(action,authorized=true)=>runtime.dispatchFetch(origin+"/__recovery",{method:"POST",headers:authorized?{Authorization:`Bearer ${secrets.RECOVERY_TOKEN}`}:{},body:action});
  assert.equal((await request("initialize",false)).status,404);
  for(const step of preview?["initialize"]:["initialize","checkpoint","prepareChange","interrupt","restartInterrupted","reconcile","change"]){
    const response=await request(step);const result=await response.json();
    if(step==="interrupt") {
      assert.equal(response.status,409);assert.equal(result.error,"Simulated lost acknowledgment");
      assert.equal((await request("arm")).status,409,"Unresolved intent must prevent restore");
      console.log("interrupt: expected lost acknowledgment; restore refused");continue;
    }
    assert.equal(response.status,200,`${step}: ${result.error}`);console.log(`${step}: ${result.phase}`);
  }
  if(preview){
    const namespace=await runtime.getDurableObjectNamespace("WORKSPACE");
    const state=await namespace.getByName("orbit-demo").probeState();
    await writeFile(join(folder,"preview.json"),JSON.stringify({origin,session:state.session,brokerage:config.vars.FIXTURE_A,
      loanId:`demo-presenter:${config.vars.FIXTURE_A}:closing`,requestId:state.lenderEvidence.requestId}),{mode:0o600});
    console.log(`Local preview ready at ${origin}`);
    await new Promise(()=>{});
  }
  assert.equal((await request("verify")).status,409,"Cannot verify before restoration");
  console.log("Local fixture preparation passed. No hosted restore claim.");
} finally {await runtime.dispose();}
