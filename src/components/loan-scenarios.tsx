"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, GitCompareArrows, Plus, Save, Star } from "lucide-react";
import type { Loan, Workspace } from "@/lib/model";
import type { WorkspaceStaff } from "@/lib/staff-store";
import { blankScenarioOption, compareLoanScenarios, sampleScenarioPlan, scenarioGoals, scenarioPlanSchema,
  type LoanScenarioOption, type ScenarioPlan, type ScenarioResponse } from "@/lib/loan-scenario-model";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const money = (cents: number) => dollars.format(cents / 100);
type NumericOption = { [K in keyof LoanScenarioOption]: LoanScenarioOption[K] extends number ? K : never }[keyof LoanScenarioOption];
const optionFields: [NumericOption, string, boolean][] = [
  ["loanAmount", "Loan amount", true], ["rate", "Interest rate (%)", false], ["years", "Term (years)", false],
  ["pointsPercent", "Discount points (%)", false], ["lenderCredit", "Lender credit", true], ["fees", "Loan and settlement fees", true],
  ["prepaids", "Prepaid items", true], ["escrow", "Initial escrow", true], ["monthlyTaxes", "Monthly property taxes", true],
  ["monthlyInsurance", "Monthly homeowners insurance", true], ["monthlyHoa", "Monthly HOA", true],
  ["monthlyMi", "Monthly mortgage insurance", true], ["miMonths", "Months of mortgage insurance", false],
];

function NumberInput({ label, value, cents = false, optional = false, max, change }: {
  label: string; value: number | null; cents?: boolean; optional?: boolean; max?: number; change: (value: number | null) => void;
}) {
  return <label className="field"><span>{label}</span><input type="number" min={0} max={max ?? (cents ? 25_000_000 : 480)}
    step={cents ? "0.01" : label.includes("(%)") ? "0.001" : "1"} required={!optional}
    value={value === null ? "" : cents ? value / 100 : value} placeholder={optional ? "No limit" : undefined}
    onChange={event => change(event.target.value === "" && optional ? null : cents ? Math.round(Number(event.target.value) * 100) : Number(event.target.value))} /></label>;
}

export function LoanScenarios({ loan, state, staff, markDraftChanged }: {
  loan: Loan; state: Workspace; staff: WorkspaceStaff; markDraftChanged: (editor: Node) => void;
}) {
  const [response, setResponse] = useState<ScenarioResponse>();
  const [plan, setPlan] = useState<ScenarioPlan | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [pricingKey, setPricingKey] = useState("");
  const form = useRef<HTMLFormElement>(null);
  const endpoint = `/api/loan-scenarios?brokerage=${encodeURIComponent(staff.brokerage.id)}`;
  const draft = state.applications.find(application => application.loanId === loan.id)?.draft;
  const currentAppRevision = state.applications.find(application => application.loanId === loan.id)?.revision ?? null;
  const quoteOptions = state.pricingRuns.filter(run => run.loanId === loan.id && run.applicationRevision === currentAppRevision)
    .flatMap(run => run.offers.filter(offer => /fixed/i.test(offer.product)).map(offer => ({ key: `${run.id}/${offer.id}`, run, offer })));
  const sampleAllowed = staff.brokerage.pilot || staff.brokerage.id === "orbit-demo";

  useEffect(() => {
    const controller = new AbortController();
    fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "read", loanId: loan.id }), signal: controller.signal })
      .then(async result => {
        const body = await result.json() as ScenarioResponse | { error: string };
        if ("error" in body) throw new Error(body.error);
        if (!result.ok) throw new Error("Could not load scenarios.");
        if (!controller.signal.aborted) { setResponse(body); setPlan(body.record?.plan ?? null); }
      }).catch(failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Could not load scenarios."); });
    return () => controller.abort();
  }, [endpoint, loan.id, reload]);

  const dirty = JSON.stringify(plan) !== JSON.stringify(response?.record?.plan ?? null);
  function edit(next: ScenarioPlan, financial = true) {
    setPlan(financial ? { ...next, recommendedId: null, recommendation: "" } : next);
    setMessage("");
    if (form.current) markDraftChanged(form.current);
  }
  function start(samples: boolean) {
    const amount = Math.max(100, Math.round(loan.amount * 100));
    const initial = sampleScenarioPlan(amount, loan.purpose === "Refinance" ? "Refinance" : "Purchase");
    edit(samples ? initial : { ...initial, propertyValue: Math.max(amount, Math.round(Number(draft?.estimatedValue || loan.amount) * 100)),
      options: [blankScenarioOption(amount)] });
  }
  function updateOption(id: string, patch: Partial<LoanScenarioOption>) {
    if (plan) edit({ ...plan, options: plan.options.map(option => option.id === id ? { ...option, ...patch } : option) });
  }
  const parsed = plan ? scenarioPlanSchema.safeParse(plan) : null;
  const metrics = parsed?.success ? compareLoanScenarios(parsed.data) : [];
  const eligible = metrics.filter(metric => metric.withinBudget);
  const goalField = plan?.goal === "Lower monthly payment" ? "monthly" : plan?.goal === "Less cash upfront" ? "cashToClose" : "borrowingCost";
  const bestValue = eligible.length ? Math.min(...eligible.map(metric => metric[goalField])) : null;
  async function save() {
    if (!parsed?.success || !response) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "save", loanId: loan.id, revision: response.record?.revision ?? 0, applicationRevision: response.currentApplicationRevision, plan: parsed.data }) });
      const body = await result.json() as ScenarioResponse | { error: string };
      if ("error" in body) throw new Error(body.error);
      if (!result.ok || !body.record) throw new Error("Could not save scenarios.");
      form.current?.reset();
      setResponse(body); setPlan(body.record.plan); setMessage("Scenarios saved.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not save scenarios."); }
    finally { setBusy(false); }
  }

  return <section className="details-section scenario-workspace" id="loan-scenarios" tabIndex={-1} aria-label="Loan scenarios">
    <div className="section-heading"><div><h3><GitCompareArrows size={18} /> Loan scenarios</h3>
      <p className="muted">Compare fixed-rate options around the borrower’s priorities.</p></div>
      {response && <span className="pill">{dirty ? "Unsaved changes" : response.record ? "Saved comparison" : "New comparison"}</span>}
    </div>
    {error && <p role="alert" className="application-message banner-error">{error}</p>}
    {message && <p role="status" className="application-message">{message}</p>}
    {!response && !error && <p role="status">Loading scenarios…</p>}
    <div className="loan-application-actions">{(error || response?.record) && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => {
      form.current?.reset(); setMessage(""); setError(""); setResponse(undefined); setReload(value => value + 1);
    }}>{dirty ? "Discard edits and reload" : "Reload saved comparison"}</Button>}</div>
    {response && <form ref={form} className="record-form" onSubmit={event => { event.preventDefault(); void save(); }}>
      {!plan ? <div className="scenario-start"><h4>Build a plan for this borrower</h4><p>Compare payment, cash needed, and cost over time.</p>
        {response.canEdit && <div className="loan-application-actions"><Button type="button" onClick={() => start(false)}><Plus size={16} /> Add first option</Button>
          {sampleAllowed && <Button type="button" variant="outline" onClick={() => start(true)}>Load sample comparison</Button>}</div>}
      </div> : <>
        {response.record && response.record.applicationRevision !== currentAppRevision && <p className="application-message">The 1003 has changed. Review these assumptions before saving.</p>}
        <fieldset className="scenario-fieldset" disabled={busy || !response.canEdit}>
          <legend>Borrower priorities</legend>
          <div className="form-grid">
            <label className="field">Primary goal<select value={plan.goal} onChange={event => edit({ ...plan, goal: event.target.value as ScenarioPlan["goal"] })}>
              {scenarioGoals.map(goal => <option key={goal}>{goal}</option>)}</select></label>
            <NumberInput label="Expected time with this loan (months)" value={plan.holdingMonths} change={value => edit({ ...plan, holdingMonths: value ?? 60 })} />
            <NumberInput label="Monthly housing budget" value={plan.monthlyBudget} cents optional change={value => edit({ ...plan, monthlyBudget: value })} />
            <NumberInput label="Cash available for closing" value={plan.cashBudget} cents optional change={value => edit({ ...plan, cashBudget: value })} />
          </div>
          <details className="document-form"><summary>Property and closing assumptions</summary><div className="form-grid">
            <label className="field">Purpose<select value={plan.purpose} onChange={event => edit({ ...plan, purpose: event.target.value as ScenarioPlan["purpose"], deposit: 0, sellerCredit: 0 })}>
              <option>Purchase</option><option>Refinance</option></select></label>
            <NumberInput label={plan.purpose === "Purchase" ? "Purchase price" : "Property value"} value={plan.propertyValue} cents change={value => edit({ ...plan, propertyValue: value ?? 0 })} />
            {plan.purpose === "Purchase" ? <>
              <NumberInput label="Deposit already paid" value={plan.deposit} cents change={value => edit({ ...plan, deposit: value ?? 0 })} />
              <NumberInput label="Seller credit" value={plan.sellerCredit} cents change={value => edit({ ...plan, sellerCredit: value ?? 0 })} />
            </> : <NumberInput label="Existing loan payoffs" value={plan.payoffs} cents change={value => edit({ ...plan, payoffs: value ?? 0 })} />}
          </div></details>
        </fieldset>
        {parsed && !parsed.success && <p role="alert" className="application-message">{parsed.error.issues[0].message}</p>}
        {metrics.length > 0 && <>
          <div className="scenario-table-scroll"><table className="scenario-table"><caption>Fixed-rate estimates · {plan.holdingMonths}-month comparison</caption>
            <thead><tr><th scope="col">Compare</th>{plan.options.map((option, index) => <th scope="col" key={option.id}>{option.name}
              {metrics[index].withinBudget && metrics[index][goalField] === bestValue && metrics.length > 1 && <span className="scenario-highlight">Best on selected goal</span>}
              {!metrics[index].withinBudget && <span className="scenario-budget">Above budget</span>}
              {plan.recommendedId === option.id && <span className="scenario-highlight">Recommended</span>}
            </th>)}</tr></thead>
            <tbody>{([
              ["Loan amount", (_m, index) => money(plan.options[index].loanAmount)],
              ["Rate / term", (_m, index) => `${plan.options[index].rate.toFixed(3)}% / ${plan.options[index].years} years`],
              ["Initial monthly housing payment", metric => money(metric.monthly)],
              ["Principal & interest", metric => money(metric.principalAndInterest)],
              ["Cash to close / (cash back)", metric => metric.cashToClose < 0 ? `(${money(-metric.cashToClose)})` : money(metric.cashToClose)],
              ["Borrowing cost over your timeframe", metric => money(metric.borrowingCost)],
              ["Interest paid", metric => money(metric.interest)],
              ["Principal paid", metric => money(metric.principalPaid)],
              ["Remaining balance", metric => money(metric.balance)],
              ["Loan-to-value", metric => `${metric.ltv.toFixed(1)}%`],
              [`Cost break-even vs ${plan.options[0].name}`, (metric, index) => index === 0 ? "Baseline" : metric.breakEvenMonths ? `${metric.breakEvenMonths} months${metric.breakEvenMonths > plan.holdingMonths ? " · after timeframe" : ""}` : "—"],
            ] as [string, (metric: typeof metrics[number], index: number) => string][]).map(([label, render]) => <tr key={label}>
              <th scope="row">{label}</th>{metrics.map((metric, index) => <td key={metric.id}>{render(metric, index)}</td>)}</tr>)}</tbody>
          </table></div>
          {!eligible.length && <p className="application-message">These options exceed the borrower’s budget. Adjust an option or review the budget together.</p>}
          <details className="document-form"><summary>How the comparison works</summary>
            <p className="muted">Payment includes principal, interest, taxes, homeowners insurance, HOA, and mortgage insurance. Borrowing cost includes interest, mortgage insurance, fees, and points, less lender credits. Principal, escrow, prepaid items, and property expenses are shown separately or included in cash to close.</p>
            <p className="muted">Fixed rates and property expenses stay constant. Mortgage insurance uses the months entered. Break-even compares cumulative borrowing cost for equal loan amounts; a dash means no later sustained break-even or no extra upfront borrowing cost. These are planning estimates; confirm program eligibility and final terms with the lender.</p>
          </details>
        </>}
        <div className="scenario-editors">{plan.options.map((option, index) => <details className="document-form scenario-option" key={option.id} open={plan.options.length === 1 ? true : undefined}>
          <summary>{option.name} · Edit assumptions</summary><fieldset className="scenario-fieldset" disabled={busy || !response.canEdit}>
            <legend className="sr-only">{option.name} assumptions</legend><div className="form-grid">
              <label className="field">Option name<input maxLength={60} required value={option.name} onChange={event => updateOption(option.id, { name: event.target.value })} /></label>
              <label className="field">Program / lender<input maxLength={60} required value={option.program} onChange={event => updateOption(option.id, { program: event.target.value })} /></label>
              {optionFields.map(([key, label, cents]) => <NumberInput key={key} label={label} value={option[key]} cents={cents}
                max={key === "rate" ? 25 : key === "pointsPercent" ? 10 : key === "years" ? 40 : undefined}
                change={value => updateOption(option.id, { [key]: value ?? 0 })} />)}
            </div><div className="loan-application-actions">
              <Button type="button" size="sm" variant="outline" disabled={plan.options.length >= 4} onClick={() => edit({ ...plan, options: [...plan.options, { ...option, id: crypto.randomUUID(), name: `${option.name.slice(0, 50)} copy` }] })}><Copy size={15} /> Duplicate option</Button>
              <Button type="button" size="sm" variant="ghost" disabled={plan.options.length === 1} onClick={() => edit({ ...plan, options: plan.options.filter((_, at) => at !== index) })}>Remove option</Button>
            </div>
          </fieldset></details>)}</div>
        {response.canEdit && <>
          <div className="loan-application-actions"><Button type="button" variant="outline" size="sm" disabled={busy || plan.options.length >= 4}
            onClick={() => edit({ ...plan, options: [...plan.options, blankScenarioOption(plan.options[0].loanAmount, `Option ${plan.options.length + 1}`)] })}><Plus size={15} /> Add option</Button>
            {quoteOptions.length > 0 && <><label className="field">Saved pricing option<select value={pricingKey} onChange={event => setPricingKey(event.target.value)}><option value="">Choose an option</option>
              {quoteOptions.map(({ key, run, offer }) => <option key={key} value={key}>{offer.product} · {offer.rate.toFixed(3)}% · {run.mode} · {dateTime(run.quotedAt)}</option>)}</select></label>
              <Button type="button" size="sm" variant="outline" disabled={busy || !pricingKey || plan.options.length >= 4} onClick={() => {
                const item = quoteOptions.find(quote => quote.key === pricingKey); if (!item) return;
                const worksheet = state.feeWorksheets.find(fee => fee.runId === item.run.id && fee.offerId === item.offer.id);
                const fees = worksheet?.inputs.fees;
                edit({ ...plan, options: [...plan.options, { ...blankScenarioOption(Math.round(item.run.scenario.loanAmount * 100), `Pricing option ${plan.options.length + 1}`),
                  program: item.offer.product.slice(0, 60), rate: item.offer.rate, years: item.offer.years,
                  pointsPercent: Math.max(0, (item.offer.pricingAmount ?? 0) / item.run.scenario.loanAmount * 100),
                  lenderCredit: Math.max(0, -Math.round((item.offer.pricingAmount ?? 0) * 100)),
                  fees: fees ? fees.origination + fees.appraisal + fees.creditReport + fees.settlement + fees.government + fees.other : 0,
                  prepaids: fees?.prepaid ?? 0, escrow: fees?.escrow ?? 0 }] }); setPricingKey("");
              }}>Add pricing snapshot</Button></>}
          </div>
          <fieldset className="scenario-fieldset" disabled={busy}><legend><Star size={15} /> Recommendation</legend><div className="form-grid">
            <label className="field">Preferred option<select value={plan.recommendedId ?? ""} onChange={event => edit({ ...plan, recommendedId: event.target.value || null }, false)}>
              <option value="">Choose after reviewing</option>{plan.options.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>
            <label className="field">Why this fits the borrower<textarea maxLength={1200} required={Boolean(plan.recommendedId)} value={plan.recommendation}
              placeholder="Connect the recommendation to their priorities." onChange={event => edit({ ...plan, recommendation: event.target.value }, false)} /></label>
          </div></fieldset>
          <div className="loan-application-actions"><Button type="submit" disabled={busy || !parsed?.success || !dirty}><Save size={16} /> {busy ? "Saving…" : "Save comparison"}</Button>
            <span className="muted">{response.record ? `Saved ${dateTime(response.record.updatedAt)} by ${response.record.updatedBy}` : "Save this comparison with the loan."}</span></div>
        </>}
        {!response.canEdit && plan.recommendation && <p><strong>Recommendation:</strong> {plan.recommendation}</p>}
      </>}
    </form>}
  </section>;
}
