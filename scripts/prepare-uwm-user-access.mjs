import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export function prepareUwmUserConfig(env, target, brokerageId) {
  const environment = { dev: "int", stage: "stage", production: "production" }[target];
  if (!environment || !z.uuid().safeParse(brokerageId).success) throw new Error("Choose a valid target and existing non-pilot brokerage UUID.");
  // Explicit source environment is mandatory. Never infer production from a host.
  if (env.UWM_ENVIRONMENT !== environment || !env.UWM_CLIENT_ID?.trim() || !env.UWM_CLIENT_SECRET?.trim()) {
    throw new Error("Load the matching UWM environment and complete client credential pair first.");
  }
  return { UWM_BROKERAGE_ID: brokerageId, UWM_USER_ENVIRONMENT: environment,
    UWM_USER_CLIENT_ID: env.UWM_CLIENT_ID, UWM_USER_CLIENT_SECRET: env.UWM_CLIENT_SECRET,
    UWM_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("hex") };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , target, brokerageId, ...extra] = process.argv;
  if (extra.length) throw new Error("Usage: node scripts/prepare-uwm-user-access.mjs <dev|stage|production> <brokerage UUID>");
  const config = prepareUwmUserConfig(process.env, target, brokerageId);
  const directory = new URL("../.orbit/", import.meta.url);
  mkdirSync(directory, { recursive: true });
  const path = new URL(`uwm-user-access.${target}.json`, directory);
  // Refuse overwrite: rotating encryption keys invalidates existing authorizations.
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  console.log(`Prepared ${target} user-access secrets in ${fileURLToPath(path)}. Nothing was deployed; credentials were not printed.`);
}
