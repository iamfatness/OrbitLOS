"use client";

import { useEffect, useState } from "react";
import { readMockUwmDelivery } from "@/app/actions";
import type { WorkspaceMutationSuccess } from "@/lib/commands";
import type { Submission } from "@/lib/model";
import { conditionTarget } from "@/lib/uwm-alert-model";
import type { UwmDeliveryCursor, UwmDeliveryPage } from "@/lib/uwm-delivery-model";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

export function UwmDeliveryTimeline({ submission, brokerageId, busy, canSimulate, save }: {
  submission: Submission;
  brokerageId: string;
  busy: boolean;
  canSimulate: boolean;
  save: (input: unknown, after?: (result: WorkspaceMutationSuccess) => void) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [version, setVersion] = useState(0);
  const [before, setBefore] = useState<UwmDeliveryCursor>();
  const [selected, setSelected] = useState("");
  const [notice, setNotice] = useState("");
  const [response, setResponse] = useState<{ key: string; data: UwmDeliveryPage | { error: string } }>();
  const { loanId, id: submissionId, syncedAt } = submission;
  const requestKey = JSON.stringify([brokerageId, loanId, submissionId, syncedAt, version, before]);
  useEffect(() => {
    if (!expanded) return;
    let current = true;
    void readMockUwmDelivery({ loanId, submissionId, before }, brokerageId).then((data) => {
      if (current) setResponse({ key: requestKey, data });
    }, () => {
      if (current) setResponse({ key: requestKey, data: { error: "Could not load mock UWM delivery history. Refresh to try again." } });
    });
    return () => { current = false; };
  }, [expanded, requestKey, loanId, submissionId, before, brokerageId]);
  const data = response?.key === requestKey ? response.data : undefined;
  const cleared = submission.conditions.filter((item) => item.satisfiedAt)
    .sort((a, b) => Date.parse(b.satisfiedAt!) - Date.parse(a.satisfiedAt!));
  const chosen = cleared.find((item) => item.id === selected) ?? cleared[0];

  function refresh() {
    setBefore(undefined);
    setVersion((value) => value + 1);
  }

  return <details className="document-form" onToggle={(event) => setExpanded(event.currentTarget.open)}>
    <summary>Mock UWM delivery timeline</summary>
    {expanded && <div className="record-form">
      <p className="muted">Review 1003 receipts, document deliveries, and condition updates for this lender file.</p>
      {canSimulate && chosen?.satisfiedAt && <div className="record-form">
        <label className="field">Cleared condition to replay<select value={chosen.id} onChange={(event) => { setSelected(event.target.value); setNotice(""); }}>
          {cleared.map((item) => <option key={item.id} value={item.id}>{item.category} · {item.description}</option>)}
        </select></label>
        <div className="loan-application-actions"><Button size="sm" variant="outline" disabled={busy} onClick={() => {
          setNotice("");
          void save({ type: "replayMockUwmConditionDelivery", loanId, submissionId, conditionId: chosen.id,
            expectedSatisfiedAt: chosen.satisfiedAt, expectedReopenedAt: chosen.mockReopenedAt ?? null }, ({ message }) => {
            setNotice(message);
            refresh();
          });
        }}>Replay older and duplicate updates</Button></div>
      </div>}
      {notice && <p role="status">{notice}</p>}
      {!data ? <p className="muted" role="status">Loading mock UWM delivery history…</p>
        : "error" in data ? <p role="alert">{data.error}</p>
        : data.events.length ? <ul className="document-list">{data.events.map((entry) => {
          const conditionId = entry.conditionId;
          return <li className="document-item" key={entry.id}>
          <div className="document-item-head"><strong>{entry.title}</strong>
            {conditionId && submission.conditions.some((item) => item.id === conditionId) && <Button size="sm" variant="ghost"
              onClick={() => document.getElementById(conditionTarget(submissionId, conditionId))?.focus()}>Open condition</Button>}
          </div>
          <p>{entry.detail}</p>
          {entry.receipt && <p className="muted" style={{ overflowWrap: "anywhere" }}>Receipt {entry.receipt}</p>}
          <small className="muted">Recorded {dateTime(entry.receivedAt)} ET{entry.occurredAt && entry.occurredAt !== entry.receivedAt &&
            ` · Source time ${dateTime(entry.occurredAt)} ET`}</small>
        </li>; })}</ul> : <p className="empty-inline">No recorded deliveries or condition changes on this lender file yet.</p>}
      <div className="loan-application-actions">
        <Button size="sm" variant="ghost" onClick={refresh}>Refresh delivery timeline</Button>
        {before && <Button size="sm" variant="outline" onClick={() => setBefore(undefined)}>Latest events</Button>}
        {data && "next" in data && data.next && <Button size="sm" variant="outline"
          onClick={() => setBefore(data.next ?? undefined)}>Older events</Button>}
      </div>
    </div>}
  </details>;
}
