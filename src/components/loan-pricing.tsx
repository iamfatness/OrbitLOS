"use client";

import { useState, type FormEvent } from "react";
import { BadgeCheck, Calculator, Eye, FlaskConical } from "lucide-react";
import type { ApplicationDraft } from "@/lib/application-model";
import type { Loan, Workspace } from "@/lib/model";
import { pricingPrograms, sampleNonAgencyMetrics, type PricingOffer, type PricingProgram, type PricingRun, type PricingScenario } from "@/lib/pricing-model";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";
import { UwmRateLock } from "./uwm-rate-lock";

const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const cash = (amount: number | null) => amount === null ? "—" : dollars.format(amount);
const percentage = (value: number | null) => value === null ? "—" : `${value.toFixed(3)}%`;
const occupancies = ["Primary residence", "Second home", "Investment property"];
const propertyTypes = ["Single family", "Attached condominium"];

function defaults(loan: Loan, draft: ApplicationDraft | null | undefined, run?: PricingRun) {
  const scenario = run?.scenario;
  const nonAgency = scenario?.nonAgency;
  const program: PricingProgram = nonAgency?.program ?? "Conventional";
  const bank = nonAgency?.program === "Bank statement" ? nonAgency : undefined;
  return {
    program,
    purpose: scenario?.purpose ?? (draft?.purpose === "Other" ? loan.purpose : draft?.purpose ?? loan.purpose),
    loanAmount: String(scenario?.loanAmount ?? (draft?.loanAmount || loan.amount || "")),
    propertyValue: String(scenario?.propertyValue ?? (draft?.estimatedValue || "")),
    purchasePrice: String(scenario?.purchasePrice ?? ""),
    zip: scenario?.zip ?? (draft?.propertyLocation.zip.slice(0, 5) || loan.address.match(/\b\d{5}(?:-\d{4})?$/)?.[0].slice(0, 5) || ""),
    creditScore: String(scenario?.creditScore ?? ""),
    monthlyIncome: String(scenario?.monthlyIncome ?? (draft?.monthlyIncome || "")),
    occupancy: scenario?.occupancy ?? (draft?.occupancy && draft.occupancy !== "FHA secondary residence" ? draft.occupancy : "Primary residence"),
    propertyType: scenario?.propertyType ?? "Single family",
    firstTimeBuyer: scenario?.firstTimeBuyer ?? false,
    monthlyRent: nonAgency?.program === "DSCR" ? String(nonAgency.monthlyRent) : "",
    monthlyTaxes: String(nonAgency?.monthlyTaxes ?? ""),
    monthlyInsurance: String(nonAgency?.monthlyInsurance ?? ""),
    monthlyHoa: String(nonAgency?.monthlyHoa ?? ""),
    reservesMonths: String(nonAgency?.reservesMonths ?? ""),
    refinanceType: nonAgency?.refinanceType ?? "Rate and term",
    statementType: bank?.source.type ?? "Personal",
    statementMonths: String(bank?.statementMonths ?? 12),
    averageMonthlyDeposits: String(bank?.averageMonthlyDeposits ?? ""),
    expensePercent: bank?.source.type === "Business" ? String(bank.source.expensePercent) : "",
    ownershipPercent: bank?.source.type === "Business" ? String(bank.source.ownershipPercent) : "",
    monthlyDebts: String(bank?.monthlyDebts ?? ""),
    selfEmployed: bank?.selfEmployed ?? false,
  };
}

function SampleMetrics({ scenario, offer }: { scenario: PricingScenario; offer: PricingOffer }) {
  if (!scenario.nonAgency) return null;
  const metrics = sampleNonAgencyMetrics(scenario.nonAgency, offer.principalAndInterest);
  return <dl className="quote-terms">
    <div><dt>Estimated monthly housing cost</dt><dd>{cash(metrics.housing)}</dd></div>
    {metrics.program === "DSCR" ? <div><dt>Sample DSCR</dt><dd>{metrics.dscr.toFixed(2)}×</dd></div> : <>
      <div><dt>Estimated monthly statement income</dt><dd>{cash(metrics.income)}</dd></div>
      <div><dt>Estimated debt-to-income ratio</dt><dd>{(metrics.dti * 100).toFixed(1)}%</dd></div>
    </>}
  </dl>;
}

function NumberField({ label, value, change, min = 0, max = 10_000_000, step = 0.01 }: {
  label: string; value: string; change: (value: string) => void; min?: number; max?: number; step?: number;
}) {
  return <label className="field"><span>{label}</span><input required type="number" min={min} max={max} step={step}
    value={value} onChange={(event) => change(event.target.value)} /></label>;
}

function Terms({ offer }: { offer: PricingOffer }) {
  return <dl className="quote-terms">
    <div><dt>Rate</dt><dd>{percentage(offer.rate)}</dd></div>
    <div><dt>Monthly P&amp;I</dt><dd>{cash(offer.principalAndInterest)}</dd></div>
    {offer.apr !== null && <div><dt>APR</dt><dd>{percentage(offer.apr)}</dd></div>}
    {offer.pricingAmount !== null && <div><dt>{offer.pricingLabel}</dt><dd>
      {cash(offer.pricingLabel === "Lender credit" ? Math.abs(offer.pricingAmount) : offer.pricingAmount)}
      {offer.pricingPercent !== null && <small>{percentage(offer.pricingLabel === "Lender credit" ? Math.abs(offer.pricingPercent) : offer.pricingPercent)}</small>}
    </dd></div>}
  </dl>;
}

export function LoanPricing({ loan, state, busy, save }: {
  loan: Loan; state: Workspace; busy: boolean; save: (input: unknown, after?: () => void) => Promise<void>;
}) {
  const runs = state.pricingRuns.filter((item) => item.loanId === loan.id);
  const current = runs[0];
  const saved = runs.filter((item) => item.selectedAt).sort((a, b) => (b.selectedAt ?? "").localeCompare(a.selectedAt ?? ""))[0];
  const selected = saved?.offers.find((offer) => offer.id === saved.selectedId);
  const application = state.applications.find((item) => item.loanId === loan.id);
  const draft = application?.draft;
  const published = state.publishedQuotes.find((quote) => quote.loanId === loan.id);
  const publishedRun = runs.find((run) => run.id === published?.runId);
  const sharedHistory = state.sharedQuoteHistory.filter((quote) => quote.loanId === loan.id);
  const alreadyShared = published?.runId === saved?.id && published?.offerId === selected?.id;
  const [form, setForm] = useState(() => defaults(loan, draft, current));
  const [preview, setPreview] = useState(false);
  const [pricing, setPricing] = useState(false);
  const change = (name: keyof typeof form, value: string | boolean) => setForm((last) => ({ ...last, [name]: value }));
  const dscr = form.program === "DSCR";
  const bank = form.program === "Bank statement";
  const applicationChanged = (run: PricingRun | undefined) => run?.applicationRevision != null &&
    (run.applicationRevision !== application?.revision || !!application.correctionNote);
  const savedAssumptionsChanged = !!saved && JSON.stringify(form) !== JSON.stringify(defaults(loan, draft, saved));
  const publishedAssumptionsChanged = !!publishedRun && !!current && current.quotedAt > publishedRun.quotedAt &&
    JSON.stringify(current.scenario) !== JSON.stringify(publishedRun.scenario);
  const comparison = runs.filter((run) => run.selectedId);

  async function price(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (bank && !form.selfEmployed) return;
    const propertyExpenses = {
      monthlyTaxes: Number(form.monthlyTaxes), monthlyInsurance: Number(form.monthlyInsurance), monthlyHoa: Number(form.monthlyHoa),
      reservesMonths: Number(form.reservesMonths), refinanceType: form.purpose === "Refinance" ? form.refinanceType : null,
    };
    const scenario: PricingScenario = {
      purpose: form.purpose, loanAmount: Number(form.loanAmount), propertyValue: Number(form.propertyValue),
      purchasePrice: form.purpose === "Purchase" && form.purchasePrice ? Number(form.purchasePrice) : null,
      zip: form.zip, creditScore: Number(form.creditScore), propertyType: form.propertyType,
      occupancy: dscr ? "Investment property" : form.occupancy,
      firstTimeBuyer: !dscr && form.purpose === "Purchase" && form.firstTimeBuyer,
      monthlyIncome: form.program === "Conventional" ? Number(form.monthlyIncome) : undefined,
      nonAgency: dscr ? { ...propertyExpenses, program: "DSCR", monthlyRent: Number(form.monthlyRent) } : bank ? {
        ...propertyExpenses, program: "Bank statement", selfEmployed: true, statementMonths: form.statementMonths === "24" ? 24 : 12,
        averageMonthlyDeposits: Number(form.averageMonthlyDeposits), monthlyDebts: Number(form.monthlyDebts),
        source: form.statementType === "Business" ? { type: "Business", expensePercent: Number(form.expensePercent),
          ownershipPercent: Number(form.ownershipPercent) } : { type: "Personal" },
      } : undefined,
    };
    setPricing(true);
    setPreview(false);
    try { await save({ type: "runPricing", loanId: loan.id, scenario }); }
    finally { setPricing(false); }
  }

  function loadSample() {
    setForm({
      ...defaults(loan, draft), loanAmount: "360000", propertyValue: "450000", purchasePrice: form.purpose === "Purchase" ? "450000" : "",
      program: form.program, purpose: form.purpose, zip: "48009", creditScore: "760", monthlyIncome: "9500",
      monthlyTaxes: "450", monthlyInsurance: "125", monthlyHoa: "0", reservesMonths: "6", monthlyRent: "3600",
      selfEmployed: true, statementType: "Business", averageMonthlyDeposits: "19000", expensePercent: "50", ownershipPercent: "100", monthlyDebts: "850",
    });
  }

  return <div className="pricing-panel">
    <header className="pricing-heading">
      <div><h3><Calculator size={18} /> UWM Easy Qualifier</h3><p>Conventional, DSCR, and bank statement scenarios.</p></div>
      <span className="pill"><FlaskConical size={13} /> {current?.mode === "stage" ? "UWM stage" : current ? "Sample pricing" : "Demo workspace"}</span>
    </header>
    <form className="pricing-form" onSubmit={(event) => void price(event)}>
      <div className="form-grid">
        <label className="field"><span>Loan program</span><select value={form.program} onChange={(event) => change("program", event.target.value)}>
          {pricingPrograms.map((program) => <option key={program}>{program}</option>)}
        </select></label>
        <label className="field"><span>Loan purpose</span><select value={form.purpose} onChange={(event) => change("purpose", event.target.value)}><option>Purchase</option><option>Refinance</option></select></label>
        {form.purpose === "Refinance" && (dscr || bank) && <label className="field"><span>Refinance type</span><select value={form.refinanceType} onChange={(event) => change("refinanceType", event.target.value)}>
          <option>Rate and term</option><option>Cash out</option>
        </select></label>}
        <label className="field"><span>Loan amount</span><input required type="number" min="1" max="25000000" step="0.01" value={form.loanAmount} onChange={(event) => change("loanAmount", event.target.value)} /></label>
        <label className="field"><span>Estimated property value</span><input required type="number" min="1" max="25000000" step="0.01" value={form.propertyValue} onChange={(event) => change("propertyValue", event.target.value)} /></label>
        {form.purpose === "Purchase" && <label className="field"><span>Purchase price (optional)</span><input type="number" min="1" max="25000000" step="0.01" value={form.purchasePrice} onChange={(event) => change("purchasePrice", event.target.value)} /></label>}
        <label className="field"><span>Property ZIP</span><input required inputMode="numeric" pattern="[0-9]{5}" maxLength={5} value={form.zip} onChange={(event) => change("zip", event.target.value)} /></label>
        <label className="field"><span>FICO score</span><input required type="number" min="300" max="850" value={form.creditScore} onChange={(event) => change("creditScore", event.target.value)} /></label>
        {form.program === "Conventional" && <NumberField label="Gross monthly income" value={form.monthlyIncome} min={1} change={(value) => change("monthlyIncome", value)} />}
        <label className="field"><span>Occupancy</span><select disabled={dscr} value={dscr ? "Investment property" : form.occupancy}
          onChange={(event) => change("occupancy", event.target.value)}>{occupancies.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="field"><span>Property type</span><select value={form.propertyType} onChange={(event) => change("propertyType", event.target.value)}>{propertyTypes.map((value) => <option key={value}>{value}</option>)}</select></label>
      </div>
      {form.purpose === "Purchase" && !dscr && <label className="demo-confirm"><input type="checkbox" checked={form.firstTimeBuyer} onChange={(event) => change("firstTimeBuyer", event.target.checked)} /> First-time homebuyer</label>}
      {(dscr || bank) && <fieldset className="pricing-program-fields">
        <legend>{dscr ? "Rental income and expenses" : "Bank statement income and expenses"}</legend>
        <p className="muted">Sample inputs and quotes for the demo.</p>
        {bank && <label className="demo-confirm"><input type="checkbox" checked={form.selfEmployed} required
          onChange={(event) => change("selfEmployed", event.target.checked)} /> Self-employed borrower</label>}
        <div className="form-grid">
          {dscr && <NumberField label="Gross monthly rent" min={0.01} value={form.monthlyRent} change={(value) => change("monthlyRent", value)} />}
          {bank && <>
            <label className="field"><span>Bank statement type</span><select value={form.statementType} onChange={(event) => change("statementType", event.target.value)}>
              <option>Personal</option><option>Business</option>
            </select></label>
            <label className="field"><span>Statement history</span><select value={form.statementMonths} onChange={(event) => change("statementMonths", event.target.value)}>
              <option value="12">12 months</option><option value="24">24 months</option>
            </select></label>
            <NumberField label="Average monthly eligible deposits" min={0.01} value={form.averageMonthlyDeposits} change={(value) => change("averageMonthlyDeposits", value)} />
            {form.statementType === "Business" && <>
              <NumberField label="Business expense factor (%)" max={99.99} value={form.expensePercent} change={(value) => change("expensePercent", value)} />
              <NumberField label="Business ownership (%)" min={0.01} max={100} value={form.ownershipPercent} change={(value) => change("ownershipPercent", value)} />
            </>}
            <NumberField label="Other monthly debts" value={form.monthlyDebts} change={(value) => change("monthlyDebts", value)} />
          </>}
          <NumberField label="Monthly property taxes" value={form.monthlyTaxes} change={(value) => change("monthlyTaxes", value)} />
          <NumberField label="Monthly property insurance" value={form.monthlyInsurance} change={(value) => change("monthlyInsurance", value)} />
          <NumberField label="Monthly HOA dues" value={form.monthlyHoa} change={(value) => change("monthlyHoa", value)} />
          <NumberField label="Months of reserves" max={120} step={1} value={form.reservesMonths} change={(value) => change("reservesMonths", value)} />
        </div>
      </fieldset>}
      <div className="pricing-actions"><Button size="sm" variant="outline" disabled={busy} onClick={loadSample}>Load sample scenario</Button>
        <Button type="submit" disabled={busy}><Calculator /> {pricing ? "Pricing…" : "Run pricing"}</Button></div>
    </form>
    {saved && selected && <section className="quote-saved">
      <div className="section-heading"><h3><BadgeCheck size={17} /> Saved quote</h3>
        <Button size="sm" variant="outline" aria-expanded={preview} onClick={() => setPreview(!preview)}><Eye /> {preview ? "Hide preview" : "Preview borrower quote"}</Button>
      </div>
      <p>{selected.product} · {percentage(selected.rate)} · {cash(selected.principalAndInterest)} monthly P&amp;I</p>
      <p className="muted timestamp">{saved.mode === "mock" ? "Sample pricing" : "UWM stage"} · Priced {dateTime(saved.quotedAt)} ET</p>
      {(savedAssumptionsChanged || applicationChanged(saved)) && <p className="quote-disclaimer">The application or pricing inputs have changed since this quote. Review the assumptions and reprice as needed.</p>}
      {preview && <div className="quote-preview">
        <p className="eyebrow">{saved.mode === "mock" ? "SAMPLE BORROWER QUOTE" : "UWM STAGE QUOTE"}</p>
        <strong>{selected.product}</strong>
        <p className="muted">{cash(saved.scenario.loanAmount)} loan · {saved.scenario.purpose}</p>
        <Terms offer={selected} />
        <SampleMetrics scenario={saved.scenario} offer={selected} />
        {saved.notices.map((notice, index) => <p key={index} className="quote-disclaimer">{notice}</p>)}
        {saved.mode === "mock" && (application?.submittedAt ? <div className="pricing-actions">
          <Button size="sm" disabled={busy || alreadyShared} onClick={() => void save({ type: "publishQuote", loanId: loan.id, runId: saved.id, offerId: selected.id })}>
            {alreadyShared ? "Published to borrower" : published ? "Replace shared sample quote" : "Publish sample quote"}
          </Button>
        </div> : <p className="muted">The borrower can see a shared quote after submitting their 1003.</p>)}
      </div>}
    </section>}
    <UwmRateLock loanId={loan.id} submissions={state.submissions.filter((item) => item.loanId === loan.id)}
      rate={state.mockUwmRates.find((item) => item.loanId === loan.id)} saved={saved} offer={selected} busy={busy} save={save} />
    {published && <section className="quote-saved" aria-label="Shared borrower quote">
      <div className="section-heading"><h3>Shared with borrower</h3>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void save({ type: "withdrawQuote", loanId: loan.id, publishedAt: published.publishedAt })}>Remove shared quote</Button></div>
      <p>{published.product} · {percentage(published.rate)} · {cash(published.principalAndInterest)} monthly P&amp;I</p>
      <p className="muted timestamp">Sample quote · Shared {dateTime(published.publishedAt)} ET</p>
      {(publishedAssumptionsChanged || applicationChanged(publishedRun)) && <p className="quote-disclaimer">The borrower still sees these terms. Pricing assumptions or the application have changed.</p>}
    </section>}
    {sharedHistory.length > 0 && <details className="quote-saved"><summary>Previously shared quotes</summary>
      <ul className="loan-task-list">{sharedHistory.map((quote) => <li key={`${quote.runId}:${quote.offerId}:${quote.publishedAt}`}>
        {quote.product} · {percentage(quote.rate)} · {cash(quote.principalAndInterest)} monthly P&amp;I · Shared {dateTime(quote.publishedAt)} ET · {quote.outcome} {dateTime(quote.endedAt)} ET
      </li>)}</ul>
    </details>}
    {comparison.length > 1 && <details className="quote-saved">
      <summary>Compare saved scenarios ({comparison.length})</summary>
      <div className="table-scroll"><table className="data-table">
        <thead><tr><th>Program</th><th>Scenario inputs</th><th>Saved terms</th><th>Choice</th></tr></thead>
        <tbody>{comparison.map((run) => {
          const offer = run.offers.find((item) => item.id === run.selectedId);
          if (!offer) return null;
          const scenario = run.scenario;
          return <tr key={run.id}>
            <td>{scenario.nonAgency?.program ?? "Conventional"}<small>{run.mode === "mock" ? "Sample pricing" : "UWM stage"} · {dateTime(run.quotedAt)} ET</small></td>
            <td>{scenario.purpose} · {scenario.occupancy}<small>{cash(scenario.loanAmount)} loan · {cash(scenario.propertyValue)} value · ZIP {scenario.zip}</small>
              <small>Credit score {scenario.creditScore} · {scenario.propertyType}</small>
              {scenario.nonAgency && <small>{scenario.nonAgency.program === "DSCR" ? `${cash(scenario.nonAgency.monthlyRent)} monthly rent` :
                `${scenario.nonAgency.statementMonths} months · ${scenario.nonAgency.source.type.toLowerCase()} · ${cash(scenario.nonAgency.averageMonthlyDeposits)} monthly deposits`}</small>}
            </td>
            <td>{offer.product}<Terms offer={offer} /><SampleMetrics scenario={scenario} offer={offer} /></td>
            <td>{saved?.id === run.id ? "Chosen quote" : <Button size="sm" variant="outline" disabled={busy}
              onClick={() => void save({ type: "selectOffer", loanId: loan.id, runId: run.id, offerId: offer.id })}>Choose quote</Button>}</td>
          </tr>;
        })}</tbody>
      </table></div>
    </details>}
    {current && <section className="pricing-results" aria-label="Pricing results">
      <div className="section-heading"><h3>Pricing options</h3><span className="pill">{current.offers.length} returned</span></div>
      <p className="muted timestamp">{cash(current.scenario.loanAmount)} · {current.scenario.purpose} · {dateTime(current.quotedAt)} ET</p>
      {current.reference && <p className="muted timestamp">EQ scenario {current.reference}</p>}
      {current.offers.length === 0 && <p className="empty-inline">UWM returned no displayable pricing for this scenario.</p>}
      {current.offers.map((offer) => {
        const isSaved = saved?.id === current.id && saved.selectedId === offer.id;
        return <article className="pricing-option" key={offer.id}>
          <div className="section-heading"><h3>{offer.product}</h3><Button size="sm" variant="outline" disabled={busy || isSaved}
            onClick={() => void save({ type: "selectOffer", loanId: loan.id, runId: current.id, offerId: offer.id })}>{isSaved ? "Saved" : "Save quote"}</Button></div>
          <Terms offer={offer} />
          <SampleMetrics scenario={current.scenario} offer={offer} />
        </article>;
      })}
      <details className="pricing-disclosures"><summary>Pricing disclosures</summary>
        {current.notices.map((notice, index) => <p key={index} className="quote-disclaimer">{notice}</p>)}</details>
    </section>}
  </div>;
}
