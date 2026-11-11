import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { targets, verifyReleaseTarget } from "../scripts/cloudflare-targets.mjs";
const root = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
test("release targets isolate hosts, Workers and storage and preserve production", () => {
  for (const name of Object.keys(targets)) {
    const config = name === "production" ? root : { ...root, ...root.env[name] };
    verifyReleaseTarget(config, name);
    for (const other of Object.keys(targets).filter(value => value !== name)) assert.throws(() => verifyReleaseTarget(config, other));
    const shared = structuredClone(config);
    shared.durable_objects.bindings[0].script_name = "orbit-crm-demo";
    assert.throws(() => verifyReleaseTarget(shared, name));
    const badBucket = structuredClone(config);
    badBucket.r2_buckets[0].bucket_name = "wrong-bucket";
    assert.throws(() => verifyReleaseTarget(badBucket, name));
  }
  assert.equal(root.name, "orbit-crm-demo");
  assert.equal(root.r2_buckets[0].bucket_name, "orbitlos-private-documents");
});
