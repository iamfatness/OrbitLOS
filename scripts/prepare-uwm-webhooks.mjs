import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const args = process.argv.slice(2), config = {};
for (let i = 0; i < args.length; i += 2) {
  const environment = args[i]?.replace(/^--/, "");
  if (!["int", "stage", "production"].includes(environment) || config[environment] || !z.uuid().safeParse(args[i + 1]).success) {
    throw new Error("Usage: node scripts/prepare-uwm-webhooks.mjs [--int UUID] [--stage UUID] [--production UUID]");
  }
  config[environment] = { brokerageId: args[i + 1], token: randomBytes(32).toString("hex") };
}
const entries = Object.entries(config);
if (!entries.length || new Set(entries.map(([, value]) => value.brokerageId)).size !== entries.length) {
  throw new Error("Supply at least one environment and a distinct brokerage UUID for each environment.");
}
const directory = new URL("../.orbit/", import.meta.url);
const paths = entries.map(([environment]) => ({ environment,
  config: new URL(`uwm-webhook-config.${environment}.json`, directory),
  credentials: new URL(`uwm-webhook-credentials.${environment}.txt`, directory) }));
if (paths.some((path) => existsSync(path.config) || existsSync(path.credentials))) throw new Error("Webhook configuration already exists. Refusing to overwrite credentials.");
mkdirSync(directory, { recursive: true });
for (const path of paths) {
  const environment = path.environment, value = config[environment];
  const host = { int: "dev.orbitlos.com", stage: "stage.orbitlos.com", production: "orbitlos.com" }[environment];
  writeFileSync(path.config, JSON.stringify({ [environment]: value }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  writeFileSync(path.credentials,
    `${environment.toUpperCase()} — share with UWM only through the agreed secure channel\nX-API-Key: ${value.token}\nBrokerage: ${value.brokerageId}\nReceivers: https://${host}/api/webhooks/uwm/${environment}/{import|status|conditions|ulad}\n`, { flag: "wx", mode: 0o600 });
}
console.log(`Prepared ${entries.map(([name]) => name).join(", ")} configuration in ${fileURLToPath(directory)}. Tokens were not printed. Nothing was deployed.`);
