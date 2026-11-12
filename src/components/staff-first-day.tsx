"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import type { BrokerageRole } from "@/lib/brokerage-model";
import { firstDaySteps, type FirstDayProgress, type FirstDayStepId } from "@/lib/staff-first-day-model";
import { Button } from "./ui/button";

const labels: Record<BrokerageRole, string> = { Admin: "Brokerage admin", LO: "Loan officer", Processor: "Processor" };

export function StaffFirstDay({ brokerageId, role, pilot, openStep, openPractice }: {
  brokerageId: string; role: BrokerageRole; pilot: boolean;
  openStep: (id: FirstDayStepId) => void; openPractice: () => void;
}) {
  const endpoint = `/api/brokerages?brokerage=${encodeURIComponent(brokerageId)}&view=staff-first-day`;
  const steps = firstDaySteps[role];
  const [progress, setProgress] = useState<FirstDayProgress>();
  const [loadVersion, setLoadVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<FirstDayStepId>();
  const [error, setError] = useState("");
  const alert = useRef<HTMLParagraphElement>(null);
  const busy = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(endpoint, { signal: controller.signal, cache: "no-store" }).then(async response => {
      const result = await response.json().catch(() => null) as FirstDayProgress | null;
      if (!response.ok || result?.kind !== "staffFirstDay") throw new Error("Could not load your checklist. Refresh to try again.");
      if (!controller.signal.aborted) setProgress(result);
    }).catch((failure: Error) => { if (!controller.signal.aborted) setError(failure.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [endpoint, loadVersion]);

  useEffect(() => { if (error) alert.current?.focus(); }, [error]);

  async function update(current: FirstDayProgress["steps"][number]) {
    if (busy.current) return;
    busy.current = true;
    setSaving(current.id);
    setError("");
    try {
      const response = await fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: current.id, completed: !current.completed, revision: current.revision }),
      });
      const result = await response.json().catch(() => null) as FirstDayProgress | { error: string } | null;
      if (!response.ok || !result || !("kind" in result) || result.kind !== "staffFirstDay") {
        throw new Error(result && "error" in result ? result.error : "Could not confirm the change. Refresh your checklist before trying again.");
      }
      setProgress(result);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not save your progress."); }
    finally { setSaving(undefined); busy.current = false; }
  }

  const reviewed = progress?.steps.filter(step => step.completed).length;
  return <section className="pipeline relationship-panel staff-first-day" aria-label="Checklist steps">
    <div className="section-heading">
      <h2>{labels[role]}</h2>
      {reviewed !== undefined && <span className="pill" role="status">{reviewed} of {steps.length} reviewed</span>}
    </div>
    <p className="muted">Mark each step after you review it. Your progress is saved in this brokerage.</p>
    {error && <div className="record-form">
      <p ref={alert} tabIndex={-1} className="application-message banner-error" role="alert">{error}</p>
      <div className="loan-application-actions"><Button type="button" variant="outline" size="sm" disabled={loading || !!saving} onClick={() => {
        setError("");
        setLoading(true);
        setLoadVersion(version => version + 1);
      }}>Refresh checklist</Button></div>
    </div>}
    {loading && <p className="muted" role="status">Loading your progress…</p>}
    <ol className="first-day-list">
      {steps.map(step => {
        const current = progress?.steps.find(item => item.id === step.id);
        return <li key={step.id} className="first-day-step">
          <div className="first-day-copy">
            <h3>{step.title}</h3>
            <p className="muted">{step.description}</p>
          </div>
          <div className="first-day-actions">
            <Button type="button" variant="outline" size="sm" onClick={() => openStep(step.id)}>{step.action}<ArrowRight aria-hidden="true" /></Button>
            <label className="first-day-review">
              <input type="checkbox" checked={current?.completed ?? false} disabled={!current || loading}
                aria-label={`Reviewed (${step.title})`} aria-disabled={Boolean(saving)}
                onChange={() => { if (current) void update(current); }} />
              <span>{saving === step.id ? "Saving…" : "Reviewed"}</span>
            </label>
          </div>
        </li>;
      })}
    </ol>
    {pilot && role === "Admin" && <div className="first-day-practice">
      <p className="muted">Give your team sample leads, loans, and processing handoffs to practice with.</p>
      <Button type="button" size="sm" variant="outline" onClick={openPractice}>Open pilot tools</Button>
    </div>}
  </section>;
}
