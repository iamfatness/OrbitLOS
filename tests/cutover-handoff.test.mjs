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

const { renderCutoverHandoff } = await import("../src/lib/cutover-handoff.ts");
const checkedAt = "2026-11-09T20:15:30.000Z";
const reviewedAt = "2026-11-09T19:10:22.000Z";
const privateNote = "PRIVATE-REVIEW-NOTE";
const borrowerName = "PRIVATE-BORROWER-NAME";
const borrowerAddress = "PRIVATE-BORROWER-ADDRESS";
const borrowerAmount = 91827364;
const callbackDetail = "PRIVATE-RAW-CALLBACK-DETAIL";
const sourceXml = "PRIVATE-SOURCE-XML";
const privateDocument = "PRIVATE-RAW-DOCUMENT-DETAIL";
const reviewerEmail = "reviewer-private@example.test";

function review(item, decision, updatedBy, extra = {}) {
  return { item, decision, updatedBy, updatedAt: reviewedAt, revision: 1, note: privateNote, ...extra };
}

function draft(id, status, overrides = {}, reviews = []) {
  const checks = ["application", "documents", "lender", "funding"].map((item) => ({ item, state: "Reconciled", ...overrides[item] }));
  return { id, name: borrowerName, address: borrowerAddress, amount: borrowerAmount, purpose: "Purchase", reviews,
    readiness: { status, checks }, rawDocument: privateDocument };
}

function evidence() {
  const ids = ["6b4d8767-96be-402e-a850-7034b7d119a1", "7c5e9878-87cf-413f-b961-8145c8e220b2", "8d6fa989-78d0-4240-aa72-9256d9f331c3"];
  return {
    origin: "orbit-fictional-snapshot", basis: "b".repeat(64),
    batch: { received: 3, expected: 3, skipped: 2, suppressed: 4 },
    links: 27, byType: { contacts: 10, leads: 7, notes: 3, tasks: 2, callbacks: 5 }, undone: 6,
    draftCount: 3, draftNext: null, sourceXml,
    drafts: [
      draft(ids[0], "Ready", {}, [review("documents", "Reconciled", "Current Reviewer")]),
      draft(ids[1], "Reviewed with exclusions", { funding: { state: "Out of scope" } }, [review("funding", "Out of scope", reviewerEmail)]),
      draft(ids[2], "Needs review", { documents: { state: "Review again", reason: "Resolve missing file inventory rows before sign-off." },
        application: { state: "Pending", reason: "Add the remaining additional borrower before sign-off." } },
      [review("documents", "Reconciled", "Prior File Reviewer")]),
    ],
    readiness: { counts: { Ready: 1, "Reviewed with exclusions": 1, "Needs review": 1 }, limit: 100 },
    reviews: [review("application", "Reconciled", "Source Reviewer"),
      review("callbacks", "Reconciled", "Prior Callback Reviewer", { callbackCurrent: false })],
    callbacks: {
      fingerprint: "c".repeat(64), total: 12, unrestored: 3, oversized: false, next: null,
      counts: { "Needs recovery": 1, "Needs owner": 2, "Missing evidence": 3, "On hold": 1, Ready: 4, Closed: 1 },
      items: [{ key: callbackDetail, leadId: callbackDetail, name: callbackDetail, owner: callbackDetail, campaignName: callbackDetail,
        dueAt: checkedAt, scheduledAt: checkedAt, status: "Needs recovery", reason: callbackDetail }],
    },
  };
}

test("cutover handoff prints exact source, whole-file decisions, prior review context and bounded counts", () => {
  const current = evidence();
  const { html, filename } = renderCutoverHandoff(current, checkedAt);
  assert.equal(filename, "orbitlos-cutover-orbit-fictional-snapshot-2026-11-09T20-15-30-000Z.html");
  assert.match(html, /^<!doctype html>/);
  assert.ok(html.includes(current.origin));
  assert.ok(html.includes(current.basis));
  assert.ok(html.includes(`<time datetime="${checkedAt}">${checkedAt}</time>`));
  assert.match(html, /Complete numbered receipt · 3 of 3 batches received/);
  for (const [label, total] of [["Skipped source records", 2], ["Suppressed source records", 4], ["Undone source records", 6],
    ["Total links", 27], ["Contacts", 10], ["Leads", 7], ["Notes", 3], ["Tasks", 2], ["Callback history links", 5],
    ["Linked MISMO drafts", 3], ["Files in this handoff", 3], ["Ready", 1], ["Reviewed with exclusions", 1], ["Needs review", 1],
    ["Tracked promises", 12], ["Unrestored source records", 3], ["Needs recovery", 1], ["Needs owner", 2], ["Missing evidence", 3],
    ["On hold", 1], ["Closed", 1]]) {
    assert.ok(html.includes(`<dt>${label}</dt><dd>${total}</dd>`), label);
  }
  assert.match(html, /Campaign callback review<\/th>\s*<td><strong>Review again/);
  assert.match(html, /Prior decision Reconciled\s*by Prior Callback Reviewer/);
  assert.match(html, /Recorded decision Reconciled\s*by Source Reviewer/);
  const files = [...html.matchAll(/<article class="file"[^>]*>([\s\S]*?)<\/article>/g)].map((match) => match[1]);
  assert.equal(files.length, current.drafts.length);
  for (const [index, file] of files.entries()) {
    assert.ok(file.includes(`<code>${current.drafts[index].id}</code>`));
    assert.ok(file.includes(`<p class="file-status">${current.drafts[index].readiness.status}</p>`));
    assert.equal((file.match(/<th scope="row">/g) ?? []).length, 4);
  }
  assert.match(files[1], /Out of scope/);
  assert.match(files[1], /by Staff reviewer/);
  assert.match(files[2], /Resolve missing file inventory rows before sign-off/);
  assert.match(files[2], /Add the remaining additional borrower before sign-off/);
  assert.match(files[2], /Prior decision Reconciled\s*by Prior File Reviewer/);
  assert.ok(files[2].includes(reviewedAt));
  assert.match(html, /@media print/);
  assert.match(html, /@media \(max-width:/);
  assert.match(html, /Review notes and underlying file details stay in Orbit/);
  for (const privateValue of [privateNote, borrowerName, borrowerAddress, borrowerAmount, callbackDetail, sourceXml, privateDocument, reviewerEmail]) {
    assert.ok(!html.includes(String(privateValue)), `The handoff exposed ${privateValue}`);
  }
});

test("cutover handoff escapes dynamic text and produces a safe filename", () => {
  const current = evidence();
  current.origin = '../<script>alert("source")</script>\r\n';
  current.basis = '<img src=x onerror="basis">';
  current.drafts[0].id = "<svg onload='id'>";
  current.drafts[0].readiness.checks[0].reason = '<script>alert("blocker")</script>';
  current.drafts[0].reviews[0].updatedBy = "Reviewer & <svg onload='reviewer'>";
  current.drafts[0].reviews[0].updatedAt = '" onmouseover="review-time';
  const { html, filename } = renderCutoverHandoff(current, checkedAt);
  assert.match(filename, /^orbitlos-cutover-[A-Za-z0-9_-]+-2026-11-09T20-15-30-000Z\.html$/);
  assert.doesNotMatch(html, /<(?:script|img|svg|iframe|link)\b|url\(/i);
  assert.ok(html.includes("&lt;script&gt;alert(&quot;source&quot;)&lt;/script&gt;"));
  assert.ok(html.includes("&lt;img src=x onerror=&quot;basis&quot;&gt;"));
  assert.ok(html.includes("&lt;svg onload=&#39;id&#39;&gt;"));
  assert.ok(html.includes("&lt;script&gt;alert(&quot;blocker&quot;)&lt;/script&gt;"));
  assert.ok(html.includes("Reviewer &amp; &lt;svg onload=&#39;reviewer&#39;&gt;"));
  assert.ok(html.includes('datetime="&quot; onmouseover=&quot;review-time"'));
});

test("cutover handoff calls out incomplete, unnumbered and bounded comparisons", () => {
  const current = evidence();
  assert.match(renderCutoverHandoff({ ...current, batch: { ...current.batch, received: 1 } }, checkedAt).html,
    /Incomplete numbered receipt · 1 of 3 batches received/);
  const manual = renderCutoverHandoff({ ...current, batch: null, callbacks: { ...current.callbacks, oversized: true },
    readiness: { counts: null, limit: 100 } }, checkedAt).html;
  assert.match(manual, /Unnumbered receipt · Manual completeness check required/);
  assert.match(manual, /Unavailable for an unnumbered receipt/);
  assert.match(manual, /Callback evidence exceeds the comparison limit/);
  assert.match(manual, /Readiness counts are unavailable above the 100-file comparison limit/);
  assert.doesNotMatch(manual, /<dt>Tracked promises<\/dt>|<dt>Ready<\/dt>/);
});
