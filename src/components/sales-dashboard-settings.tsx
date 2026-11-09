"use client";

import { useRef, useState } from "react";
import { saveSalesSetting } from "@/app/actions";
import type { SalesFilters, SalesSetting, SalesSummary } from "@/lib/sales-dashboard-model";
import { Button } from "./ui/button";

const percent = (count: number, total: number) => total ? `${(100 * count / total).toFixed(1)}%` : "—";

export function SalesDashboardSettings({ brokerageId, filters, summary, ready, apply, refresh }: {
  brokerageId: string; filters: SalesFilters; summary: SalesSummary; ready: boolean;
  apply: (value: SalesFilters) => void; refresh: () => void;
}) {
  const [viewId, setViewId] = useState("");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ error: boolean; text: string }>();
  const viewAttempt = useRef<{ key: string; id: string } | null>(null);
  const view = summary.views.find((item) => item.id === viewId);
  const { target, periods } = summary;
  const { selected, previous } = periods;
  const denominator = filters.windowDays ? "mature leads" : "leads";

  async function save(input: SalesSetting, after?: () => void) {
    if (saving || !ready) return;
    setSaving(true);
    setFeedback(undefined);
    try {
      const result = await saveSalesSetting(input, brokerageId);
      if ("error" in result) { setFeedback({ error: true, text: result.error }); return; }
      after?.();
      setFeedback({ error: false, text: result.message });
      refresh();
    } catch {
      setFeedback({ error: true, text: "Could not save these sales settings. Try again." });
    } finally {
      setSaving(false);
    }
  }

  return <details className="document-form">
    <summary>Saved views and conversion targets</summary>
    <div className="record-form">
      {feedback && <p role={feedback.error ? "alert" : "status"}>{feedback.text}</p>}
      <section className="record-form" aria-label="Saved sales views">
        <h3>Saved sales views</h3>
        <p className="muted">Save the applied dates, owner, source, and follow-up window for this brokerage.</p>
        <div className="form-grid">
          <label className="field">Saved sales view<select value={viewId} onChange={(event) => setViewId(event.target.value)}>
            <option value="">Choose a view</option>
            {summary.views.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label>
          <form className="record-form" onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const name = String(new FormData(form).get("name")).trim();
            const key = JSON.stringify({ name, filters });
            if (viewAttempt.current?.key !== key) viewAttempt.current = { key, id: crypto.randomUUID() };
            const { id } = viewAttempt.current;
            void save({ type: "saveView", id, name, filters }, () => {
              form.reset();
              setViewId(id);
              viewAttempt.current = null;
            });
          }}>
            <label className="field">New view name<input name="name" maxLength={80} required /></label>
            <Button size="sm" type="submit" disabled={saving || !ready}>Save sales view</Button>
          </form>
        </div>
        <div className="loan-application-actions">
          <Button size="sm" variant="outline" disabled={!view || saving || !ready} onClick={() => view && apply(view.filters)}>Load sales view</Button>
          <Button size="sm" variant="ghost" disabled={!view || saving || !ready}
            onClick={() => view && void save({ type: "removeView", id: view.id }, () => setViewId(""))}>Remove sales view</Button>
        </div>
      </section>
      <section className="record-form" aria-label="Brokerage conversion targets">
        <h3>Brokerage conversion targets</h3>
        <p className="muted">Targets apply to all owners for the selected source and follow-up window. Rates use the number of {denominator} in each cohort.</p>
        {filters.owner ? <p className="empty-inline">Choose All owners to see or edit the brokerage targets.</p> : <>
          <p>{selected.leads ? <>Selected cohort · {percent(selected.submitted, selected.leads)} submitted{target && ` (target ${target.submitted}%)`}
            {" · "}{percent(selected.funded, selected.leads)} funded{target && ` (target ${target.funded}%)`}</> :
            <>The selected cohort has no {denominator} yet.</>}</p>
          {previous.leads > 0 && <p className="muted">Prior cohort · {percent(previous.submitted, previous.leads)} submitted · {percent(previous.funded, previous.leads)} funded</p>}
          <form className="record-form" key={`${filters.channel}:${filters.windowDays}:${target?.revision ?? 0}`} onSubmit={(event) => {
            event.preventDefault();
            const values = new FormData(event.currentTarget);
            void save({ type: "saveTarget", channel: filters.channel, windowDays: filters.windowDays, revision: target?.revision ?? 0,
              submitted: Number(values.get("submitted")), funded: Number(values.get("funded")) });
          }}>
            <div className="form-grid">
              <label className="field">1003 submission target (%)<input name="submitted" type="number" min={1} max={100} required defaultValue={target?.submitted} /></label>
              <label className="field">Funding conversion target (%)<input name="funded" type="number" min={1} max={100} required defaultValue={target?.funded} /></label>
            </div>
            <Button size="sm" type="submit" disabled={saving || !ready}>Save conversion targets</Button>
          </form>
          {target && !selected.leads && <p className="muted">Current targets · {target.submitted}% submitted · {target.funded}% funded</p>}
        </>}
      </section>
    </div>
  </details>;
}
