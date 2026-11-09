import { cutoverCallbackItem, cutoverItems, type CutoverReadinessStatus, type MigrationCutover } from "@/lib/migration-cutover-model";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

type Evidence = NonNullable<MigrationCutover["evidence"]>;
type Draft = Evidence["drafts"][number];

const statuses: CutoverReadinessStatus[] = ["Ready", "Reviewed with exclusions", "Needs review"];
const sourceCheckCount = Object.keys(cutoverItems).length;

export function CutoverReadinessOverview({ evidence, disabled, downloading, showDrafts, downloadHandoff }: {
  evidence: Evidence; disabled: boolean; downloading: boolean; showDrafts: () => void; downloadHandoff: () => void;
}) {
  const { readiness, draftCount, batch, undone, callbacks, reviews } = evidence;
  const { counts } = readiness;
  const sourceReviewed = reviews.filter(({ item, decision }) => item !== cutoverCallbackItem && decision !== "Pending").length;
  const callbackReview = reviews.find(({ item }) => item === cutoverCallbackItem);
  const callbackBlockers = callbacks.counts["Needs owner"] + callbacks.counts["Needs recovery"] + callbacks.counts["Missing evidence"] + callbacks.unrestored;
  const callbackStatus = callbackReview?.decision === "Out of scope" ? "Callbacks out of scope" : callbacks.oversized ? "Callback evidence exceeds review limit" :
    callbackBlockers ? `${callbackBlockers} callback ${callbackBlockers === 1 ? "issue" : "issues"}` : callbackReview?.callbackCurrent === false ? "Review callbacks again" :
      callbackReview?.callbackCurrent ? "Callbacks reconciled" : callbacks.total ? "Callback sign-off pending" : "No callback promises found";

  return <div className="record-form">
    <h3>Cutover readiness</h3>
    <p className="muted">Ready files have four current reconciliations. Files with documented exclusions are counted separately. Review the source checks alongside the file results.</p>
    <div className="loan-application-actions">
      {draftCount > 0 && <Button size="sm" variant="outline" disabled={disabled} onClick={showDrafts}>View linked files</Button>}
      <Button size="sm" variant="outline" disabled={disabled || !counts} onClick={downloadHandoff}>
        {downloading ? "Preparing handoff report…" : "Download handoff report"}
      </Button>
    </div>
    {counts && draftCount > 0 && <dl className="details-grid cutover-file-values" aria-label="Linked file totals">
      {statuses.map((status) => <div key={status}><dt>{status}</dt><dd>{counts[status]}</dd></div>)}
    </dl>}
    {draftCount === 0 && <p className="empty-inline">No linked 1003 drafts for this source. Import a fictional 1003 against a contact from this source to review a file.</p>}
    {!counts && <p role="status">Whole-source totals and handoff reports are available for up to {readiness.limit} linked files. Review the current status of each file by page.</p>}
    <div>
      <strong>Source checks</strong>
      <div className="loan-application-actions" aria-label="Source check status">
        <span className={batch && batch.expected > 0 && batch.received === batch.expected ? "pill" : "open-chip"}>
          {batch ? `${batch.received} / ${batch.expected} numbered parts received` : "Unnumbered import · confirm completeness"}
        </span>
        {undone > 0 && <span className="open-chip">{undone} {undone === 1 ? "row" : "rows"} awaiting reimport</span>}
        <span className={callbackBlockers || callbacks.oversized || callbackReview?.callbackCurrent === false ? "open-chip" : "pill"}>{callbackStatus}</span>
        <span className={sourceReviewed === sourceCheckCount ? "pill" : "open-chip"}>{sourceReviewed} / {sourceCheckCount} source checks reviewed</span>
      </div>
    </div>
  </div>;
}

export function CutoverReferenceLookup({ disabled, reference, loading, error, find, clear }: {
  disabled: boolean; reference?: string; loading: boolean; error?: string; find: (reference: string) => void; clear: () => void;
}) {
  return <div className="record-form">
    <form className="record-form" aria-label="Find a cutover file" onSubmit={(event) => {
      event.preventDefault();
      const reference = String(new FormData(event.currentTarget).get("reference") ?? "").trim();
      if (reference) find(reference);
    }}>
      <label className="field">Orbit file reference
        <input name="reference" defaultValue={reference} required maxLength={100} autoComplete="off" spellCheck={false} disabled={disabled}
          placeholder="Paste the full reference" aria-describedby="cutover-reference-help" />
      </label>
      <p id="cutover-reference-help" className="muted">Select the report’s migration source above, then paste the full file reference to see its current checks.</p>
      <div className="loan-application-actions">
        <Button size="sm" type="submit" variant="outline" disabled={disabled || loading}>{loading ? "Finding file…" : "Find file"}</Button>
        {reference && <Button size="sm" variant="ghost" disabled={disabled} onClick={clear}>Back to linked files</Button>}
      </div>
    </form>
    {loading && <p role="status">Checking the current file evidence…</p>}
    {error && <p role="alert">{error}</p>}
  </div>;
}

export function CutoverDraftChecks({ draft, expanded }: { draft: Draft; expanded?: boolean }) {
  const { checks } = draft.readiness;
  const attention = checks.filter(({ state }) => state === "Pending" || state === "Review again");
  const first = attention[0];
  return <>
    {first && <p className="muted"><strong>{cutoverItems[first.item].label}</strong> · {first.reason ?? first.state}
      {attention.length > 1 && ` · ${attention.length - 1} more ${attention.length === 2 ? "check needs" : "checks need"} attention`}</p>}
    <details className="document-form" open={expanded}>
      <summary>Checks and sign-offs</summary>
      <p className="muted">Orbit file reference · <code>{draft.id}</code></p>
      <ul className="document-list">{checks.map(({ item, state, reason }) => {
        const review = draft.reviews.find((entry) => entry.item === item);
        const needsAttention = state === "Pending" || state === "Review again";
        return <li className="document-item" key={item}>
          <div className="document-item-head"><strong>{cutoverItems[item].label}</strong><span className={needsAttention ? "open-chip" : "pill"}>{state}</span></div>
          {reason && <p className="muted">{reason}</p>}
          {review && review.decision !== "Pending" && <small>{state === "Review again" ? "Previously recorded" : "Recorded"} by {review.updatedBy} · {dateTime(review.updatedAt)} ET</small>}
        </li>;
      })}</ul>
    </details>
  </>;
}
