import { createHash, randomBytes, randomUUID } from "node:crypto";
import { cp, mkdir, readFile, writeFile, copyFile, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { registerHooks } from "node:module";

registerHooks({resolve(specifier,context,next) {
  try {return next(specifier,context);} catch(error) {
    if(error.code!=="ERR_MODULE_NOT_FOUND"||!specifier.startsWith("./"))throw error;
    return next(`${specifier}.ts`,context);
  }
}});

const root = new URL("../",import.meta.url);
if (execFileSync("git",["status","--porcelain"],{cwd:fileURLToPath(root),encoding:"utf8"}).trim()) throw new Error("Commit the rehearsal before preparing hosted provenance");
const source = execFileSync("git",["rev-parse","HEAD"],{cwd:fileURLToPath(root),encoding:"utf8"}).trim();
const built = JSON.parse(await readFile(new URL("dist/server/wrangler.json",root),"utf8"));
if (built.main !== "index.js" || !built.no_bundle) throw new Error("Build Orbit first");
const run = randomUUID(), name = `orbit-recovery-${run.slice(0,8)}`;
const folder = new URL(`.orbit/${name}/`,root);
await mkdir(folder,{recursive:true});
await cp(new URL("dist/server/",root),new URL("server/",folder),{recursive:true});
await copyFile(new URL("scripts/hosted-recovery/worker.template.mjs",root),new URL("server/recovery-entry.mjs",folder));
await copyFile(new URL("scripts/cutover-replacement-fixture.mjs",root),new URL("server/recovery-replacement.mjs",folder));
const {blankApplication,sampleApplication,applicationSteps}=await import("../src/lib/application-model.ts");
await writeFile(new URL("server/recovery-fixtures.mjs",folder),
  `export const sampleDraft=${JSON.stringify({...sampleApplication(blankApplication()),confirmedDemo:true})};\nexport const finalStep=${applicationSteps.length-1};\n`);
const artifact = createHash("sha256");
for (const path of (await readdir(new URL("server/",folder),{recursive:true})).filter(path=>/\.m?js$/.test(path)).sort()) {
  const bytes=await readFile(new URL(`server/${path.replaceAll('\\','/')}`,folder));
  artifact.update(JSON.stringify([path.replaceAll('\\','/'),bytes.length]));artifact.update(bytes);
}
const artifactSha256=artifact.digest("hex");
const config = { name, main:"server/recovery-entry.mjs", no_bundle:true, find_additional_modules:true,
  rules:[{type:"ESModule",globs:["**/*.js","**/*.mjs"]}], compatibility_date:built.compatibility_date,
  compatibility_flags:built.compatibility_flags, workers_dev:true, preview_urls:false,
  durable_objects:{bindings:[{name:"WORKSPACE",class_name:"RecoveryWorkspace"}]}, migrations:[{tag:"v1",new_sqlite_classes:["RecoveryWorkspace"]}],
  r2_buckets:[{binding:"DOCUMENTS",bucket_name:`${name}-documents`}],
  vars:{RECOVERY_RUN:run,RECOVERY_SOURCE:source,RECOVERY_ARTIFACT:artifactSha256,FIXTURE_A:randomUUID(),FIXTURE_B:randomUUID(),
    ORBIT_AUTH_MODE:"google",GOOGLE_CLIENT_ID:"fictional-recovery",GOOGLE_CLIENT_SECRET:"fictional-recovery",ORBIT_STAFF_EMAILS:"recovery-bootstrap@example.test",
    ORBIT_PRICING_MODE:"mock",ORBIT_DOCUMENT_UPLOADS:"mock"}, limits:{cpu_ms:1000} };
await writeFile(new URL("wrangler.json",folder),JSON.stringify(config,null,2));
await writeFile(new URL("secrets.json",folder),JSON.stringify({RECOVERY_TOKEN:randomBytes(32).toString("base64url")}),{mode:0o600});
await writeFile(new URL("run.json",folder),JSON.stringify({run,source,artifactSha256,name,bucket:`${name}-documents`,config:fileURLToPath(new URL("wrangler.json",folder))},null,2));
console.log(JSON.stringify({directory:fileURLToPath(folder),name,bucket:`${name}-documents`,source}));
