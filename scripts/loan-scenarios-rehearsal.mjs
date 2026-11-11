import assert from 'node:assert/strict';
import { createRequire, registerHooks } from 'node:module';
import { createHash, randomBytes } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
registerHooks({resolve(specifier,context,next){try{return next(specifier,context);}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND'||!specifier.startsWith('./'))throw error;return next(`${specifier}.ts`,context);}}});
const {sampleScenarioPlan}=await import('../src/lib/loan-scenario-model.ts');
const {Miniflare,convertV4MiniflareOptions}=createRequire(import.meta.resolve('wrangler'))('miniflare');
const server=fileURLToPath(new URL('../dist/server/',import.meta.url));
const client=resolve(server,'../client');
const config=JSON.parse(await readFile(join(server,'wrangler.json'),'utf8'));
const token=randomBytes(32).toString('base64url');
const serve=process.argv.includes('--serve');
const entry=`import worker, {OrbitWorkspace} from './index.js'; export {OrbitWorkspace}; export default {fetch(request,env,ctx){
  if (${serve} && new URL(request.url).pathname === '/scenario-fixture-start') return new Response(null,{status:302,headers:{Location:'/workspace','Set-Cookie':'__Host-orbit-session=${token}; Path=/; Secure; HttpOnly; SameSite=Lax'}});
  return worker.fetch(request,env,ctx);}};`;
const runtime=new Miniflare({...convertV4MiniflareOptions({name:'orbit-scenario-rehearsal',host:'127.0.0.1',
  ...(serve?{port:3437}:{}),modules:[{type:'ESModule',path:join(server,'scenario-fixture.mjs'),contents:entry},
    ...(await readdir(server,{recursive:true,withFileTypes:true})).filter(file=>file.isFile()&&/\.m?js$/.test(file.name)).map(file=>({type:'ESModule',path:join(file.parentPath,file.name)}))],
  modulesRoot:server,compatibilityDate:config.compatibility_date,compatibilityFlags:config.compatibility_flags,
  bindings:{ORBIT_AUTH_MODE:'google',GOOGLE_CLIENT_ID:'fixture',GOOGLE_CLIENT_SECRET:'fixture',ORBIT_STAFF_EMAILS:'scenario-owner@example.test',ORBIT_DOCUMENT_UPLOADS:'mock',ORBIT_PRICING_MODE:'mock'},
  serviceBindings:{ASSETS:async request=>{const path=resolve(client,'.'+decodeURIComponent(new URL(request.url).pathname));
    if(!path.startsWith(client+sep))return new Response(null,{status:404});
    try{return new Response(await readFile(path),{headers:{'Content-Type':({'.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.png':'image/png','.svg':'image/svg+xml'})[extname(path)]??'application/octet-stream'}});}catch{return new Response(null,{status:404});}}},
    r2Buckets: { DOCUMENTS: "scenario-fictional-documents" },
  durableObjects:{WORKSPACE:{className:'OrbitWorkspace',useSQLite:true}},
}),telemetry:{enabled:false}});
try {
 const {origin}=await runtime.ready;
 const workspace=(await runtime.getDurableObjectNamespace('WORKSPACE')).getByName('orbit-demo');
 const staff={email:'scenario-owner@example.test',name:'Scenario Owner',brokerage:{id:'orbit-demo',name:'Orbit demo',role:'Admin',pilot:false}};
 await workspace.activateStaff({email:staff.email,name:staff.name},[staff.email]);
 await workspace.createStaffSession(createHash('sha256').update(token).digest('base64url'),{email:staff.email,name:staff.name},Date.now()+3600000,Date.now());
 const seeded=await workspace.loadExploration(staff,{type:'loadPilotExploration',officerEmail:staff.email},[{email:staff.email,name:staff.name,role:'Admin',status:'Active'}]);
 assert.ok(seeded.message);
 const state=await workspace.read(staff);
 const loan=state.loans.find(loan=>loan.officerEmail===staff.email&&loan.stage==='Lead');assert.ok(loan);
 async function request(input,headers={}){const response=await runtime.dispatchFetch(`${origin}/api/loan-scenarios`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:`__Host-orbit-session=${token}`,...headers},body:JSON.stringify(input)});return{status:response.status,body:response.headers.get('Content-Type')?.includes('application/json')?await response.json():await response.text()};}
 const read=await request({type:'read',loanId:loan.id});assert.equal(read.status,200);assert.equal(read.body.record,null);
 const plan=sampleScenarioPlan(loan.amount*100,'Purchase');
 const input={type:'save',loanId:loan.id,revision:0,applicationRevision:null,plan};
 const save=await request(input);assert.equal(save.status,200);assert.equal(save.body.record.revision,1);
 assert.equal((await request(input)).status,409);
 assert.equal((await request({type:'read',loanId:'not-visible'})).status,409);
 assert.equal((await request(input,{Origin:'https://elsewhere.example.test'})).status,403);
 assert.deepEqual((await request({type:'read',loanId:loan.id})).body.record.plan,plan);
 console.log('Scenario Worker rehearsal passed: authenticated save/read, revision conflict, inaccessible file and cross-origin rejection.');
 if(serve){console.log(`Browser fixture: ${origin}/scenario-fixture-start (open Olivia Parker, assigned to Scenario Owner)`);await new Promise(resolve=>process.once('SIGINT',resolve));}
} finally {await runtime.dispose();}
