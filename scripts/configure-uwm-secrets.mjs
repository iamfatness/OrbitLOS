import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

if (process.env.UWM_ENVIRONMENT !== "stage" || !process.env.UWM_CLIENT_ID || !process.env.UWM_CLIENT_SECRET) {
  throw new Error("Load the verified stage environment before configuring this release.");
}
const wrangler = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));
const result = spawnSync(process.execPath, [wrangler, "versions", "secret", "bulk", "--config", "wrangler.jsonc", "--message", "Configure UWM stage credentials"], {
  input: JSON.stringify({ UWM_CLIENT_ID: process.env.UWM_CLIENT_ID, UWM_CLIENT_SECRET: process.env.UWM_CLIENT_SECRET }),
  encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
});
// Wrangler only receives secrets over stdin. Never print their values.
if (result.status !== 0) {
  console.error("UWM secret installation failed. Inspect the Cloudflare deployment configuration.");
  let diagnostic = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  for (const value of [process.env.UWM_CLIENT_ID, process.env.UWM_CLIENT_SECRET]) diagnostic = diagnostic.split(value).join("[redacted]");
  console.error(diagnostic.slice(-4000));
  process.exitCode = 1;
} else {
  console.log("Created Worker version with UWM_CLIENT_ID and UWM_CLIENT_SECRET; deploy the verified version to activate.");
  let diagnostic = result.stdout;
  for (const value of [process.env.UWM_CLIENT_ID, process.env.UWM_CLIENT_SECRET]) diagnostic = diagnostic.split(value).join("[redacted]");
  console.log(diagnostic);
}
