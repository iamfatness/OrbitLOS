"use client";

import { useEffect, useRef, useState } from "react";
import type { z } from "zod";
import { accessComplianceCases } from "@/app/actions";
import { dateLabel } from "@/lib/client-retention";
import { policyFollowUpFilters, policyFollowUpPage } from "@/lib/compliance-learning-model";
import { ComplianceLearning } from "./compliance-learning";
import { Button } from "./ui/button";

type FollowUp = z.infer<typeof policyFollowUpPage>;
type Filter = typeof policyFollowUpFilters[number];

export function CompliancePolicyFollowUp({ brokerageId, paused }: { brokerageId: string; paused: boolean }) {
  const [filter, setFilter] = useState<Filter>("All outstanding");
  const [offset, setOffset] = useState(0);
  const [revision, refresh] = useState(0);
  const [response, setResponse] = useState<{ key: string; data: FollowUp | { error: string } }>();
  const [selected, setSelected] = useState<FollowUp["items"][number]>();
  const returnTo = useRef<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const key = JSON.stringify([filter, offset, revision]);
  const data = response?.key === key ? response.data : undefined;
  const list = data && "kind" in data ? data : undefined;

  useEffect(() => {
    if (paused || selected) return;
    let active = true;
    const fail = () => { if (active) setResponse({ key, data: { error: "Could not load policy acknowledgments. Try again." } }); };
    void accessComplianceCases({ type: "learning", input: { operation: "policyFollowUp", filter, offset } }, brokerageId).then(result => {
      if (!active) return;
      const parsed = policyFollowUpPage.safeParse("kind" in result && result.kind === "learning" ? result.result : null);
      if (!parsed.success) { fail(); return; }
      setResponse({ key, data: parsed.data });
    }, fail);
    return () => { active = false; };
  }, [brokerageId, filter, key, offset, paused, selected]);

  useEffect(() => { if (!paused) heading.current?.focus(); }, [paused]);

  useEffect(() => {
    if (!selected && data && returnTo.current) {
      (document.getElementById(returnTo.current) ?? heading.current)?.focus();
      returnTo.current = null;
    }
  }, [data, selected]);

  if (paused) return <p>Policy acknowledgments are unavailable while the workspace is paused.</p>;
  return <div className="record-form">
    <section className="integration manager-panel record-form" aria-label="Policy follow-up" hidden={!!selected}>
      <div className="section-heading"><h2 ref={heading} tabIndex={-1}>Policy acknowledgments</h2>
        <Button size="sm" variant="outline" onClick={() => refresh(value => value + 1)}>Refresh acknowledgments</Button></div>
      <label className="field max-w-xs">Status<select value={filter} onChange={event => {
        setFilter(event.target.value as Filter);
        setOffset(0);
      }}>{policyFollowUpFilters.map(option => <option key={option}>{option}</option>)}</select></label>
      {!data && <p role="status">Loading policy acknowledgments…</p>}
      {data && "error" in data && <p role="alert">{data.error}</p>}
      {list && <>
        <p role="status">{list.total} outstanding · {list.pastTarget} past target</p>
        {!list.items.length && <p>{list.total ? "No acknowledgments match this status." : "Active staff have no outstanding policy acknowledgments."}</p>}
        <ul className="compliance-home-list" aria-label="Outstanding policy assignments">
          {list.items.map(item => <li className="compliance-home-row" key={item.id}>
            <div><strong>{item.employeeName || item.employeeEmail}</strong>
              <p>{item.title} · Version dated {dateLabel(item.createdAt.slice(0, 10))}</p>
              <p className="muted">{item.pastTarget ? "Past target" : "Target"} · {dateLabel(item.dueAt.slice(0, 10))} (UTC)</p>
            </div>
            <Button size="sm" variant="outline" id={`policy-follow-up-${item.id}`}
              aria-label={`Open acknowledgment for ${item.employeeName || item.employeeEmail}, ${item.title}`}
              onClick={event => { returnTo.current = event.currentTarget.id; setSelected(item); }}>Open assignment</Button>
          </li>)}
        </ul>
        {(offset > 0 || list.more) && <div className="loan-application-actions">
          <Button size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset(value => value - 25)}>Previous page</Button>
          <Button size="sm" variant="outline" disabled={!list.more} onClick={() => setOffset(value => value + 25)}>Next page</Button>
        </div>}
      </>}
    </section>
    {selected && <section className="integration manager-panel record-form" aria-label="Selected policy acknowledgment">
      <p className="break-words"><strong>{selected.employeeName || selected.employeeEmail}</strong> · {selected.employeeEmail}</p>
      <ComplianceLearning brokerageId={brokerageId} paused={paused} admin initialVersionId={selected.versionId} assignmentId={selected.id}
        onBack={() => { setSelected(undefined); refresh(value => value + 1); }} />
    </section>}
  </div>;
}
