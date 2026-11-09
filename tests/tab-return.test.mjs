import assert from "node:assert/strict";
import test from "node:test";
import { observeTabReturn, observeVisibleChecks } from "../src/lib/tab-return.ts";
import { announceBorrowerChange, borrowerChangeChannel, borrowerChecklistToken } from "../src/lib/borrower-change-signal.ts";

function tabs() {
  const page = Object.assign(new EventTarget(), { hidden: false, hasFocus: () => true });
  const windowEvents = new EventTarget();
  return {
    page,
    windowEvents,
    visibility(hidden) {
      page.hidden = hidden;
      page.dispatchEvent(new Event("visibilitychange"));
    },
    focus(focused) { windowEvents.dispatchEvent(new Event(focused ? "focus" : "blur")); },
  };
}

test("tab visibility and focus trigger one refresh for each return", () => {
  const { page, windowEvents, visibility, focus } = tabs();
  const reads = [];
  const stop = observeTabReturn(page, windowEvents, (isCurrent) => reads.push(isCurrent));
  focus(true);
  assert.equal(reads.length, 0);

  focus(false);
  visibility(true);
  focus(true);
  assert.equal(reads.length, 0);
  visibility(false);
  focus(true);
  assert.equal(reads.length, 1);
  assert.equal(reads[0](), true);

  focus(false);
  assert.equal(reads[0](), false);
  focus(true);
  assert.equal(reads.length, 2);
  assert.equal(reads[1](), true);
  stop();
  assert.equal(reads[1](), false);
  visibility(true);
  visibility(false);
  assert.equal(reads.length, 2);
});

test("a loan opened in the background refreshes when its tab becomes visible", () => {
  const { page, windowEvents, visibility } = tabs();
  visibility(true);
  let returned = false;
  const stop = observeTabReturn(page, windowEvents, () => { returned = true; });
  assert.equal(returned, false);
  visibility(false);
  assert.equal(returned, true);
  stop();
});

test("foreground checks pause when hidden and discard an in-flight response after hiding", async () => {
  const { page, visibility } = tabs();
  let nextTimer = 0;
  const scheduled = new Map();
  const timers = {
    setInterval(tick, delay) {
      assert.equal(delay, 15_000);
      scheduled.set(++nextTimer, tick);
      return nextTimer;
    },
    clearInterval(id) { scheduled.delete(id); },
  };
  const reads = [];
  visibility(true);
  const stop = observeVisibleChecks(page, timers, (isCurrent) => new Promise((resolve) => reads.push({ isCurrent, resolve })));
  assert.equal(scheduled.size, 0);
  visibility(false);
  assert.equal(scheduled.size, 1);
  scheduled.get(1)();
  scheduled.get(1)();
  assert.equal(reads.length, 1);
  assert.equal(reads[0].isCurrent(), true);
  visibility(true);
  visibility(false);
  assert.equal(scheduled.has(1), false);
  assert.equal(reads[0].isCurrent(), false);
  reads[0].resolve();
  await Promise.resolve();
  scheduled.get(2)();
  assert.equal(reads.length, 2);
  assert.equal(reads[1].isCurrent(), true);
  stop();
  assert.equal(scheduled.size, 0);
  assert.equal(reads[1].isCurrent(), false);
  reads[1].resolve();
});

test("a focused queue can use a shorter interval that still stops when hidden", () => {
  const { page, visibility } = tabs();
  let interval;
  const timers = {
    setInterval(_tick, delay) { interval = delay; return 1; },
    clearInterval() { interval = undefined; },
  };
  const stop = observeVisibleChecks(page, timers, async () => {}, 5_000);
  assert.equal(interval, 5_000);
  visibility(true);
  assert.equal(interval, undefined);
  visibility(false);
  assert.equal(interval, 5_000);
  stop();
  assert.equal(interval, undefined);
});

test("a same-browser notification carries no borrower details and uses a loan-specific channel", { timeout: 3000 }, async (t) => {
  const token = "1".repeat(64);
  const [sameLoan, differentLoan] = await Promise.all([borrowerChangeChannel(token), borrowerChangeChannel("2".repeat(64))]);
  t.after(() => { sameLoan?.close(); differentLoan?.close(); });
  assert.ok(sameLoan && differentLoan);
  assert.notEqual(sameLoan.name, differentLoan.name);
  assert.equal(sameLoan.name.includes(token), false);
  const update = new Promise((resolve) => { sameLoan.onmessage = (event) => resolve(event.data); });
  await announceBorrowerChange(token);
  assert.equal(await update, "changed");
  const checklistUpdate = new Promise((resolve) => { sameLoan.onmessage = (event) => resolve(event.data); });
  await announceBorrowerChange(token, "checklist-changed");
  assert.equal(await checklistUpdate, "checklist-changed");
});

test("checklist writes signal only the matching submitted and unrevoked application", () => {
  const submittedAt = "2026-11-09T14:00:00.000Z";
  const applications = [
    { loanId: "one", submittedAt, revokedAt: null, token: "first" },
    { loanId: "two", submittedAt, revokedAt: null, token: "second" },
    { loanId: "draft", submittedAt: null, revokedAt: null, token: "draft" },
    { loanId: "revoked", submittedAt, revokedAt: submittedAt, token: "revoked" },
  ];
  for (const type of ["requestDocument", "requestSuggestedUwmDocuments", "applyDocumentPreset", "setDocumentDeadline", "reviewDocument", "reopenMockUwmCondition"]) {
    assert.equal(borrowerChecklistToken({ type, loanId: "two" }, applications), "second");
  }
  for (const input of [null, { type: "refreshApplication", loanId: "one" }, { type: "requestDocument" },
    { type: "requestDocument", loanId: "draft" }, { type: "requestDocument", loanId: "revoked" }]) {
    assert.equal(borrowerChecklistToken(input, applications), undefined);
  }
});
