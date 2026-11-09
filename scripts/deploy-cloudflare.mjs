import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const inbox = z.email().max(254).safeParse(process.env.ORBIT_DEMO_INBOX?.trim());
if (!inbox.success) throw new Error("Set ORBIT_DEMO_INBOX to the verified demo recipient before deploying.");
const output = new URL("../dist/server/", import.meta.url);
const config = JSON.parse(readFileSync(new URL("wrangler.json", output), "utf8"));
const email = config.send_email?.find(({ name }) => name === "DEMO_EMAIL");
if (!email) throw new Error("The build is missing the DEMO_EMAIL binding.");
email.destination_address = inbox.data;
config.vars = { ...config.vars, ORBIT_DEMO_INBOX: inbox.data };

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
  const result = spawnSync(process.execPath, [wrangler, "deploy", "--config", configPath, ...provenance(), ...process.argv.slice(2)], { stdio: "inherit" });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  unlinkSync(configPath);
}
