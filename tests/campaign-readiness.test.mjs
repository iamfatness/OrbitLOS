import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context); }
  catch (error) {
    if (error.code !== "ERR_MODULE_NOT_FOUND" || !specifier.startsWith("./")) throw error;
    return next(`${specifier}.ts`, context);
  }
} });
const { sequenceWorkLabel } = await import("../src/lib/campaign-sequence-model.ts");
const { campaignCallQueues } = await import("../src/lib/call-campaign-model.ts");
test("reactivation readiness distinguishes future, due, paused and contact-hour delayed work", () => {
  const now = Date.parse("2026-11-10T15:00:00Z");
  const sequence = { position: 1, title: "Reconnect", channel: "Call", dueAt: "2026-11-11T15:00:00Z", paused: false };
  const record = { member: { leadId: "fictional", attempts: 0, sequenceKind: "Cold Lead Reactivation", sequence }, lead: { officerEmail: "lo@example.test", followUp: {} }, optedOut: false };
  assert.equal(campaignCallQueues([record], now).firstCalls.length, 0);
  assert.equal(sequenceWorkLabel(sequence, now), "Call step scheduled");
  const due = { ...sequence, dueAt: "2026-11-10T15:00:00Z" };
  assert.equal(sequenceWorkLabel(due, now), "Call step due");
  assert.equal(sequenceWorkLabel(due, now, "2026-11-10T17:00:00Z"), "Call step scheduled");
  assert.equal(sequenceWorkLabel({ ...due, paused: true }, now), "Sequence paused");
  assert.equal(sequenceWorkLabel({ ...due, channel: "Email" }, now), "Email step due");
  assert.equal(sequenceWorkLabel({ ...sequence, channel: "Text" }, now), "Text step scheduled");
  assert.equal(campaignCallQueues([{ ...record, member: { ...record.member, sequenceKind: undefined, sequence: undefined } }], now).firstCalls.length, 1);
});
