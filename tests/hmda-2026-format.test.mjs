import assert from "node:assert/strict";
import test from "node:test";
import { checkHmda2026 } from "../scripts/check-hmda-2026.mjs";

const lei = "00000000000000000000";
function header(quarter = "4", count = "1") {
  return ["1", "Fictional Institution", "2026", quarter, "Fictional Reviewer", "555-010-0100",
    "reviewer@example.test", "1 Fictional Street", "Fictional City", "MI", "00000", "9", count, "00-0000000", lei];
}
function loan(date = "20260331") {
  const fields = Array(110).fill("");
  fields.splice(0, 12, "2", lei, "FICTIONAL1", "20260101", "1", "1", "2", "1", "1", "110500.24", "1", date);
  return fields;
}
const rows = (...records) => records.map(fields => fields.join("|"));

test("accepts the 2026 layout, a zero-row transmittal and quarterly cumulative dates", async () => {
  assert.equal((await checkHmda2026(rows(header(), loan()), "annual")).issueCount, 0);
  assert.equal((await checkHmda2026(rows(header("4", "0")), "annual")).issueCount, 0);
  assert.equal((await checkHmda2026(rows(header("2", "2"), loan(), loan("20260630")), "q2")).issueCount, 0);
  await assert.rejects(checkHmda2026([], "q4"), /annual, q1, q2 or q3/);
});

test("reports row count, year, quarter, entity and field errors without echoing values", async () => {
  const invalidHeader = header("4", "2");
  invalidHeader[2] = "2025";
  const invalidLoan = loan("20260230");
  invalidLoan[1] = "ANOTHERENTITY0000000";
  invalidLoan[9] = "1.2E3";
  invalidLoan[18] = "fixture-sensitive-value";
  const result = await checkHmda2026(rows(invalidHeader, invalidLoan), "q1");
  assert.deepEqual(result.issues.map(({line, field}) => [line, field]), [[1, 3], [1, 4], [2, 2], [2, 10], [2, 12], [2, 19], [1, 13]]);
  assert.doesNotMatch(JSON.stringify(result), /fixture-sensitive-value|ANOTHERENTITY/);
});

test("flags malformed records and bounds diagnostics for large bad files", async () => {
  const result = await checkHmda2026(rows(header("1", "2"), loan("20260401"), ["2", "unexpected pipe"]), "q1");
  assert.deepEqual(result.issues.map(({line, field}) => [line, field]), [[2, 12], [3, null]]);
  assert.match((await checkHmda2026([], "annual")).issues[0].message, /transmittal.*missing/);
  const many = await checkHmda2026([header("4", "120").join("|"), ...Array(120).fill("2")], "annual");
  assert.equal(many.issueCount, 120);
  assert.equal(many.issues.length, 100);
});
