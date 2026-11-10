"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { BadgeCheck, Calculator, Eye, FlaskConical } from "lucide-react";
import { submittedRequestedLoanAmount, type ApplicationDraft } from "@/lib/application-model";
import type { WorkspaceMutationSuccess } from "@/lib/commands";
import { dateLabel } from "@/lib/client-retention";
import { mockRunMatchesApplication, submittedApplicationRevision } from "@/lib/credit-aus-model";
import { repriceIncomeMessage, type ReviewedIncomeSource } from "@/lib/income-review-model";
import { offerDisplayName } from "@/lib/manual-pricing-model";
import type { Loan, Workspace } from "@/lib/model";
import { latestSelectedPricingRun, mockUwmQuoteAmountIssue, nonAgencyManualHandoffMessage, pricingPrograms, pricingInputsMatch, sampleNonAgencyMetrics, supportsManualOffers, type PricingOffer, type PricingProgram, type PricingRun, type PricingScenario,
  type PublishedQuote } from "@/lib/pricing-model";
import { dateTime, money, requestedMoney } from "@/lib/utils";
import { Button } from "./ui/button";
import { UwmRateLock } from "./uwm-rate-lock";
import { feeKeys, feeLabels, quoteOption, sampleFeeLabel, type QuotePresentation } from "@/lib/quote-worksheet";
import { sharedQuoteExpired, sharedQuoteExpiry } from "@/lib/shared-quote-model";
import { FeeWorksheetEditor, SampleQuotePresentation } from "./quote-worksheet";
import { LoanStageEditNotice, useLoanStageEdit } from "./loan-stage-edits";
import { ManualOfferForm } from "./manual-pricing";

const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const cash = (amount: number | null) => amount === null ? "—" : dollars.format(amount);
const percentage = (value: number | null) => value === null ? "—" : `${value.toFixed(3)}%`;
const occupancies = ["Primary residence", "Second home", "Investment property"];
const propertyTypes = ["Single family", "Attached condominium"];

function focusComparison(element: HTMLElement | null) {
  element?.focus({ preventScroll: true });
  element?.scrollIntoView({ block: "start" });
}

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

function scenarioFromForm(form: ReturnType<typeof defaults>): PricingScenario {
  const dscr = form.program === "DSCR";
  const propertyExpenses = {
    monthlyTaxes: Number(form.monthlyTaxes), monthlyInsurance: Number(form.monthlyInsurance), monthlyHoa: Number(form.monthlyHoa),
    reservesMonths: Number(form.reservesMonths), refinanceType: form.purpose === "Refinance" ? form.refinanceType : null,
  };
  return {
    purpose: form.purpose, loanAmount: Number(form.loanAmount), propertyValue: Number(form.propertyValue),
    purchasePrice: form.purpose === "Purchase" && form.purchasePrice ? Number(form.purchasePrice) : null,
    zip: form.zip, creditScore: Number(form.creditScore), propertyType: form.propertyType,
    occupancy: dscr ? "Investment property" : form.occupancy,
    firstTimeBuyer: !dscr && form.purpose === "Purchase" && form.firstTimeBuyer,
    monthlyIncome: form.program === "Conventional" ? Number(form.monthlyIncome) : undefined,
    nonAgency: dscr ? { ...propertyExpenses, program: "DSCR", monthlyRent: Number(form.monthlyRent) } : form.program === "Bank statement" ? {
      ...propertyExpenses, program: "Bank statement", selfEmployed: true, statementMonths: form.statementMonths === "24" ? 24 : 12,
      averageMonthlyDeposits: Number(form.averageMonthlyDeposits), monthlyDebts: Number(form.monthlyDebts),
      source: form.statementType === "Business" ? { type: "Business", expensePercent: Number(form.expensePercent),
        ownershipPercent: Number(form.ownershipPercent) } : { type: "Personal" },
    } : undefined,
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
    {(offer.apr !== null || offer.manual) && <div><dt>APR</dt><dd>{offer.apr === null ? "Not provided" : percentage(offer.apr)}</dd></div>}
    {offer.pricingAmount !== null && <div><dt>{offer.pricingLabel}</dt><dd>
      {cash(offer.pricingLabel === "Lender credit" ? Math.abs(offer.pricingAmount) : offer.pricingAmount)}
      {offer.pricingPercent !== null && <small>{percentage(offer.pricingLabel === "Lender credit" ? Math.abs(offer.pricingPercent) : offer.pricingPercent)}</small>}
    </dd></div>}
    {offer.manual && offer.pricingAmount === null && <div><dt>Points or credit</dt><dd>Not provided</dd></div>}
  </dl>;
}

function SharedQuoteChanges({ shared, proposed }: { shared: QuotePresentation; proposed: QuotePresentation | null }) {
  const options = proposed ? [proposed.primary, ...proposed.alternatives] : [];
  return [shared.primary, ...shared.alternatives].map((before) => {
    const after = options.find((option) => before.runId === option.runId && before.offerId === option.offerId);
    if (!after) return null;
    const fees = feeKeys.map((key) => ({ key, shared: sampleFeeLabel(before.estimate?.inputs, key), proposed: sampleFeeLabel(after.estimate?.inputs, key) }))
      .filter((line) => line.shared !== line.proposed);
    if (!fees.length) return null;
    return <div key={`${before.runId}/${before.offerId}`}>
      <strong>{before.product} at {percentage(before.rate)}</strong>
      <ul className="loan-task-list">{fees.map(({ key, shared, proposed }) => <li key={key}>
        {feeLabels[key]} · Shared {shared} · Proposed {proposed}
      </li>)}</ul>
    </div>;
  });
}

export function LoanPricing({ loan, state, busy, save, brokerageId, useMockScore, lenderHandoff, sourceQuote, reviewedIncome, openIncome, openApplication, reviewSharedQuote, focusFees, canRehearseUnsupported }: {
  loan: Loan; state: Workspace; busy: boolean; save: (input: unknown, after?: (result: WorkspaceMutationSuccess) => void) => Promise<void>;
  useMockScore?: boolean;
  reviewSharedQuote?: boolean;
  focusFees?: string;
  canRehearseUnsupported: boolean;
  brokerageId: string;
  sourceQuote?: Pick<PublishedQuote, "runId" | "offerId">;
  reviewedIncome?: ReviewedIncomeSource;
  openIncome?: (worksheetRevision?: number) => void;
  openApplication: () => void;
  lenderHandoff?: { label: string; blocker: string | null; checkQuoteAmount: boolean; proceed: (quote: { runId: string; offerId: string }) => void };
}) {
  const feeEdits = useLoanStageEdit("fees", loan.id, loan.stage, brokerageId, save);
  const runs = state.pricingRuns.filter((item) => item.loanId === loan.id);
  const latest = runs[0];
  const [resultsRunId, setResultsRunId] = useState<string>();
  const current = runs.find(({ id }) => id === resultsRunId) ?? latest;
  const saved = latestSelectedPricingRun(runs, loan.id);
  const selected = saved?.offers.find((offer) => offer.id === saved.selectedId);
  const sourceRun = runs.find((run) => run.id === sourceQuote?.runId);
  const sourceOffer = sourceRun?.offers.find((offer) => offer.id === sourceQuote?.offerId);
  const sourceIsSaved = sourceRun && sourceOffer && saved?.id === sourceRun.id && selected?.id === sourceOffer.id;
  const application = state.applications.find((item) => item.loanId === loan.id);
  const draft = application?.draft;
  const credit = state.mockCreditAusRuns.find((run) => run.loanId === loan.id && run.service === "Credit");
  const mockScore = credit?.result.status === "Report ready" && mockRunMatchesApplication(credit, submittedApplicationRevision(application))
    ? String(credit.result.score) : "";
  const published = state.publishedQuotes.find((quote) => quote.loanId === loan.id);
  const expiryRange = sharedQuoteExpiry();
  const expired = sharedQuoteExpired(published?.expiresOn);
  const [expiresOn, setExpiresOn] = useState(published?.expiresOn && !expired ? published.expiresOn : expiryRange.suggested);
  const reviewKey = `${published?.publishedAt}/${published?.reviewRevision}`;
  const [review, setReview] = useState({ key: "", note: "" });
  const reviewNote = review.key === reviewKey ? review.note.trim() : "";
  const publishedRun = runs.find((run) => run.id === published?.runId);
  const sharedHistory = state.sharedQuoteHistory.filter((quote) => quote.loanId === loan.id);
  const initialRun = sourceRun ?? current;
  const [form, setForm] = useState(() => {
    const initial = defaults(loan, draft, reviewedIncome && initialRun?.applicationRevision !== reviewedIncome.applicationRevision ? undefined : initialRun);
    if (reviewedIncome) {
      initial.program = "Conventional";
      initial.monthlyIncome = String(reviewedIncome.amount / 100);
    }
    return { ...initial, creditScore: useMockScore && mockScore ? mockScore : initial.creditScore || mockScore };
  });
  const [formRevision, setFormRevision] = useState(reviewedIncome?.applicationRevision ?? (initialRun ? initialRun.applicationRevision : application?.revision ?? null));
  const [incomeRevision, setIncomeRevision] = useState(reviewedIncome?.revision ?? initialRun?.incomeReviewRevision ?? undefined);
  const [preview, setPreview] = useState(Boolean(sourceIsSaved || reviewSharedQuote || focusFees));
  const [pricing, setPricing] = useState(false);
  const amountInput = useRef<HTMLInputElement>(null);
  const savedQuoteSection = useRef<HTMLElement>(null);
  const lenderComparison = useRef<HTMLElement>(null);
  const focusRun = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (current?.id && focusRun.current === current.id) {
      focusRun.current = undefined;
      focusComparison(lenderComparison.current);
    }
  }, [current?.id]);
  const [alternativeKeys, setAlternativeKeys] = useState(() =>
    published?.presentation?.alternatives.map((item) => `${item.runId}/${item.offerId}`) ?? []);
  const change = (name: keyof typeof form, value: string | boolean) => setForm((last) => ({ ...last, [name]: value }));
  const dscr = form.program === "DSCR";
  const bank = form.program === "Bank statement";
  const isCurrent = (run: PricingRun | undefined) => !!run && pricingInputsMatch(run, application);
  const savedManualExpired = !!selected?.manual && selected.manual.expiresOn < expiryRange.today;
  const savedNeedsReprice = !!saved && (!isCurrent(saved) || savedManualExpired);
  const requestedAmount = submittedRequestedLoanAmount(application);
  const rateAmountIssue = mockUwmQuoteAmountIssue(saved, application, "rate");
  const quoteAmountIssue = lenderHandoff?.checkQuoteAmount ? mockUwmQuoteAmountIssue(saved, application) : null;
  const manualOfferNeeded = !!saved?.scenario.nonAgency && !selected?.manual;
  const handoffAction = lenderHandoff && (saved?.mode === "mock" || selected?.manual) && selected && saved && !savedNeedsReprice && !manualOfferNeeded &&
    (!quoteAmountIssue || lenderHandoff.blocker) &&
    (lenderHandoff.blocker || (application?.submittedAt && application.reviewedAt)) && <>
      {lenderHandoff.blocker && <p className="quote-disclaimer">{lenderHandoff.blocker}</p>}
      <Button size="sm" variant={lenderHandoff.blocker ? "outline" : "default"} disabled={busy}
        onClick={() => lenderHandoff.proceed({ runId: saved.id, offerId: selected.id })}>{lenderHandoff.label}</Button>
    </>;
  const publishedNeedsReprice = !!published && (!application?.submittedAt || !isCurrent(publishedRun) ||
    !!published.presentation?.alternatives.some((item) => !isCurrent(runs.find((run) => run.id === item.runId))));
  const formOutdated = formRevision !== (application?.revision ?? null);
  const canUse1003Amount = !formOutdated && requestedAmount !== null && Number(form.loanAmount) !== requestedAmount;
  const useIncomeRevision = form.program === "Conventional" ? incomeRevision : undefined;
  const incomeOutdated = useIncomeRevision !== undefined && runs.some((run) => run.incomeReviewRevision === useIncomeRevision && run.incomeReviewCurrent === false);
  const scenario = scenarioFromForm(form);
  const savedAssumptionsChanged = !!saved && (
    JSON.stringify(scenario) !== JSON.stringify(scenarioFromForm(defaults(loan, draft, saved))) || (bank && !form.selfEmployed)
  );
  const publishedAssumptionsChanged = !!publishedRun && !!latest && latest.quotedAt > publishedRun.quotedAt &&
    JSON.stringify(latest.scenario) !== JSON.stringify(publishedRun.scenario);
  const comparison = runs.filter((run) => run.selectedId);
  const otherCoverageChecks = runs.filter((run) => run.outcome === "unsupported" && run.id !== current?.id && isCurrent(run)).slice(0, 2);
  function option(run: PricingRun, offer: PricingOffer) {
    const worksheet = state.feeWorksheets.find((item) => item.runId === run.id && item.offerId === offer.id);
    return { key: `${run.id}/${offer.id}`, run, offer, worksheet, view: quoteOption(run, offer, worksheet) };
  }
  const primary = saved?.mode === "mock" && selected ? option(saved, selected) : undefined;
  const comparable = primary ? runs.flatMap((run) => run.mode === "mock" && isCurrent(run) && run.scenario.purpose === primary.run.scenario.purpose
    ? run.offers.filter((offer) => (run.id === primary.run.id && offer.id !== primary.offer.id) ||
      (run.id !== primary.run.id && offer.id === run.selectedId)).map((offer) => option(run, offer)) : []) : [];
  const alternatives = comparable.filter((item) => alternativeKeys.includes(item.key)).slice(0, 2);
  const maxShareOn = [expiryRange.latest, ...[primary, ...alternatives].flatMap((item) => item?.offer.manual?.expiresOn ? [item.offer.manual.expiresOn] : [])].sort()[0];
  const expiryValid = expiresOn >= expiryRange.today && expiresOn <= maxShareOn;
  const presentation = primary ? { primary: primary.view, alternatives: alternatives.map((item) => item.view) } : null;
  const alreadyShared = published?.runId === saved?.id && published?.offerId === selected?.id &&
    published?.expiresOn === expiresOn && JSON.stringify(published?.presentation ?? null) === JSON.stringify(presentation);

  async function price(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (formOutdated || incomeOutdated || (bank && !form.selfEmployed)) return;
    const rehearse = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "unsupported";
    setPricing(true);
    setPreview(false);
    try {
      await save({ type: "runPricing", loanId: loan.id, scenario, applicationRevision: formRevision, incomeReviewRevision: useIncomeRevision,
        simulateUnsupportedEq: rehearse ? true : undefined }, ({ state: updated }) => {
        const result = updated.pricingRuns.find(({ loanId }) => loanId === loan.id);
        if (result?.outcome === "unsupported") focusRun.current = result.id;
        setResultsRunId(undefined);
      });
    }
    finally { setPricing(false); }
  }

  function openManualOffers(run: PricingRun) {
    if (current?.id === run.id) focusComparison(lenderComparison.current);
    else {
      focusRun.current = run.id;
      setResultsRunId(run.id);
    }
  }

  function loadSample() {
    setIncomeRevision(undefined);
    setFormRevision(application?.revision ?? null);
    setForm({
      ...defaults(loan, draft), loanAmount: "360000", propertyValue: "450000", purchasePrice: form.purpose === "Purchase" ? "450000" : "",
      program: form.program, purpose: form.purpose, zip: "48009", creditScore: "760", monthlyIncome: "9500",
      monthlyTaxes: "450", monthlyInsurance: "125", monthlyHoa: "0", reservesMonths: "6", monthlyRent: "3600",
      selfEmployed: true, statementType: "Business", averageMonthlyDeposits: "19000", expensePercent: "50", ownershipPercent: "100", monthlyDebts: "850",
    });
  }

  function loadCurrentApplication() {
    void save({ type: "refreshWorkspace" }, ({ state: refreshed }) => {
      const latest = refreshed.applications.find((item) => item.loanId === loan.id);
      const inputs = defaults(refreshed.loans.find((item) => item.id === loan.id) ?? loan, latest?.draft);
      const { purpose, loanAmount, propertyValue, purchasePrice, zip, monthlyIncome, occupancy } = inputs;
      setIncomeRevision(undefined);
      setForm((previous) => ({ ...previous, purpose, loanAmount, propertyValue, purchasePrice, zip, monthlyIncome, occupancy }));
      setFormRevision(latest?.revision ?? null);
    });
  }

  function use1003Amount() {
    if (!canUse1003Amount) return;
    change("loanAmount", String(requestedAmount));
    amountInput.current?.focus();
  }

  return <div className="pricing-panel" id="pricing-workbench" tabIndex={-1}>
    <header className="pricing-heading">
      <div><h3><Calculator size={18} /> Loan pricing</h3><p>Compare conventional pricing and sample Non-QM estimates.</p></div>
      <span className="pill"><FlaskConical size={13} /> {current?.mode === "stage" ? "UWM stage" : "Mock pricing"}</span>
    </header>
    <LoanStageEditNotice area="fees" control={feeEdits} busy={busy} />
    {published?.reviewReason && <section className="quote-saved" aria-label="Shared quote review">
      <div className="section-heading"><h3>Review shared sample quote</h3><span className="pill">Needs review</span></div>
      <p>{published.reviewReason}. {publishedNeedsReprice ? "Share a new quote from the current loan inputs to restore borrower access."
        : expired ? "The original quote has expired." : "The borrower still sees the original shared version."}</p>
      <dl className="quote-terms">
        <div><dt>Shared rate and monthly P&amp;I</dt><dd>{percentage(published.rate)} · {cash(published.principalAndInterest)}</dd></div>
        {selected && <div><dt>Saved rate and monthly P&amp;I</dt><dd>{percentage(selected.rate)} · {cash(selected.principalAndInterest)}</dd></div>}
      </dl>
      {published.presentation && <SharedQuoteChanges shared={published.presentation} proposed={presentation} />}
      <label className="field"><span>Internal quote review note</span><textarea rows={2} maxLength={500} value={review.key === reviewKey ? review.note : ""}
        onChange={(event) => setReview({ key: reviewKey, note: event.target.value })} /></label>
      <div className="pricing-actions">
        <Button size="sm" variant="outline" disabled={busy || !reviewNote} onClick={() => void save({
          type: "keepSharedQuote", loanId: loan.id, publishedAt: published.publishedAt, reviewRevision: published.reviewRevision, reviewNote,
        })}>Keep shared version</Button>
        {saved && selected && <Button size="sm" variant="outline" onClick={() => {
          setPreview(true);
          savedQuoteSection.current?.focus();
        }}>Open saved quote preview</Button>}
      </div>
    </section>}
    {sourceQuote && <section className="quote-saved" aria-label="Pricing option from loan scenarios">
      <h3>Pricing option from loan scenarios</h3>
      {sourceRun && sourceOffer ? <>
        <p>{sourceOffer.product} · {cash(sourceRun.scenario.loanAmount)} · {sourceRun.scenario.purpose}</p>
        <p className="muted timestamp">{sourceRun.mode === "mock" ? "Sample pricing" : "UWM stage"} · Priced {dateTime(sourceRun.quotedAt)} ET</p>
        <Terms offer={sourceOffer} />
        {!isCurrent(sourceRun) ? <p className="quote-disclaimer">{sourceRun.incomeReviewCurrent === false ? repriceIncomeMessage : "Reprice from the current 1003 before saving this quote."}</p> :
          <Button size="sm" variant="outline" disabled={busy || sourceIsSaved || feeEdits.blocked}
            onClick={() => void feeEdits.save({ type: "selectOffer", loanId: loan.id, runId: sourceRun.id, offerId: sourceOffer.id }, () => setPreview(true))}>
            {sourceIsSaved ? "Saved to this loan" : "Save this quote"}
          </Button>}
      </> : <p className="quote-disclaimer">This pricing option is no longer in the current results. Run pricing again to continue.</p>}
    </section>}
    <form className="pricing-form" onSubmit={(event) => void price(event)}>
      {quoteAmountIssue && <div className="document-item">
        <p>{quoteAmountIssue}</p>
        {canUse1003Amount &&
          <Button type="button" size="sm" variant="outline" disabled={busy}
            onClick={use1003Amount}>Use 1003 amount in pricing</Button>}
      </div>}
      {requestedAmount !== null && Math.round(requestedAmount) !== loan.amount && <p className="quote-disclaimer">
        Recorded amount {money(loan.amount)} · 1003 request {requestedMoney(requestedAmount)}. The loan amount entered below is used for the quote.
      </p>}
      <div className="form-grid">
        <label className="field"><span>Loan program</span><select value={form.program} onChange={(event) => change("program", event.target.value)}>
          {pricingPrograms.map((program) => <option key={program}>{program}</option>)}
        </select></label>
        <label className="field"><span>Loan purpose</span><select value={form.purpose} onChange={(event) => change("purpose", event.target.value)}><option>Purchase</option><option>Refinance</option></select></label>
        {form.purpose === "Refinance" && (dscr || bank) && <label className="field"><span>Refinance type</span><select value={form.refinanceType} onChange={(event) => change("refinanceType", event.target.value)}>
          <option>Rate and term</option><option>Cash out</option>
        </select></label>}
        <label className="field"><span>Loan amount</span><input ref={amountInput} required type="number" min="1" max="25000000" step="0.01" value={form.loanAmount} onChange={(event) => change("loanAmount", event.target.value)} /></label>
        <label className="field"><span>Estimated property value</span><input required type="number" min="1" max="25000000" step="0.01" value={form.propertyValue} onChange={(event) => change("propertyValue", event.target.value)} /></label>
        {form.purpose === "Purchase" && <label className="field"><span>Purchase price (optional)</span><input type="number" min="1" max="25000000" step="0.01" value={form.purchasePrice} onChange={(event) => change("purchasePrice", event.target.value)} /></label>}
        <label className="field"><span>Property ZIP</span><input required inputMode="numeric" pattern="[0-9]{5}" maxLength={5} value={form.zip} onChange={(event) => change("zip", event.target.value)} /></label>
        <label className="field"><span>FICO score</span><input required type="number" min="300" max="850" value={form.creditScore} onChange={(event) => change("creditScore", event.target.value)} /></label>
        {form.program === "Conventional" && <NumberField label="Gross monthly income" value={form.monthlyIncome} min={1} change={(value) => {
          setIncomeRevision(undefined);
          change("monthlyIncome", value);
        }} />}
        <label className="field"><span>Occupancy</span><select disabled={dscr} value={dscr ? "Investment property" : form.occupancy}
          onChange={(event) => change("occupancy", event.target.value)}>{occupancies.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="field"><span>Property type</span><select value={form.propertyType} onChange={(event) => change("propertyType", event.target.value)}>{propertyTypes.map((value) => <option key={value}>{value}</option>)}</select></label>
      </div>
      {form.program === "Conventional" && openIncome && <div className="pricing-actions">
        <p className={incomeOutdated ? "quote-disclaimer" : "muted"}>{incomeOutdated ? repriceIncomeMessage :
          useIncomeRevision ? `Approved income worksheet v${useIncomeRevision} · ${cash(Number(form.monthlyIncome))} monthly` : "Monthly income uses a manual or 1003-reported amount."}</p>
        <Button size="sm" variant="outline" type="button" disabled={busy} onClick={() => openIncome()}>Open income worksheet</Button>
      </div>}
      {mockScore && <div className="pricing-actions">
        {form.creditScore === mockScore ? <span className="muted">Matches current mock credit report · {mockScore}</span> :
          <Button size="sm" variant="outline" disabled={busy} onClick={() => change("creditScore", mockScore)}>Use mock credit score {mockScore}</Button>}
      </div>}
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
      {formOutdated && <p className="quote-disclaimer">Load the current 1003 inputs before running pricing again.</p>}
      <div className="pricing-actions">
        <Button size="sm" variant="outline" disabled={busy} onClick={loadCurrentApplication}>{application ? "Load current 1003 inputs" : "Reload loan inputs"}</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={loadSample}>Load sample scenario</Button>
        <Button type="submit" disabled={busy || formOutdated || incomeOutdated}><Calculator /> {pricing ? "Pricing…" : "Run pricing"}</Button>
        {canRehearseUnsupported && (dscr || bank) && <Button type="submit" value="unsupported" size="sm" variant="outline"
          disabled={busy || formOutdated || incomeOutdated || (bank && !form.selfEmployed)}>Rehearse unsupported EQ</Button>}
        {current && supportsManualOffers(current) && <Button type="button" variant="outline"
          onClick={() => openManualOffers(current)}>Compare lender offers</Button>}</div>
    </form>
    {otherCoverageChecks.length > 0 && <details className="quote-saved">
      <summary>Recent EQ coverage checks</summary>
      <div className="record-form">
        {otherCoverageChecks.map((run) => <div key={run.id}>
          <Button size="sm" variant="outline" onClick={() => openManualOffers(run)}>
            Open {run.scenario.nonAgency?.program} coverage check</Button>
          <p className="muted">{cash(run.scenario.loanAmount)} loan · {dateTime(run.quotedAt)} ET</p>
        </div>)}
      </div>
    </details>}
    {saved && selected && <section className="quote-saved" ref={savedQuoteSection} tabIndex={-1} aria-label="Saved quote">
      <div className="section-heading"><h3><BadgeCheck size={17} /> Saved quote</h3>
        <Button size="sm" variant="outline" aria-expanded={preview} onClick={() => setPreview(!preview)}><Eye /> {preview ? "Hide preview" : "Preview borrower quote"}</Button>
      </div>
      <p>{offerDisplayName(selected)} · {requestedMoney(saved.scenario.loanAmount)} loan · {percentage(selected.rate)} · {cash(selected.principalAndInterest)} monthly P&amp;I</p>
      {manualOfferNeeded && !savedNeedsReprice && <div className="document-item">
        <p>{nonAgencyManualHandoffMessage}</p>
        <Button size="sm" variant="outline" onClick={() => openManualOffers(saved)}>Open manual offers for this scenario</Button>
      </div>}
      <p className="muted timestamp">{selected.manual ? `Manual sample · Quote ${selected.manual.reference} · Through ${dateLabel(selected.manual.expiresOn)}` :
        `${saved.mode === "mock" ? "Sample pricing" : "UWM stage"} · Priced ${dateTime(saved.quotedAt)} ET`}</p>
      {saved.incomeReviewRevision && <p className="muted">Income worksheet v{saved.incomeReviewRevision} · {cash(saved.scenario.monthlyIncome ?? null)} monthly</p>}
      {saved.incomeReviewRevision && openIncome && <div><Button size="sm" variant="outline" type="button" disabled={busy}
        onClick={() => openIncome(saved.incomeReviewRevision ?? undefined)}>View quote worksheet v{saved.incomeReviewRevision}</Button></div>}
      {(saved.id !== current?.id || selected.manual) && handoffAction}
      {savedNeedsReprice ? <p className="quote-disclaimer">{savedManualExpired ? "This manual offer expired. Enter and choose a current offer before sharing or exporting." : application?.correctionNote
        ? "Wait for the borrower to submit the corrected 1003 before sharing or locking a quote."
        : saved.incomeReviewCurrent === false ? repriceIncomeMessage : "This quote needs to be repriced from the current 1003 before sharing or locking."}</p>
        : savedAssumptionsChanged && <p className="quote-disclaimer">The current pricing form differs from this saved quote. Review the assumptions before sharing.</p>}
      {preview && <div className="quote-preview">
        <p className="eyebrow">{selected.manual ? "MANUAL LENDER SAMPLE" : saved.mode === "mock" ? "SAMPLE BORROWER QUOTE" : "UWM STAGE QUOTE"}</p>
        <strong>{offerDisplayName(selected)}</strong>
        <p className="muted">{cash(saved.scenario.loanAmount)} loan · {saved.scenario.purpose}</p>
        {primary && presentation ? <>
          <FeeWorksheetEditor key={`${primary.key}:${primary.worksheet?.revision ?? 0}`}
            run={primary.run} offer={primary.offer} saved={primary.worksheet} busy={busy} save={feeEdits.save} stageBlocked={feeEdits.blocked}
            brokerageId={brokerageId} current={!savedNeedsReprice} focused={focusFees} />
          {comparable.length > 0 && <details className="document-form">
            <summary>Choose alternatives to compare</summary>
            <p className="muted">Include up to two alternatives for the same loan purpose. Save each worksheet to include its fees.</p>
            <div className="record-form">
              {comparable.map((item) => {
                const chosen = alternatives.some((entry) => entry.key === item.key);
                return <label className="demo-confirm" key={item.key}><input type="checkbox" checked={chosen}
                  disabled={busy || (!chosen && alternatives.length >= 2)} onChange={(event) => {
                    const activeKeys = alternatives.map((entry) => entry.key);
                    setAlternativeKeys(event.target.checked ? [...activeKeys, item.key] : activeKeys.filter((key) => key !== item.key));
                  }} /> {offerDisplayName(item.offer)} · {percentage(item.offer.rate)} · {cash(item.run.scenario.loanAmount)}
                  {item.worksheet && " · Worksheet saved"}</label>;
              })}
            </div>
          </details>}
          {alternatives.map((item) => <FeeWorksheetEditor key={`${item.key}:${item.worksheet?.revision ?? 0}`}
            run={item.run} offer={item.offer} saved={item.worksheet} busy={busy} save={feeEdits.save} stageBlocked={feeEdits.blocked}
            brokerageId={brokerageId} current={isCurrent(item.run)} />)}
          <SampleQuotePresentation quote={presentation} />
          <SampleMetrics scenario={saved.scenario} offer={selected} />
        </> : <><Terms offer={selected} /><SampleMetrics scenario={saved.scenario} offer={selected} /></>}
        {saved.notices.map((notice, index) => <p key={index} className="quote-disclaimer">{notice}</p>)}
        {saved.mode === "mock" && (application?.submittedAt ? <div className="document-section">
          <label className="field"><span>Share through (Eastern)</span><input type="date" value={expiresOn} min={expiryRange.today}
            max={maxShareOn} disabled={busy} onChange={(event) => setExpiresOn(event.target.value)} /></label>
          {maxShareOn < expiryRange.latest && <p className="muted">This comparison can be shared through {dateLabel(maxShareOn)}, based on the earliest manual offer expiration.</p>}
          {published?.reviewReason && !reviewNote && <p className="muted">Record an internal quote review note before replacing the shared version.</p>}
          <Button size="sm" className="justify-self-start" disabled={busy || alreadyShared || savedNeedsReprice || !expiryValid || (!!published?.reviewReason && !reviewNote)} onClick={() => void save({
            type: "publishDatedQuote", loanId: loan.id, runId: saved.id, offerId: selected.id, feeRevision: primary?.worksheet?.revision ?? 0,
            alternatives: alternatives.map((item) => ({ runId: item.run.id, offerId: item.offer.id, feeRevision: item.worksheet?.revision ?? 0 })),
            expiresOn, previousPublishedAt: published?.publishedAt ?? null, reviewRevision: published?.reviewRevision ?? 0, reviewNote,
          })}>
            {alreadyShared ? "Published to borrower" : published ? "Replace shared sample quote" : presentation?.alternatives.length ? "Publish sample comparison" : "Publish sample quote"}
          </Button>
        </div> : <p className="muted">The borrower can see a shared quote after submitting their 1003.</p>)}
      </div>}
    </section>}
    <UwmRateLock loanId={loan.id} submissions={state.submissions.filter((item) => item.loanId === loan.id)}
      application={application} openApplication={openApplication}
      rate={state.mockUwmRates.find((item) => item.loanId === loan.id)} saved={saved} offer={selected} needsReprice={savedNeedsReprice}
      amountIssue={rateAmountIssue} use1003Amount={canUse1003Amount && !quoteAmountIssue ? use1003Amount : undefined} busy={busy} save={save} />
    {published && <section className="quote-saved" aria-label="Shared borrower quote">
      <div className="section-heading"><h3>Shared with borrower</h3>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void save({ type: "withdrawQuote", loanId: loan.id, publishedAt: published.publishedAt })}>Remove shared quote</Button></div>
      <p>{published.product} · {percentage(published.rate)} · {cash(published.principalAndInterest)} monthly P&amp;I</p>
      <p className="muted timestamp">Sample quote · Shared {dateTime(published.publishedAt)} ET</p>
      {published.expiresOn && <p className="muted">{expired ? "Expired" : "Available through"} {dateLabel(published.expiresOn)} Eastern</p>}
      {published.presentation && <details className="document-form"><summary>View exact shared quote</summary><SampleQuotePresentation quote={published.presentation} /></details>}
      {publishedNeedsReprice ? <p className="quote-disclaimer">Hidden from the borrower until you share a quote from the current 1003 and income inputs.</p>
        : !expired && publishedAssumptionsChanged && <p className="quote-disclaimer">The borrower still sees these terms. Review them against your latest pricing assumptions.</p>}
    </section>}
    {sharedHistory.length > 0 && <details className="quote-saved"><summary>Previously shared quotes</summary>
      <ul className="loan-task-list">{sharedHistory.map((quote, index) => <li key={`${quote.runId}:${quote.offerId}:${quote.publishedAt}:${index}`}>
        {quote.product} · {percentage(quote.rate)} · {cash(quote.principalAndInterest)} monthly P&amp;I · Shared {dateTime(quote.publishedAt)} ET · {quote.outcome} {dateTime(quote.endedAt)} ET
        {quote.expiresOn && ` · Available through ${dateLabel(quote.expiresOn)} Eastern`}
        {quote.presentation && <details className="document-form"><summary>View shared terms and fees</summary><SampleQuotePresentation quote={quote.presentation} /></details>}
      </li>)}</ul>
    </details>}
    {comparison.length > 1 && <details className="quote-saved">
      <summary>Compare saved scenarios ({comparison.length})</summary>
      <p className="muted quote-comparison-hint">Scroll horizontally to compare the saved terms.</p>
      <div className="table-scroll" role="region" aria-label="Saved pricing scenario comparison" tabIndex={0}><table className="data-table">
        <thead><tr><th>Program</th><th>Scenario inputs</th><th>Saved terms</th><th>Choice</th></tr></thead>
        <tbody>{comparison.map((run) => {
          const offer = run.offers.find((item) => item.id === run.selectedId);
          if (!offer) return null;
          const scenario = run.scenario;
          return <tr key={run.id}>
            <td>{scenario.nonAgency?.program ?? "Conventional"}<small>{offer.manual ? "Manual sample" : run.mode === "mock" ? "Sample pricing" : "UWM stage"} · {dateTime(run.quotedAt)} ET</small></td>
            <td>{scenario.purpose} · {scenario.occupancy}<small>{cash(scenario.loanAmount)} loan · {cash(scenario.propertyValue)} value · ZIP {scenario.zip}</small>
              <small>Credit score {scenario.creditScore} · {scenario.propertyType}</small>
              {scenario.nonAgency && <small>{scenario.nonAgency.program === "DSCR" ? `${cash(scenario.nonAgency.monthlyRent)} monthly rent` :
                `${scenario.nonAgency.statementMonths} months · ${scenario.nonAgency.source.type.toLowerCase()} · ${cash(scenario.nonAgency.averageMonthlyDeposits)} monthly deposits`}</small>}
            </td>
            <td>{offerDisplayName(offer)}<Terms offer={offer} /><SampleMetrics scenario={scenario} offer={offer} /></td>
            <td>{!isCurrent(run) || (offer.manual && offer.manual.expiresOn < expiryRange.today) ? "Needs repricing" : saved?.id === run.id ? "Chosen quote" : <Button size="sm" variant="outline" disabled={busy || feeEdits.blocked}
              onClick={() => void feeEdits.save({ type: "selectOffer", loanId: loan.id, runId: run.id, offerId: offer.id })}>Choose quote</Button>}</td>
          </tr>;
        })}</tbody>
      </table></div>
    </details>}
    {current && <section className="pricing-results" aria-label="Pricing results">
      <div className="section-heading"><h3>Pricing options</h3><span className="pill">
        {current.outcome === "unsupported" ? "EQ unsupported" : `${current.offers.filter(({ manual }) => !manual).length} returned`}</span></div>
      <p className="muted timestamp">{current.scenario.nonAgency?.program ?? "Conventional"} · {cash(current.scenario.loanAmount)} · {current.scenario.purpose} · {dateTime(current.quotedAt)} ET</p>
      {current.incomeReviewRevision && <p className="muted">Income worksheet v{current.incomeReviewRevision} · {cash(current.scenario.monthlyIncome ?? null)} monthly</p>}
      {current.id !== saved?.id && current.incomeReviewRevision && openIncome && <div><Button size="sm" variant="outline" type="button" disabled={busy}
        onClick={() => openIncome(current.incomeReviewRevision ?? undefined)}>View quote worksheet v{current.incomeReviewRevision}</Button></div>}
      {current.reference && <p className="muted timestamp">EQ scenario {current.reference}</p>}
      {current.outcome !== "unsupported" && !current.offers.some(({ manual }) => !manual) && <p className="empty-inline">UWM returned no displayable pricing for this scenario.</p>}
      {current.offers.filter(({ manual }) => !manual).map((offer) => {
        const isSaved = saved?.id === current.id && saved.selectedId === offer.id;
        return <article className="pricing-option" key={offer.id}>
          <div className="section-heading"><h3>{offer.product}</h3><Button size="sm" variant="outline" disabled={busy || isSaved || !isCurrent(current) || feeEdits.blocked}
            onClick={() => void feeEdits.save({ type: "selectOffer", loanId: loan.id, runId: current.id, offerId: offer.id })}>{isSaved ? "Saved" : "Save quote"}</Button></div>
          <Terms offer={offer} />
          <SampleMetrics scenario={current.scenario} offer={offer} />
          {isSaved && handoffAction}
        </article>;
      })}
      {current.outcome !== "unsupported" && <details className="pricing-disclosures"><summary>Pricing disclosures</summary>
        {current.notices.map((notice, index) => <p key={index} className="quote-disclaimer">{notice}</p>)}</details>}
      {supportsManualOffers(current) && <section className="quote-saved" ref={lenderComparison} tabIndex={-1} aria-label="Compare lenders for this scenario">
        <div className="section-heading"><h3>Compare lenders for this scenario</h3><span className="pill">Fictional</span></div>
        {current.outcome === "unsupported" && <p role="status" className="quote-disclaimer">
          {current.mode === "mock" ? "Simulated EQ response. " : ""}EQ pricing is unavailable for {current.scenario.nonAgency?.program}. Add a manual offer using these saved inputs.
        </p>}
        <p className="muted">{current.scenario.nonAgency?.program ?? "Conventional"} · {cash(current.scenario.loanAmount)} loan · {current.scenario.purpose}. A manual offer goes to the manual lender handoff.</p>
        <ManualOfferForm key={current.id} run={current} busy={busy} current={isCurrent(current)} save={save} />
        {current.offers.some(({ manual }) => manual) && <div className="lender-comparison-grid">
          {[current.offers.find((offer) => !offer.manual && offer.id === current.selectedId) ?? current.offers.find(({ manual }) => !manual),
            ...current.offers.filter(({ manual }) => manual)].flatMap((offer) => offer ? [offer] : []).map((offer) => {
            const choice = option(current, offer);
            const chosen = saved?.id === current.id && selected?.id === offer.id;
            const manualExpired = !!offer.manual && offer.manual.expiresOn < expiryRange.today;
            const lender = offer.manual?.lender ?? (current.scenario.nonAgency ? "Sample estimate" : "UWM Easy Qualifier");
            return <article className="pricing-option" aria-label={lender} key={offer.id}>
              <div className="document-item-head"><h4>{lender}</h4>{chosen && <span className="pill">Chosen quote</span>}</div>
              <p>{offer.product}{!offer.product.includes(`${offer.years}-year`) && ` · ${offer.years}-year fixed`}</p>
              <p className="muted">{offer.manual ? `Manual · ${offer.manual.reference} · ${dateLabel(offer.manual.quotedOn)} through ${dateLabel(offer.manual.expiresOn)}` :
                current.scenario.nonAgency ? "Illustrative terms" : "Mock provider offer"}</p>
              <Terms offer={offer} />
              <p className="muted">{choice.worksheet ? "Fee worksheet saved" : "Fee worksheet pending"}</p>
              <div>{manualExpired ? <span className="pill">Expired</span> : chosen ? offer.manual && handoffAction : <Button size="sm" variant="outline" disabled={busy || !isCurrent(current) || feeEdits.blocked}
                aria-label={`Choose ${lender === "UWM Easy Qualifier" ? "UWM" : lender} quote`}
                onClick={() => void feeEdits.save({ type: "selectOffer", loanId: loan.id, runId: current.id, offerId: offer.id })}>Choose quote</Button>}</div>
            </article>;
          })}
        </div>}
      </section>}
    </section>}
  </div>;
}
