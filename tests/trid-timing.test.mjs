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
const { tridElements } = await import("../src/lib/trid-model.ts");
const { preciseBusinessDay, tridTiming } = await import("../src/lib/trid-timing.ts");

const now = "2026-07-20T12:00:00Z";
const scope = { type: "scope", coveredScenario: true, creditor: "Fictional creditor", leSender: "Creditor",
  zone: "America/Detroit", openWeekdays: [1, 2, 3, 4, 5], calendarFrom: "2026-07-01",
  calendarThrough: "2026-07-31", closures: ["2026-07-03"], extraOpen: [], reference: "Scope-1" };
const elements = Object.keys(tridElements).map((element, index) => ({
  type: "element", element, on: index === 5 ? "2026-07-02" : "2026-07-01", reference: "Intake-1",
}));
const le = { type: "sent", document: "Initial LE", version: "LE-1", sender: "Creditor", method: "Mail", on: "2026-07-03" };
const cd = { type: "sent", document: "Initial CD", version: "CD-1", sender: "Settlement agent", method: "Mail", on: "2026-07-08" };
const calculate = events => tridTiming(events.map((event, index) => ({ sequence: index + 1, event })), now);

test("the sixth receipt starts the clock and each timing check uses the correct calendar", () => {
  const result = calculate([scope, ...elements, le, cd, { type: "closing", on: "2026-07-14" }]);
  assert.equal(result.applicationOn, "2026-07-02");
  assert.equal(result.leDue, "2026-07-08");
  assert.equal(result.leEarliest, "2026-07-13");
  assert.equal(result.cdReceipt, "2026-07-11");
  assert.equal(result.cdEarliest, "2026-07-15");
  assert.equal(result.cdWait, "Scheduled date falls short");
  assert.equal(preciseBusinessDay("2026-07-03"), true);
  assert.equal(preciseBusinessDay("2026-07-04"), false);
  assert.equal(preciseBusinessDay("2027-06-19"), false);
  assert.equal(preciseBusinessDay("2026-11-26"), false);
});

test("incomplete calendars and unresolved delivery cannot produce a positive result", () => {
  assert.equal(calculate([scope, ...elements.slice(0, 5)]).applicationOn, null);
  assert.equal(calculate([{ ...scope, calendarThrough: "2026-07-07" }, ...elements]).leDue, null);
  assert.equal(calculate([scope, ...elements, { ...le, sender: "Broker" }]).leEarliest, null);
  const electronic = { ...cd, method: "Electronic" };
  assert.equal(calculate([scope, ...elements, electronic]).cdEarliest, null);
  const receipt = { type: "received", document: "Initial CD", version: "CD-1", on: "2026-07-09" };
  assert.equal(calculate([scope, ...elements, electronic, receipt]).cdEarliest, "2026-07-13");
  assert.equal(calculate([scope, ...elements, electronic, receipt, { ...cd, document: "Corrected CD" }]).cdEarliest, null);
  assert.equal(calculate([scope, ...elements, { type: "void", sequence: 7 }]).applicationOn, null);
});
