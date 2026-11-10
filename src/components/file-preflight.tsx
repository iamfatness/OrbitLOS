"use client";

import { useEffect, useState } from "react";
import { workOnLoanReview } from "@/app/actions";
import { filePreflightRequestTarget, filePreflightTarget, type FilePreflight } from "@/lib/file-preflight-model";
import { reviewTarget, type ReviewResult } from "@/lib/loan-review-model";
import { Button } from "./ui/button";

export function PreflightChecks({ preflight, open }: { preflight: FilePreflight; open?: (target: string) => void }) {
  return <ul className="document-list">{preflight.checks.toSorted((left, right) => left.state.localeCompare(right.state)).map((check) => <li key={check.id} className="document-item">
    <div className="document-item-head"><strong>{check.label}</strong><span className="pill">{check.state}</span></div>
    <p>{check.detail}</p>
    {open && <div><Button size="sm" variant="outline" aria-label={`Open ${check.label.toLowerCase()}`}
      onClick={() => open(check.target)}>Open {check.state === "Ready" ? "evidence" : "issue"}</Button></div>}
  </li>)}</ul>;
}

export function FilePreflightPanel({ loanId, brokerageId, open }: { loanId: string; brokerageId: string; open: (target: string) => void }) {
  const [version, setVersion] = useState(0);
  const [loaded, setLoaded] = useState<{ version: number; result: Extract<ReviewResult, { kind: "preflight" }> | { error: string } }>();
  useEffect(() => {
    let active = true;
    const failed = { error: "Could not check file preflight. Refresh to try again." };
    void workOnLoanReview({ type: "preflight", loanId }, brokerageId).then((result) => {
      if (active) setLoaded({ version, result: "error" in result || result.kind === "preflight" ? result : failed });
    }, () => { if (active) setLoaded({ version, result: failed }); });
    return () => { active = false; };
  }, [brokerageId, loanId, version]);
  const result = loaded?.version === version ? loaded.result : undefined;
  const data = result && !("error" in result) ? result : undefined;
  const latest = data?.latest;
  return <section className="record-form" id={filePreflightTarget} tabIndex={-1} aria-label="File preflight">
    <div className="section-heading"><h4>File preflight</h4><Button size="sm" variant="outline" onClick={() => setVersion((value) => value + 1)}>
      Refresh preflight
    </Button></div>
    <p className="muted">Internal check of the current sample evidence before closing.</p>
    {!result && <p role="status">Checking file evidence…</p>}
    {result && "error" in result && <p role="alert">{result.error}</p>}
    {data && <>
      <div className="loan-application-actions">
        {latest && <Button size="sm" variant="outline" onClick={() => open(reviewTarget(latest.id))}>Open preflight review</Button>}
        {data.canRequest && <Button size="sm" onClick={() => open(filePreflightRequestTarget)}>Assign preflight review</Button>}
      </div>
      {latest && <p role="status">{latest.status} · {latest.reviewerName}{!latest.current && " · Evidence changed since review"}</p>}
      <PreflightChecks preflight={data.preflight} open={open} />
    </>}
  </section>;
}
