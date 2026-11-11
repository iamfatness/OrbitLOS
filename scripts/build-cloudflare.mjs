import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { targets, verifyReleaseTarget } from "./cloudflare-targets.mjs";

const target = process.argv[2] ?? "production";
if (!Object.hasOwn(targets, target) || process.argv.length > 3) throw new Error("Choose production, dev, or stage.");
const env = { ...process.env, CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false" };
if (target === "production") delete env.CLOUDFLARE_ENV;
else env.CLOUDFLARE_ENV = target;
const result = spawnSync(process.execPath, [fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url)), "build"], {
  env, stdio: "inherit", cwd: fileURLToPath(new URL("../", import.meta.url)),
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
verifyReleaseTarget(JSON.parse(readFileSync(new URL("../dist/server/wrangler.json", import.meta.url), "utf8")), target);
console.log(`Verified ${target} build for ${targets[target].host}.`);
