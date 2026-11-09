import test from "node:test";
import assert from "node:assert/strict";
import { demoRequest } from "../src/lib/demo-request.ts";

const input = { name: "Test Broker", email: "broker@example.test", brokerage: "Fictional Brokerage", teamSize: "2–5", interests: "Processing handoffs", website: "" };
const request = (body = input, headers = {}) => new Request("https://orbitlos.com/api/demo-request", {
  method: "POST", headers: { Origin: "https://orbitlos.com", "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
});
function environment() {
  const messages = [];
  return { messages, ORBIT_DEMO_INBOX: "demo-inbox@example.test",
    DEMO_EMAIL: { send: async message => { messages.push(message); return { messageId: "test" }; } },
    DEMO_RATE_LIMIT: { limit: async () => ({ success: true }) } };
}

test("valid requests send only to the fixed inbox with the prospect as reply-to", async () => {
  const env = environment();
  const response = await demoRequest(request(), env);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).sent, true);
  assert.equal(env.messages.length, 1);
  assert.equal(env.messages[0].to, env.ORBIT_DEMO_INBOX);
  assert.equal(env.messages[0].from.email, "demo@orbitlos.com");
  assert.equal(env.messages[0].replyTo, input.email);
  assert.match(env.messages[0].text, /Fictional Brokerage/);
});

test("cross-origin, invalid, and honeypot requests never send", async () => {
  for (const [req, status] of [[request(input, { Origin: "https://example.test" }), 403], [request({ ...input, email: "invalid" }), 400], [request({ ...input, email: "a@example.test\r\nBcc: bad@example.test" }), 400], [request({ ...input, website: "spam" }), 400], [request(input, { "Content-Type": "text/plain" }), 415]]) {
    const env = environment();
    assert.equal((await demoRequest(req, env)).status, status);
    assert.equal(env.messages.length, 0);
  }
});

test("oversized chunked bodies are rejected without a content-length header", async () => {
  const env = environment();
  const req = new Request("https://orbitlos.com/api/demo-request", { method: "POST", headers: { Origin: "https://orbitlos.com", "Content-Type": "application/json" }, duplex: "half", body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("x".repeat(8193))); c.close(); } }) });
  assert.equal((await demoRequest(req, env)).status, 413);
  assert.equal(env.messages.length, 0);
});

test("rate-limited requests return retry guidance and never send", async () => {
  const env = environment(); env.DEMO_RATE_LIMIT.limit = async () => ({ success: false });
  const response = await demoRequest(request(), env);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "60");
  assert.equal(env.messages.length, 0);
});

test("provider failure never returns a success confirmation", async () => {
  const env = environment(); env.DEMO_EMAIL.send = async () => { throw new Error("delivery unavailable"); };
  const response = await demoRequest(request(), env);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).sent, undefined);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});

test("missing bindings and unsupported methods fail closed", async () => {
  assert.equal((await demoRequest(request(), {})).status, 503);
  const env = environment();
  delete env.ORBIT_DEMO_INBOX;
  assert.equal((await demoRequest(request(), env)).status, 503);
  assert.equal(env.messages.length, 0);
  const response = await demoRequest(new Request("https://orbitlos.com/api/demo-request"), environment());
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("Allow"), "POST");
});
