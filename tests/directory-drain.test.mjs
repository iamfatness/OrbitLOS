import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({resolve(specifier, context, next) {
  try { return next(specifier, context); }
  catch (error) {
    if (error.code !== "ERR_MODULE_NOT_FOUND" || !specifier.startsWith("./")) throw error;
    return next(`${specifier}.ts`, context);
  }
}});
const { directoryDrainStatus, trackDirectoryResponse } = await import("../src/lib/directory-drain.ts");

test("directory status is incident-scoped and rejects a replaced pause marker", async () => {
  const token = "a".repeat(64);
  const marker = { incident: "fictional", statusTokenSha256: createHash("sha256").update(token).digest("hex") };
  let version = "original";
  const bucket = {
    get: async () => ({size:200, version:"original", json:async () => marker}),
    head: async () => ({version}),
  };
  const request = (token) => new Request("https://fictional.example/api/ops/directory-drain", {
    headers:{Authorization:`Bearer ${token}`},
  });
  const counts = async () => ({active:2, http:1, alarms:1, oldestAt:123});
  assert.equal((await directoryDrainStatus(request("b".repeat(64)),bucket,counts)).status,404);
  const response = await directoryDrainStatus(request(token),bucket,counts);
  assert.equal(response.status,200);
  assert.equal(response.headers.get("Cache-Control"),"private, no-store");
  assert.equal((await response.json()).state,"Tracked work outstanding");
  version = "replacement";
  assert.equal((await directoryDrainStatus(request(token),bucket,counts)).status,409);
});

test("a response retains its work ticket through streaming and registered background work", async () => {
  const waiting = [];
  const context = {waitUntil(work) {waiting.push(work);}};
  const background = Promise.withResolvers();
  let endCalls = 0;
  let stream;
  const response = await trackDirectoryResponse(context,async () => {endCalls++;},async tracked => {
    tracked.waitUntil(background.promise);
    return new Response(new ReadableStream({start(controller) {stream = controller;}}));
  });
  const reading = response.text();
  stream.enqueue(new TextEncoder().encode("fictional"));
  assert.equal(endCalls,0);
  stream.close();
  assert.equal(await reading,"fictional");
  assert.equal(endCalls,0);
  background.resolve();
  await Promise.all(waiting);
  assert.equal(endCalls,1);
});
