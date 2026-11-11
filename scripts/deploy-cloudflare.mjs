import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { verifyReleaseTarget } from "./cloudflare-targets.mjs";

const inbox = z.email().max(254).safeParse(process.env.ORBIT_DEMO_INBOX?.trim());
if (!inbox.success) throw new Error("Set ORBIT_DEMO_INBOX to the verified demo recipient before deploying.");
const output = new URL("../dist/server/", import.meta.url);
const args = process.argv.slice(2);
let target = "production";
if (args[0] === "--target") { args.shift(); target = args.shift(); }
if (args.some((arg) => !["--dry-run", "--upload-only", "--prepare-directory-drain"].includes(arg))) throw new Error("Unsupported release option.");
const uploadOnly = args.includes("--upload-only");
const prepareDrain = args.includes("--prepare-directory-drain");
if (prepareDrain && !uploadOnly) throw new Error("Upload and verify the coordinator preparation version before deploying.");
const config = JSON.parse(readFileSync(new URL("wrangler.json", output), "utf8"));
verifyReleaseTarget(config, target);
const email = config.send_email?.find(({ name }) => name === "DEMO_EMAIL");
if (!email) throw new Error("The build is missing the DEMO_EMAIL binding.");
email.destination_address = inbox.data;
config.vars = { ...config.vars, ORBIT_DEMO_INBOX: inbox.data };
if (prepareDrain) config.vars.ORBIT_DRAIN_ROLLOUT = "prepare";

function provenance() {
  const git = (args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  try {
    if (git(["status", "--porcelain"])) return [];
    const commit = git(["rev-parse", "HEAD"]);
    return ["--tag", `git-${commit.slice(0, 12)}`, "--message", `OrbitLOS source ${commit}`];
  } catch {
    return [];
  }
}

const configPath = fileURLToPath(new URL(`wrangler.release-${randomUUID()}.json`, output));
const wrangler = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));
writeFileSync(configPath, JSON.stringify(config), { flag: "wx" });
try {
  const command = uploadOnly ? ["versions", "upload"] : ["deploy"];
  const result = spawnSync(process.execPath, [wrangler, ...command, "--config", configPath, ...provenance(),
    ...args.filter((arg) => arg === "--dry-run")], { stdio: "inherit" });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  unlinkSync(configPath);
}
