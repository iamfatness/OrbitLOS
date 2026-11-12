import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import fixture from "./fixtures/mcr-fv7-pipeline.json" with { type: "json" };

registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context); }
  catch (error) {
    if (error.code !== "ERR_MODULE_NOT_FOUND" || !specifier.startsWith("./")) throw error;
    return next(`${specifier}.ts`, context);
  }
} });
const { reconcileFv7Pipeline } = await import("../src/lib/mcr-fv7-pipeline.ts");

test("FV7 workpaper reconciles five outcomes and signed adjustments by state and intake source", () => {
  const report = reconcileFv7Pipeline(fixture);
  const [state] = report.states;
  assert.equal(report.reconciled, true);
  assert.deepEqual(state.direct.calculated, { AC066: { count: 4, amount: 775000 }, AC090: { count: 4, amount: 775000 } });
  assert.deepEqual(state.thirdParty.calculated, { AC066: { count: 1, amount: 200000 }, AC090: { count: 1, amount: 200000 } });

  const revised = structuredClone(fixture);
  revised.states[0].direct.AC063 = { count: -1, amount: -150000 };
  revised.states[0].direct.AC070 = { count: 1, amount: 240000 };
  revised.states[0].direct.AC080 = { count: 1, amount: 235000 };
  assert.equal(reconcileFv7Pipeline(revised).reconciled, true);
});

test("an amount can balance overall while both intake columns still need review", () => {
  const workpaper = structuredClone(fixture);
  workpaper.states[0].direct.AC080.amount -= 100;
  workpaper.states[0].thirdParty.AC080.amount += 100;
  const result = reconcileFv7Pipeline(workpaper);
  assert.equal(result.reconciled, false);
  assert.match(result.states[0].direct.issues.join(), /AC066 and AC090 differ/);
  assert.match(result.states[0].thirdParty.issues.join(), /AC066 and AC090 differ/);
});

test("the workpaper preserves missing inputs and detects prior-ending differences and undocumented adjustments", () => {
  const workpaper = structuredClone(fixture);
  const [state] = workpaper.states;
  state.direct.AC065 = null;
  state.direct.priorEnding.amount += 100;
  state.thirdParty.priorEnding = null;
  state.adjustmentCommentary = "";
  const result = reconcileFv7Pipeline(workpaper);
  assert.equal(result.reconciled, false);
  assert.equal(result.states[0].direct.calculated.AC066, null);
  assert.match(result.states[0].direct.issues.join(), /AC065.*AC010 does not match/);
  assert.match(result.states[0].thirdParty.issues.join(), /Prior-quarter ending totals are missing/);
  assert.match(result.states[0].issues.join(), /AC063 adjustments/);
});

test("explicit zero activity reconciles, while unsupported years, duplicate jurisdictions and malformed inputs fail", () => {
  const zero = { count: 0, amount: 0 };
  const column = Object.fromEntries(Object.keys(fixture.states[0].direct).map((key) => [key, key === "AC065" ? 0 : zero]));
  const workpaper = { ...fixture, states: [{ state: "MI", direct: column, thirdParty: column, adjustmentCommentary: "" }] };
  assert.equal(reconcileFv7Pipeline(workpaper).reconciled, true);
  assert.throws(() => reconcileFv7Pipeline({ ...workpaper, year: 2025 }), /2026/);
  assert.throws(() => reconcileFv7Pipeline({ ...workpaper, states: [...workpaper.states, ...workpaper.states] }), /each jurisdiction once/);
  assert.throws(() => reconcileFv7Pipeline({ ...workpaper, states: [{ ...workpaper.states[0], state: "ZZ" }] }), /reporting jurisdiction/);
  assert.throws(() => reconcileFv7Pipeline({ ...workpaper, states: [{ ...workpaper.states[0], direct: { ...column, AC065: 0.5 } }] }), /AC065/);
});
