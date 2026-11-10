import { createHash } from "node:crypto";
import { cutoverCallbackItem, cutoverCallbackStatuses, cutoverItems, type CutoverReview, type MigrationCutover } from "./migration-cutover-model";

type Evidence = NonNullable<MigrationCutover["evidence"]>;
type Fact = readonly [string, string | number];
type ReviewProof = { loanId: string; item: string; applicationFingerprint: string | null; fileFingerprint: string | null };

export function cutoverReviewReference(evidence: Evidence, proofs: readonly ReviewProof[] = []) {
  const reviewRecords = (reviews: CutoverReview[]) => reviews.map(({ item, decision, revision, updatedAt, updatedBy,
    applicationCurrent, fileCurrent, callbackCurrent }) => JSON.stringify([item, decision, revision, updatedAt, updatedBy,
    applicationCurrent, fileCurrent, callbackCurrent])).sort();
  const files = evidence.drafts.map(({ id, readiness, reviews }) => JSON.stringify([id, readiness, reviewRecords(reviews)])).sort();
  const recordedProofs = proofs.map(({ loanId, item, applicationFingerprint, fileFingerprint }) =>
    JSON.stringify([loanId, item, applicationFingerprint, fileFingerprint])).sort();
  const { origin, basis, batch, links, byType, undone, draftCount, callbacks, reviews } = evidence;
  const parts = ["orbit-cutover-review-v1", origin, basis, batch, links, byType, undone, draftCount, callbacks.fingerprint,
    reviewRecords(reviews), files, recordedProofs];
  const digest = createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 24).toUpperCase();
  return [digest.slice(0, 8), digest.slice(8, 16), digest.slice(16)].join("-");
}

function escapeHtml(value: string | number) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function timestamp(value: string) {
  const escaped = escapeHtml(value);
  return `<time datetime="${escaped}">${escaped}</time>`;
}

function facts(entries: readonly Fact[]) {
  return `<dl class="facts">${entries.map(([label, value]) =>
    `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>`;
}

function recordedReview(review: CutoverReview | undefined, prior = false) {
  if (!review) return "";
  const name = review.updatedBy.trim();
  const reviewer = name && !name.includes("@") ? name : "Staff reviewer";
  return `<p class="record">${prior ? "Prior decision" : "Recorded decision"} ${escapeHtml(review.decision)}
    by ${escapeHtml(reviewer)} at ${timestamp(review.updatedAt)}.</p>`;
}

function checkTable(caption: string, rows: { label: string; state: string; reason?: string; review?: CutoverReview }[]) {
  return `<table><caption class="visually-hidden">${escapeHtml(caption)}</caption>
    <thead><tr><th scope="col">Check</th><th scope="col">Status and evidence</th></tr></thead>
    <tbody>${rows.map(({ label, state, reason, review }) => `<tr><th scope="row">${escapeHtml(label)}</th>
      <td><strong>${escapeHtml(state)}</strong>${reason ? `<p>${escapeHtml(reason)}</p>` : ""}
        ${recordedReview(review, state === "Review again")}</td></tr>`).join("")}</tbody></table>`;
}

function reportFilename(origin: string, checkedAt: string) {
  const source = origin.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^[-_]+|[-_]+$/g, "").slice(0, 60) || "source";
  const date = new Date(checkedAt);
  const instant = Number.isFinite(date.getTime()) ? date.toISOString().replace(/[:.]/g, "-") : "undated";
  return `orbitlos-cutover-${source}-${instant}.html`;
}

export function renderCutoverHandoff(evidence: Evidence, checkedAt: string, reviewReference = cutoverReviewReference(evidence)): { html: string; filename: string } {
  const { origin, basis, batch, links, byType, undone, draftCount, drafts, reviews, callbacks, readiness } = evidence;
  const scopeChecks = Object.entries(cutoverItems);
  const sourceChecks = scopeChecks.map(([item, { label }]) => {
    const review = reviews.find((entry) => entry.item === item);
    return { label, state: review?.decision ?? "Pending", review };
  });
  const callbackReview = reviews.find(({ item }) => item === cutoverCallbackItem);
  const callbackStale = callbackReview?.decision === "Reconciled" && callbackReview.callbackCurrent !== true;
  const fileSections = drafts.map(({ id, reviews: fileReviews, readiness: file }, index) => {
    const titleId = `file-${index + 1}`;
    const checks = scopeChecks.map(([item, { label }]) => {
      const check = file.checks.find((entry) => entry.item === item);
      const review = fileReviews.find((entry) => entry.item === item);
      return { label, state: check?.state ?? "Pending", reason: check?.reason, review };
    });
    return `<article class="file" aria-labelledby="${titleId}">
      <h3 id="${titleId}">Orbit file <code>${escapeHtml(id)}</code></h3>
      <p class="file-status">${escapeHtml(file.status)}</p>
      ${checkTable("File checks", checks)}
    </article>`;
  }).join("");

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>OrbitLOS cutover handoff</title>
  <style>
    :root { color-scheme: light; font: 1rem/1.55 system-ui, sans-serif; color: #172033; background: #f3f5f8; }
    body { margin: 0; }
    main { max-width: 64rem; margin: 0 auto; padding: clamp(1rem, 4vw, 3rem); background: #fff; }
    header, section { margin-bottom: 2rem; }
    h1, h2, h3 { line-height: 1.25; margin: 0 0 .5rem; }
    p { margin: .4rem 0 0; text-wrap: pretty; }
    .eyebrow, dt, .record { color: #3c4b62; }
    .eyebrow { font-weight: 700; margin: 0 0 .35rem; }
    .facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 12rem), 1fr)); gap: .7rem; margin: .9rem 0; }
    .facts div { padding: .55rem .7rem; border: 1px solid #cbd3df; border-radius: .3rem; }
    dt { font-size: .85rem; font-weight: 650; }
    dd { margin: .15rem 0 0; overflow-wrap: anywhere; }
    code { font: .9em ui-monospace, monospace; overflow-wrap: anywhere; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; margin: .7rem 0 0; }
    th, td { border: 1px solid #cbd3df; padding: .45rem .6rem; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
    th:first-child { width: 31%; }
    thead th { background: #edf1f6; }
    .file { margin: 1.3rem 0; }
    .file-status { font-weight: 700; }
    .record { font-size: .875rem; }
    .visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    @media (max-width: 38rem) {
      th, td { padding: .4rem; }
      th:first-child { width: 35%; }
    }
    @media print {
      @page { margin: 14mm; }
      :root { font-size: 10pt; }
      :root, main, thead th { background: #fff; color: #000; }
      main { max-width: none; padding: 0; }
      header, section { margin-bottom: 1.2rem; }
      h1, h2, h3 { break-after: avoid; }
      .facts div, tr, .file { break-inside: avoid; }
      thead { display: table-header-group; }
    }
  </style>
</head>
<body><main>
  <header>
    <p class="eyebrow">OrbitLOS · Fictional migration evidence</p>
    <h1>Cutover handoff</h1>
    <p>Cutover checks at export time. Review notes and underlying file details stay in Orbit.</p>
    <dl class="facts">
      <div><dt>Migration source</dt><dd><code>${escapeHtml(origin)}</code></dd></div>
      <div><dt>Exact source basis</dt><dd><code>${escapeHtml(basis)}</code></dd></div>
      <div><dt>Review reference</dt><dd><code>${escapeHtml(reviewReference)}</code></dd></div>
      <div><dt>Checked at (UTC)</dt><dd>${timestamp(checkedAt)}</dd></div>
    </dl>
    <p>Use the review reference to compare source coverage and recorded decisions across reports.</p>
  </header>

  <section aria-labelledby="import-coverage">
    <h2 id="import-coverage">Import coverage</h2>
    <p>${batch
      ? `${batch.expected > 0 && batch.received === batch.expected ? "Complete numbered receipt" : "Incomplete numbered receipt"} · ${escapeHtml(batch.received)} of ${escapeHtml(batch.expected)} batches received.`
      : "Unnumbered receipt · Manual completeness check required."}</p>
    ${facts([["Skipped source records", batch?.skipped ?? "Unavailable for an unnumbered receipt"],
      ["Suppressed source records", batch?.suppressed ?? "Unavailable for an unnumbered receipt"], ["Undone source records", undone]])}
    <h3>Linked CRM records</h3>
    ${facts([["Total links", links], ["Contacts", byType.contacts], ["Leads", byType.leads], ["Notes", byType.notes], ["Tasks", byType.tasks],
      ["Callback history links", byType.callbacks ?? 0]])}
  </section>

  <section aria-labelledby="file-readiness">
    <h2 id="file-readiness">Whole-source file readiness</h2>
    ${facts([["Linked MISMO drafts", draftCount], ["Files in this handoff", drafts.length]])}
    ${readiness.counts ? facts([["Ready", readiness.counts.Ready], ["Reviewed with exclusions", readiness.counts["Reviewed with exclusions"]],
      ["Needs review", readiness.counts["Needs review"]]])
      : `<p>Readiness counts are unavailable above the ${escapeHtml(readiness.limit)}-file comparison limit.</p>`}
    <p>Files with an Out of scope check are counted as reviewed with exclusions once the other checks are current.</p>
  </section>

  <section aria-labelledby="source-reviews">
    <h2 id="source-reviews">Source-wide reviews</h2>
    ${checkTable("Source-wide checks", sourceChecks)}
  </section>

  <section aria-labelledby="callback-review">
    <h2 id="callback-review">Callback promises</h2>
    ${callbacks.oversized ? "<p>Callback evidence exceeds the comparison limit. Counts are unavailable.</p>"
      : facts([["Tracked promises", callbacks.total], ["Unrestored source records", callbacks.unrestored],
        ...cutoverCallbackStatuses.map((status): Fact => [status, callbacks.counts[status]])])}
    ${checkTable("Callback review", [{ label: "Campaign callback review", state: callbackStale ? "Review again" : callbackReview?.decision ?? "Pending",
      reason: callbackStale ? "Callback evidence changed or is incomplete. Review the current evidence and sign off again." : undefined,
      review: callbackReview }])}
  </section>

  <section aria-labelledby="file-checks">
    <h2 id="file-checks">File-by-file checks</h2>
    ${fileSections || "<p>No MISMO draft files are included in this handoff.</p>"}
  </section>
</main></body>
</html>`;
  return { html, filename: reportFilename(origin, checkedAt) };
}
