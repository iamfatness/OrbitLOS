"use client";

import { useEffect, useState } from "react";
import { accessClosingGates } from "@/app/actions";
import { dateLabel } from "@/lib/client-retention";
import { closingGateLabels, closingGatePhases, closingGateRules, type ClosingGateCheck, type ClosingGatePhase,
  type ClosingGateResult, type ClosingGateSettings } from "@/lib/closing-gate-model";
import { Button } from "./ui/button";

const loadError = { error: "Could not load closing and funding checks. Refresh to try again." };

function useGateWork(brokerageId: string, loanId?: string, fileVersion?: object) {
  const scope = JSON.stringify([brokerageId, loanId]);
  const [loaded, setLoaded] = useState<{ scope: string; result: ClosingGateResult | undefined }>();
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let current = true;
    const input = loanId ? { type: "loan", loanId } : { type: "settings" };
    void accessClosingGates(input, brokerageId).then((result) => { if (current) setLoaded({ scope, result }); })
      .catch(() => { if (current) setLoaded({ scope, result: loadError }); });
    return () => { current = false; };
  }, [brokerageId, loanId, fileVersion, revision, scope]);
  return { result: loaded?.scope === scope ? loaded.result : undefined,
    setResult: (result: ClosingGateResult | undefined) => setLoaded({ scope, result }), reload: () => setRevision((value) => value + 1) };
}

export function useLoanClosingGates(brokerageId: string, loanId: string, fileVersion: object) {
  const { result, reload } = useGateWork(brokerageId, loanId, fileVersion);
  return { work: result && "kind" in result && result.kind === "loan" ? result : undefined,
    error: result && "error" in result ? result.error : null, reload };
}

function ClosingGatePolicyForm({ brokerageId, policy, published, reload }: { brokerageId: string; policy: ClosingGateSettings;
  published: (result: ClosingGateSettings) => void; reload: () => void }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  return <form className="record-form" onSubmit={async (event) => {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true);
    setNotice("");
    try {
      const result = await accessClosingGates({ type: "publish", revision: policy.revision, reason: values.get("reason"),
        rules: { closing: values.getAll("closing"), funding: values.getAll("funding") } }, brokerageId);
      if ("error" in result) setNotice(result.error);
      else if (result.kind === "settings") { form.reset(); published(result); }
    } catch { setNotice("Could not publish the policy. Refresh to try again."); }
    finally { setBusy(false); }
  }}>
    <p className="muted">{policy.revision ? `Published policy v${policy.revision} · ${policy.publishedBy} · ${policy.reason}` : "No required checks are configured."}</p>
    <p>Choose which checks apply before staff record each milestone. Preview the selections here before publishing them for the brokerage.</p>
    <div className="form-grid">{closingGatePhases.map((phase) => <fieldset key={phase}>
      <legend>{phase === "closing" ? "Before recording closing" : "Before recording funding"}</legend>
      {closingGateRules.map((rule) => <label className="demo-confirm" key={rule}><input type="checkbox" name={phase} value={rule}
        defaultChecked={policy.rules[phase].includes(rule)} disabled={busy} />{closingGateLabels[rule]}</label>)}
    </fieldset>)}</div>
    <label className="field">Reason for policy change<textarea name="reason" rows={2} minLength={8} maxLength={300} required disabled={busy} /></label>
    <div className="loan-application-actions"><Button type="submit" size="sm" disabled={busy}>Publish closing and funding policy</Button>
      {notice && <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={reload}>Reload policy</Button>}</div>
    {notice && <p role="alert">{notice}</p>}
  </form>;
}

function ClosingGateSettingsContent({ brokerageId }: { brokerageId: string }) {
  const { result, setResult, reload } = useGateWork(brokerageId);
  if (!result) return <p role="status">Loading closing and funding policy…</p>;
  if ("error" in result) return <><p role="alert">{result.error}</p><Button size="sm" variant="ghost" onClick={reload}>Reload policy</Button></>;
  if (result.kind !== "settings") return null;
  return <ClosingGatePolicyForm key={result.revision} brokerageId={brokerageId} policy={result} published={setResult}
    reload={() => { setResult(undefined); reload(); }} />;
}

export function ManageClosingGates({ brokerageId }: { brokerageId: string }) {
  const [open, setOpen] = useState(false);
  return <details className="integration manager-panel" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>Closing and funding policy</summary>
    {open && <ClosingGateSettingsContent key={brokerageId} brokerageId={brokerageId} />}
  </details>;
}

export function ClosingGateEvidence({ phase, check, open }: { phase: ClosingGatePhase; check: ClosingGateCheck; open: (target: string) => void }) {
  if (!check.blockers.length) return null;
  return <div className="work-queue" role="group" aria-label={`Required before ${phase}`}>
    <strong>{phase === "closing" ? "Required before closing" : "Required before funding"}</strong>
    <ul className="document-list">{check.blockers.map((item) => <li key={`${item.rule}:${item.parentId}:${item.id}`} className="document-item">
      <p>{item.title}{item.dueOn && ` · Due ${dateLabel(item.dueOn)}`}</p>
      <Button type="button" size="sm" variant="outline" onClick={() => open(item.target)}>Open {item.title}</Button>
    </li>)}</ul>
    {check.more && <p>Resolve the listed checks and refresh to see the remaining items.</p>}
  </div>;
}
