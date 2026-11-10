"use client";

import { useEffect, useState } from "react";
import { accessLoanStageEdits } from "@/app/actions";
import type { WorkspaceMutationSuccess } from "@/lib/commands";
import { stageEditAreas, stageEditLabels, stageEditOverride, stageEditUnavailable, type StageEditArea, type StageEditLoan,
  type StageEditSettings } from "@/lib/loan-stage-edit-model";
import { stages, type Stage } from "@/lib/model";
import { Button } from "./ui/button";

type Save = (input: unknown, after?: (result: WorkspaceMutationSuccess) => void) => Promise<void>;

export function useLoanStageEdit(area: StageEditArea, loanId: string, stage: Stage, brokerageId: string, save: Save, enabled = true) {
  const [refresh, setRefresh] = useState(0);
  const [response, setResponse] = useState<{ key: string; result: StageEditLoan | { error: string } }>();
  const [draft, setDraft] = useState<{ context: string; reason: string }>();
  const key = `${brokerageId}:${loanId}:${stage}:${refresh}`;
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    const error = { error: stageEditUnavailable };
    void accessLoanStageEdits({ type: "loan", loanId }, brokerageId).then((result) => {
      if (current) setResponse({ key, result: "error" in result || result.kind === "loan" ? result : error });
    }).catch(() => { if (current) setResponse({ key, result: error }); });
    return () => { current = false; };
  }, [brokerageId, enabled, key, loanId]);

  const result = enabled && response?.key === key ? response.result : undefined;
  const policy = result && "kind" in result ? result : undefined;
  const error = result && "error" in result ? result.error : undefined;
  const locked = Boolean(policy?.locked[area]);
  const context = `${brokerageId}:${loanId}:${policy?.stage}:${policy?.revision}`;
  const reason = draft?.context === context ? draft.reason : "";
  const override = locked && policy?.canOverride ?
    stageEditOverride.safeParse({ revision: policy.revision, stage: policy.stage, reason }).data : undefined;
  const blocked = enabled && (!policy || (locked && !override));
  return {
    blocked, locked, stage: policy?.stage, revision: policy?.revision, canOverride: policy?.canOverride, error, reason,
    setReason: (value: string) => setDraft({ context, reason: value }),
    reload: () => setRefresh((value) => value + 1),
    save: async (input: unknown, after?: Parameters<Save>[1]) => {
      if (blocked) return;
      const payload = override && input && typeof input === "object" ? { ...input, stageOverride: override } : input;
      let saved = false;
      await save(payload, (result) => {
        saved = true;
        if (override) setDraft(undefined);
        after?.(result);
      });
      if (!saved) setRefresh((value) => value + 1);
    },
  };
}

export function LoanStageEditNotice({ area, control, busy }: { area: StageEditArea; control: ReturnType<typeof useLoanStageEdit>; busy: boolean }) {
  if (!control.locked && !control.error) return null;
  return <div className="document-item" aria-label={`${stageEditLabels[area]} policy`}>
    <p role="status">{control.error ?? `${stageEditLabels[area]} are locked at ${control.stage} · Policy v${control.revision}.`}</p>
    {control.locked && (control.canOverride ? <label className="field">Internal override reason
      <textarea rows={2} maxLength={300} value={control.reason} disabled={busy}
        onChange={(event) => control.setReason(event.target.value)} />
      <small className="muted">Enter at least 8 characters to make one edit. The reason is recorded in the loan audit.</small>
    </label> : <p className="muted">Ask a brokerage admin to make the change and record a reason.</p>)}
    <div><Button size="sm" variant="ghost" disabled={busy} onClick={control.reload}>Reload edit controls</Button></div>
  </div>;
}

function PolicyEditor({ brokerageId }: { brokerageId: string }) {
  const [settings, setSettings] = useState<StageEditSettings>();
  const [rules, setRules] = useState<StageEditSettings["rules"]>();
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let current = true;
    void accessLoanStageEdits({ type: "settings" }, brokerageId).then((result) => {
      if (!current) return;
      if ("error" in result) setNotice(result.error);
      else if (result.kind === "settings") { setSettings(result); setRules(result.rules); }
    }).catch(() => { if (current) setNotice(stageEditUnavailable); });
    return () => { current = false; };
  }, [brokerageId, refresh]);

  async function publish() {
    if (!settings || !rules) return;
    setBusy(true);
    setNotice("");
    try {
      const result = await accessLoanStageEdits({ type: "publish", revision: settings.revision, rules, reason }, brokerageId);
      if ("error" in result) setNotice(result.error);
      else if (result.kind === "settings") {
        setSettings(result);
        setRules(result.rules);
        setReason("");
        setNotice(`Stage edit policy v${result.revision} published.`);
      }
    } catch {
      setNotice(stageEditUnavailable);
    } finally {
      setBusy(false);
    }
  }

  return <div className="record-form">
    <p>Choose where staff need an admin to make changes. The policy follows each loan’s current pipeline stage.</p>
    {!settings && !notice && <p role="status">Loading stage edit policy…</p>}
    {settings && rules && <form className="record-form" onSubmit={(event) => { event.preventDefault(); void publish(); }}>
      <p className="muted">Policy v{settings.revision}{settings.publishedBy ? ` · Published by ${settings.publishedBy} · ${settings.reason}` : " · No stages locked"}</p>
      <div className="form-grid">{stageEditAreas.map((area) => <fieldset className="document-item" disabled={busy} key={area}>
        <legend>{stageEditLabels[area]}</legend>
        <p className="muted">{area === "application" ? "Reopening a submitted application and saving lender details." :
          "Changing the selected quote or saving a fee worksheet."}</p>
        {stages.map((stage) => <label className="demo-confirm" key={stage}><input type="checkbox"
          checked={rules[area].includes(stage)} onChange={(event) => setRules({ ...rules,
            [area]: stages.filter((item) => item === stage ? event.target.checked : rules[area].includes(item)) })} />Lock at {stage}</label>)}
      </fieldset>)}</div>
      <label className="field">Policy change reason<textarea rows={2} value={reason} minLength={8} maxLength={300} required disabled={busy}
        onChange={(event) => setReason(event.target.value)} /></label>
      <div><Button size="sm" type="submit" disabled={busy || JSON.stringify(settings.rules) === JSON.stringify(rules) || reason.trim().length < 8}>
        Publish stage edit policy</Button></div>
    </form>}
    {notice && <p role="status">{notice}</p>}
    {notice && <div><Button size="sm" variant="ghost" disabled={busy} onClick={() => {
      setNotice(""); setSettings(undefined); setRules(undefined); setReason(""); setRefresh((value) => value + 1);
    }}>Reload stage edit policy</Button></div>}
  </div>;
}

export function LoanStageEditSettings({ brokerageId }: { brokerageId: string }) {
  const [open, setOpen] = useState(false);
  return <details className="integration manager-panel" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>Loan stage edit policy</summary>
    {open && <PolicyEditor key={brokerageId} brokerageId={brokerageId} />}
  </details>;
}
