export const targets = {
  production: { worker: "orbit-crm-demo", host: "orbitlos.com", bucket: "orbitlos-private-documents" },
  dev: { worker: "orbitlos-dev", host: "dev.orbitlos.com", bucket: "orbitlos-dev-private-documents" },
  stage: { worker: "orbitlos-stage", host: "stage.orbitlos.com", bucket: "orbitlos-stage-private-documents" },
};
export function verifyReleaseTarget(config, target) {
  const expected = targets[target];
  if (!expected || config.name !== expected.worker || config.vars?.ORBIT_DEPLOYMENT !== target ||
      config.routes?.length !== 1 || config.routes[0].pattern !== expected.host || config.routes[0].custom_domain !== true ||
      config.r2_buckets?.length !== 1 || config.r2_buckets[0].bucket_name !== expected.bucket ||
      config.durable_objects?.bindings?.length !== 1 || config.durable_objects.bindings[0].class_name !== "OrbitWorkspace" ||
      config.durable_objects.bindings[0].script_name || config.durable_objects.bindings[0].environment) {
    throw new Error(`Build does not match ${target}. Run npm run build:cloudflare${target === "production" ? "" : `:${target}`} first.`);
  }
}
