"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { reportStates } from "@/lib/call-report-model";
import { quarterName } from "@/lib/call-report-quarter-model";
import type { Fv7Entry } from "@/lib/call-report-readiness-model";
import { Button } from "./ui/button";

type Source = "direct" | "thirdParty";
type ReviewedAmount = { amount: number | null; reference: string };
type Balance = { count: number | null; amount: number | null };
type StateBalance = { state: string; direct: Balance; thirdParty: Balance };
type LoanEvidence = {
  loanId: string; revision: number; state: string; source: Source | null; intakeReference: string;
  opening?: ReviewedAmount; ending?: ReviewedAmount; outcomeReference?: string;
};
type AmountChange = { id: string; loanId: string; date: string; sequence: number | null; before: number | null; after: number | null; reference: string };
type Adjustment = { loanId: string; kind: "add" | "remove"; date: string; reference: string; commentary: string };

const isReference = (value?: string) => Boolean(value?.trim());
const isAmount = (value: number | null | undefined) => value != null && Number.isSafeInteger(value) && value >= 0;
const sourceLabels = { direct: "Direct", thirdParty: "Third party" };
const blankBalance = (): Balance => ({ count: null, amount: null });

function NumberField({ label, value, update, min = 0 }: {
  label: string; value: number | null; update: (value: number | null) => void; min?: number;
}) {
  return <label className="field">{label}<input type="number" inputMode="numeric" min={min} step={1} value={value ?? ""}
    onChange={event => update(event.target.value === "" ? null : Number(event.target.value))} /></label>;
}

function ReferenceField({ label, value, update }: { label: string; value: string; update: (value: string) => void }) {
  return <label className="field">{label}<input value={value} maxLength={160} onChange={event => update(event.target.value)} /></label>;
}

function complete(file: LoanEvidence) {
  return Boolean(file.source && isReference(file.intakeReference) &&
    (!file.opening || (isAmount(file.opening.amount) && isReference(file.opening.reference))) &&
    (file.ending ? isAmount(file.ending.amount) && isReference(file.ending.reference) : isReference(file.outcomeReference)));
}

export function Fv7GuidedEntry({ entry, busy, onChange, onCheck, onOpenLoan }: {
  entry: Fv7Entry; busy: boolean; onChange: () => void; onCheck: (evidence: string) => void; onOpenLoan: (loanId: string) => void;
}) {
  const { template } = entry;
  const [entity, setEntity] = useState("");
  const [prior, setPrior] = useState("");
  const [amountLedger, setAmountLedger] = useState("");
  const [adjustmentLedger, setAdjustmentLedger] = useState("");
  const [balances, setBalances] = useState<StateBalance[]>(template.priorEnding.states);
  const [state, setState] = useState(balances[0]?.state ?? "");
  const [addState, setAddState] = useState("");
  const [files, setFiles] = useState<LoanEvidence[]>(template.files);
  const [loan, setLoan] = useState(files[0]?.loanId ?? "");
  const [changes, setChanges] = useState<AmountChange[]>([]);
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [error, setError] = useState("");
  const feedback = useRef<HTMLParagraphElement>(null);
  const balanceSection = useRef<HTMLDetailsElement>(null);
  const loanSection = useRef<HTMLDetailsElement>(null);
  const balance = balances.find(item => item.state === state);
  const file = files.find(item => item.loanId === loan);
  const snapshot = entry.loans.find(item => item.id === loan);
  const loans = new Map(entry.loans.map(item => [item.id, item]));
  const ready = files.filter(complete).length;
  const fileChanges = changes.filter(item => item.loanId === loan);
  const adjustment = adjustments.find(item => item.loanId === loan);

  useEffect(() => {
    if (error) feedback.current?.focus();
  }, [error]);

  function edited() {
    setError("");
    onChange();
  }

  function updateBalance(source: Source, field: keyof Balance, value: number | null) {
    edited();
    setBalances(rows => rows.map(item => item.state === state ? { ...item, [source]: { ...item[source], [field]: value } } : item));
  }

  function updateLoan(patch: Partial<LoanEvidence>) {
    edited();
    setFiles(rows => rows.map(item => item.loanId === loan ? { ...item, ...patch } : item));
  }

  function updateChange(id: string, patch: Partial<AmountChange>) {
    edited();
    setChanges(rows => rows.map(row => row.id === id ? { ...row, ...patch } : row));
  }

  function updateAdjustment(value: Adjustment | undefined) {
    edited();
    setAdjustments(rows => [...rows.filter(row => row.loanId !== loan), ...(value ? [value] : [])]);
  }

  function showLoan(loanId: string, message: string) {
    setLoan(loanId);
    if (loanSection.current) loanSection.current.open = true;
    setError(message);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (![entity, prior, amountLedger, adjustmentLedger].every(isReference)) {
      setError("Enter the reporting entity and all three source references.");
      return;
    }
    const missingBalance = balances.find(item => [item.direct, item.thirdParty].some(value => !isAmount(value.count) || !isAmount(value.amount)));
    if (!balances.length || missingBalance) {
      if (missingBalance) setState(missingBalance.state);
      if (balanceSection.current) balanceSection.current.open = true;
      setError("Enter a count and whole-dollar balance for both intake channels. Enter 0 for reviewed zero activity.");
      return;
    }
    const missing = files.find(item => !complete(item));
    if (missing) {
      showLoan(missing.loanId, "Complete the selected loan’s intake and applicable opening, ending or outcome evidence.");
      return;
    }
    const invalidChange = changes.find(item => !item.date || !item.sequence || !isAmount(item.sequence) ||
      !isAmount(item.before) || !isAmount(item.after) || !isReference(item.reference));
    if (invalidChange) {
      showLoan(invalidChange.loanId, "Complete the date, sequence, amounts and reference for each amount change.");
      return;
    }
    const invalidAdjustment = adjustments.find(item => !item.date || !isReference(item.reference) || !isReference(item.commentary));
    if (invalidAdjustment) {
      showLoan(invalidAdjustment.loanId, "Complete the date, reference and reason for the scope adjustment.");
      return;
    }
    setError("");
    onCheck(JSON.stringify({ ...template, entityReference: entity, adjustmentLedgerReference: adjustmentLedger,
      amountChangeLedgerReference: amountLedger, priorEnding: { ...template.priorEnding, reference: prior, states: balances },
      files, amountChanges: changes.map(({ loanId, date, sequence, before, after, reference }) => ({ loanId, date, sequence, before, after, reference })),
      adjustments }));
  }

  function reviewedAmount(label: "opening" | "ending", value: ReviewedAmount) {
    const heading = label === "opening" ? "Opening" : "Ending";
    return <fieldset className="record-form">
      <legend>{heading} evidence</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <NumberField label={`${heading} amount (USD)`} value={value.amount} update={amount => updateLoan({ [label]: { ...value, amount } })} />
        <ReferenceField label={`${heading} reference`} value={value.reference} update={reference => updateLoan({ [label]: { ...value, reference } })} />
      </div>
    </fieldset>;
  }

  return <form className="record-form" aria-label="Enter FV7 evidence" noValidate onSubmit={submit}>
    <p>Evidence for {quarterName(template)} · Review v{template.version}</p>
    <fieldset className="record-form" disabled={busy}>
      <legend>Reporting sources</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <ReferenceField label="Reporting entity reference" value={entity} update={value => { edited(); setEntity(value); }} />
        <ReferenceField label="Prior ending balance reference" value={prior} update={value => { edited(); setPrior(value); }} />
        <ReferenceField label="Amount change ledger reference" value={amountLedger} update={value => { edited(); setAmountLedger(value); }} />
        <ReferenceField label="Scope adjustment ledger reference" value={adjustmentLedger} update={value => { edited(); setAdjustmentLedger(value); }} />
      </div>
      <details ref={balanceSection} className="document-form">
        <summary>Prior ending balances · {balances.length} {balances.length === 1 ? "state" : "states"}</summary>
        <div className="record-form">
          <p className="muted">Use reviewed balances from {template.priorEnding.period}. Enter 0 for reviewed zero activity.</p>
          {balances.length > 0 && <label className="field">Balance state<select value={state} onChange={event => setState(event.target.value)}>
            {balances.map(item => <option key={item.state}>{item.state}</option>)}
          </select></label>}
          {balance && (["direct", "thirdParty"] as const).map(source => <fieldset key={source} className="record-form">
            <legend>{sourceLabels[source]} intake</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <NumberField label="Application count" value={balance[source].count} update={value => updateBalance(source, "count", value)} />
              <NumberField label="Ending amount (USD)" value={balance[source].amount} update={value => updateBalance(source, "amount", value)} />
            </div>
          </fieldset>)}
          <label className="field">Additional reporting state<select value={addState} onChange={event => setAddState(event.target.value)}>
            <option value="">Choose a state</option>
            {reportStates.filter(code => !balances.some(item => item.state === code)).map(code => <option key={code}>{code}</option>)}
          </select></label>
          <div className="loan-application-actions">
            <Button type="button" size="sm" variant="outline" disabled={!addState} onClick={() => {
              edited();
              setBalances(rows => [...rows, { state: addState, direct: blankBalance(), thirdParty: blankBalance() }]);
              setState(addState);
              setAddState("");
            }}>Add reporting state</Button>
            {balance && !template.priorEnding.states.some(item => item.state === state) && <Button type="button" size="sm" variant="outline" onClick={() => {
              edited();
              const rest = balances.filter(item => item.state !== state);
              setBalances(rest);
              setState(rest[0]?.state ?? "");
            }}>Remove {state}</Button>}
          </div>
        </div>
      </details>
      <details ref={loanSection} className="document-form">
        <summary>Loan evidence · {ready} of {files.length} complete</summary>
        <div className="record-form">
          {!files.length && <p>No included loans in this saved review.</p>}
          {file && snapshot && <>
            <label className="field">Loan in saved review<select className="min-w-0" value={loan} onChange={event => setLoan(event.target.value)}>
              {files.map(item => <option key={item.loanId} value={item.loanId}>{loans.get(item.loanId)?.name ?? item.loanId} · {item.state} · {complete(item) ? "Complete" : "Needs evidence"}</option>)}
            </select></label>
            <p className="break-words"><strong>{snapshot.name ?? file.loanId}</strong> · {file.state} · Facts v{file.revision}</p>
            <p className="muted">Saved intake {snapshot.received} · {snapshot.amount ? `$${Number(snapshot.amount).toLocaleString("en-US")}` : "Amount unavailable"}{snapshot.outcome && ` · ${snapshot.outcome} ${snapshot.outcomeOn}`}
              {snapshot.outcomeAmount && ` · $${Number(snapshot.outcomeAmount).toLocaleString("en-US")}`}</p>
            {snapshot.name && <div><Button type="button" variant="outline" size="sm" onClick={() => onOpenLoan(file.loanId)}>Open loan facts</Button></div>}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="field">Reviewed intake source<select value={file.source ?? ""} onChange={event => updateLoan({ source: (event.target.value || null) as Source | null })}>
                <option value="">Choose an intake source</option><option value="direct">Direct</option><option value="thirdParty">Third party</option>
              </select></label>
              <ReferenceField label="Intake evidence reference" value={file.intakeReference} update={intakeReference => updateLoan({ intakeReference })} />
            </div>
            {file.opening && reviewedAmount("opening", file.opening)}
            {file.ending ? reviewedAmount("ending", file.ending) :
              <ReferenceField label="Outcome evidence reference" value={file.outcomeReference ?? ""} update={outcomeReference => updateLoan({ outcomeReference })} />}
            <details className="document-form">
              <summary>Amount changes and scope adjustment</summary>
              <div className="record-form">
                {fileChanges.map((item, index) => <fieldset className="record-form" key={item.id}>
                  <legend>Amount change {index + 1}</legend>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="field">Change date<input type="date" value={item.date} onChange={event => updateChange(item.id, { date: event.target.value })} /></label>
                    <NumberField label="Sequence on this date" value={item.sequence} min={1} update={sequence => updateChange(item.id, { sequence })} />
                    <NumberField label="Amount before (USD)" value={item.before} update={before => updateChange(item.id, { before })} />
                    <NumberField label="Amount after (USD)" value={item.after} update={after => updateChange(item.id, { after })} />
                  </div>
                  <ReferenceField label="Change evidence reference" value={item.reference} update={reference => updateChange(item.id, { reference })} />
                  <div><Button type="button" size="sm" variant="outline" onClick={() => {
                    edited();
                    setChanges(rows => rows.filter(row => row.id !== item.id));
                  }}>Remove amount change {index + 1}</Button></div>
                </fieldset>)}
                <div><Button type="button" variant="outline" size="sm" onClick={() => {
                  edited();
                  const item = { id: crypto.randomUUID(), loanId: loan, date: "", sequence: 1, before: null, after: null, reference: "" };
                  setChanges(rows => [...rows, item]);
                }}>Add amount change</Button></div>
                <label className="field">Scope adjustment<select value={adjustment?.kind ?? ""} onChange={event => {
                  const kind = event.target.value as Adjustment["kind"] | "";
                  updateAdjustment(kind ? { loanId: loan, date: "", reference: "", commentary: "", ...adjustment, kind } : undefined);
                }}><option value="">No adjustment</option>{file.opening && <option value="add">Add to scope</option>}{file.ending && <option value="remove">Remove from scope</option>}</select></label>
                {adjustment && <>
                  <label className="field">Adjustment date<input type="date" value={adjustment.date} onChange={event => updateAdjustment({ ...adjustment, date: event.target.value })} /></label>
                  <ReferenceField label="Adjustment evidence reference" value={adjustment.reference} update={reference => updateAdjustment({ ...adjustment, reference })} />
                  <label className="field">Adjustment reason<textarea value={adjustment.commentary} maxLength={500} rows={2}
                    onChange={event => updateAdjustment({ ...adjustment, commentary: event.target.value })} /></label>
                </>}
              </div>
            </details>
          </>}
        </div>
      </details>
      <div><Button type="submit" size="sm">{busy ? "Checking evidence…" : "Check entered evidence"}</Button></div>
    </fieldset>
    {error && <p ref={feedback} tabIndex={-1} role="alert">{error}</p>}
  </form>;
}
