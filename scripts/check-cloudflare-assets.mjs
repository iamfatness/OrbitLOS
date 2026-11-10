import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

const version = process.argv[2];
const live = version === "--live";
if (!live && !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(version ?? "")) {
  throw new Error("Pass the staged Cloudflare version or --live for ordinary routing.");
}
const headers = live ? undefined : { "Cloudflare-Workers-Version-Overrides": `orbit-crm-demo="${version}"` };
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const groups = [{ directory: "chunks", extension: ".js", type: "javascript" }, { directory: "css", extension: ".css", type: "text/css" }];
const client = new URL("../dist/client/", import.meta.url);
const assets = (await Promise.all(groups.map(async ({ directory, extension, type }) => {
  const path = `_next/static/${directory}/`;
  const names = (await readdir(new URL(path, client))).filter((name) => name.endsWith(extension));
  if (!names.length) throw new Error(`No built assets found in ${path}. Run the production build first.`);
  return Promise.all(names.map(async (name) => ({ path: path + name, type, hash: digest(await readFile(new URL(path + name, client))) })));
}))).flat();

async function check(asset) {
  try {
    const result = await fetch(`https://orbitlos.com/${asset.path}`, { headers, redirect: "error", signal: AbortSignal.timeout(8000) });
    const hash = digest(Buffer.from(await result.arrayBuffer()));
    if (!result.ok) return `${asset.path} (${result.status})`;
    if (!result.headers.get("content-type")?.includes(asset.type) || hash !== asset.hash) return `${asset.path} (response differs from build)`;
  } catch (error) {
    return `${asset.path} (${error.message})`;
  }
}

let clean = 0;
const attempts = live ? 3 : 15;
for (let attempt = 1; attempt <= attempts; attempt++) {
  const failures = (await Promise.all(assets.map(check))).filter(Boolean);
  clean = failures.length ? 0 : clean + 1;
  console.log(`${live ? "Live" : "Staged"} asset check ${attempt} · ${assets.length - failures.length}/${assets.length} matched · ${clean}/2 clean passes`);
  for (const failure of failures) console.log(failure);
  if (clean === 2) break;
  if (attempt < attempts) await delay(4000);
}
if (clean < 2) {
  console.error(live ? "Ordinary traffic did not consistently return the expected assets." :
    "The staged assets are still inconsistent. Leave the current release serving normal traffic.");
  process.exitCode = 1;
}
