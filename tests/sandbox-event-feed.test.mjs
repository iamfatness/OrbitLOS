import assert from "node:assert/strict";
import test from "node:test";
import { sandboxEventPage } from "../src/lib/sandbox-event-feed.ts";

const page = query => sandboxEventPage(new URLSearchParams(query));

test("the fictional event feed pages in emission order and preserves the checkpoint for the next poll", () => {
  const full = page();
  const first = page("limit=2");
  const second = page("limit=2&after=" + first.nextCursor);
  const last = page("limit=2&after=" + second.nextCursor);
  const empty = page("limit=2&after=" + last.nextCursor);
  assert.equal(first.mode, "sandbox");
  assert.equal(first.hasMore, true);
  assert.equal(second.hasMore, true);
  assert.equal(last.hasMore, false);
  assert.deepEqual([...first.events, ...second.events, ...last.events], full.events);
  assert.deepEqual(empty, { mode: "sandbox", events: [], nextCursor: last.nextCursor, hasMore: false });
  assert.deepEqual(full.events.map(event => event.eventType), [
    "lead.created", "application.submitted", "loan.funded", "loan.funding_updated", "loan.funding_reversed",
  ]);
  assert.equal(new Set(full.events.map(event => event.eventId)).size, full.events.length);
  assert.deepEqual(full.events.slice(-3).map(event => event.resource.revision), [1, 2, 3]);
});

test("the fictional feed rejects ambiguous, oversized, and unknown paging inputs", () => {
  for (const query of ["limit=0", "limit=51", "limit=1.5", "limit=1&limit=2", "after=no", "workspace=another"]) {
    assert.deepEqual(page(query), { error: "invalid_query" });
  }
  assert.deepEqual(page("after=0e3f0b1b-1890-4a46-adcb-1c9f927d5fa2"), { error: "invalid_cursor" });
  assert.equal(page("limit=50").events.length, 5);
});

test("clients can retry a checkpoint without changing the shared fictional payload", () => {
  const original = page("limit=1");
  const retry = page("limit=1");
  retry.events[0].resource.revision = 99;
  assert.deepEqual(page("limit=1"), original);
  assert.deepEqual(Object.keys(original.events[0]).sort(), ["eventId", "eventType", "occurredAt", "resource", "schemaVersion", "source"]);
});
