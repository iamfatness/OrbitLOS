"use client";

import { useState } from "react";
import { Copy, ExternalLink } from "lucide-react";
import type { StaffApplication } from "@/lib/application-model";
import { jointBorrowerPortionsTarget } from "@/lib/joint-application-model";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

export function JointBorrowerLinks({ application, mayManage, canEnable, busy, save }: {
  application: StaffApplication; mayManage: boolean; canEnable: boolean; busy: boolean; save: (input: unknown) => Promise<void>;
}) {
  const [copyStatus, setCopyStatus] = useState("");
  const [confirmToken, setConfirmToken] = useState<string>();
  const { joint, loanId } = application;
  if (!joint) {
    return canEnable && <details className="loan-task-create">
      <summary>Set up separate joint 1003 links</summary>
      <p className="muted">Give the co-borrower a private link to enter and submit their own answers. The primary borrower keeps their current link. Orbit combines the portions for staff review.</p>
      <div><Button size="sm" disabled={busy} onClick={() => void save({ type: "enableJointApplication", loanId, revision: application.revision })}>
        Create separate co-borrower link
      </Button></div>
    </details>;
  }

  const link = joint.revokedAt ? "Revoked" : joint.expiresAt <= new Date().toISOString() ? "Expired" : "Active";
  const path = joint.token ? `/co-borrower#${joint.token}` : "";
  const primaryCorrection = joint.primarySubmittedAt ? "" : application.correctionNote;
  return <section className="document-item record-form" id={jointBorrowerPortionsTarget} tabIndex={-1} aria-label="Joint borrower portions">
    <div className="document-item-head"><strong>Joint borrower portions</strong><span className="pill">
      {application.submittedAt ? "Both submitted" : `${Number(!!joint.primarySubmittedAt) + Number(!!joint.submittedAt)} of 2 submitted`}
    </span></div>
    <ul className="loan-task-list">
      <li>Primary borrower · {primaryCorrection ? "Correction requested" : joint.primarySubmittedAt ? "Submitted" : "Waiting for submission"}</li>
      <li>Co-borrower · {joint.correctionNote ? "Correction requested" : joint.submittedAt ? "Submitted" : "Waiting for submission"}</li>
    </ul>
    {primaryCorrection && <p className="muted">Primary borrower correction · {primaryCorrection}</p>}
    {joint.correctionNote && <p className="muted">Co-borrower correction · {joint.correctionNote}</p>}
    {mayManage && joint.token && <>
      <p className="muted">Co-borrower link · <strong>{link}</strong>{link === "Active" && ` · Expires ${dateTime(joint.expiresAt)} ET`}</p>
      <div className="loan-application-actions">
        {link === "Active" ? <>
          <Button size="sm" variant="outline" asChild><a href={path} target="_blank" rel="noopener noreferrer"><ExternalLink /> Open co-borrower view</a></Button>
          <Button size="sm" variant="outline" onClick={async () => {
            try {
              await navigator.clipboard.writeText(new URL(path, window.location.origin).href);
              setCopyStatus("Co-borrower link copied.");
            } catch { setCopyStatus("Open the co-borrower view and copy the address from your browser."); }
          }}><Copy /> Copy co-borrower link</Button>
          <Button size="sm" variant="ghost" disabled={busy} aria-expanded={confirmToken === joint.token}
            onClick={() => setConfirmToken(joint.token)}>Revoke co-borrower link</Button>
        </> : <Button size="sm" variant="outline" disabled={busy} onClick={() => void save({ type: "replaceJointLink", loanId, token: joint.token })}>
          Issue replacement co-borrower link
        </Button>}
      </div>
      {link === "Active" && confirmToken === joint.token && <div className="record-form">
        <p className="muted">The co-borrower will need a replacement link. Their saved portion stays on the loan.</p>
        <div className="loan-application-actions">
          <Button size="sm" disabled={busy} onClick={() => {
            setConfirmToken(undefined);
            setCopyStatus("");
            void save({ type: "revokeJointLink", loanId, token: joint.token });
          }}>Confirm co-borrower link revocation</Button>
          <Button size="sm" variant="outline" onClick={() => setConfirmToken(undefined)}>Keep co-borrower link active</Button>
        </div>
      </div>}
      {copyStatus && <p role="status" className="muted">{copyStatus}</p>}
    </>}
  </section>;
}
