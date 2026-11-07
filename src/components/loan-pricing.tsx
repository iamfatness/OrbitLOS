"use client";

import { useState, type FormEvent } from "react";
import { BadgeCheck, Calculator, Eye, FlaskConical } from "lucide-react";
import type { ApplicationDraft } from "@/lib/application-model";
import type { Loan, Workspace } from "@/lib/model";
import type { PricingOffer, PricingRun, PricingScenario } from "@/lib/pricing-model";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const cash = (amount: number | null) => amount === null ? "—" : dollars.format(amount);
const percentage = (value: number | null) => value === null ? "—" : `${value.toFixed(3)}%`;
const occupancies = ["Primary residence", "Second home", "Investment property"];
const propertyTypes = ["Single family", "Attached condominium"];

function defaults(loan: Loan, draft: ApplicationDraft | null | undefined, run?: PricingRun) {
  const scenario = run?.scenario;
  return {
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
  };
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
  const alreadyShared = published?.runId === saved?.id && published?.offerId === selected?.id;
  const [form, setForm] = useState(() => defaults(loan, draft, current));
  const [preview, setPreview] = useState(false);
  const [pricing, setPricing] = useState(false);
  const change = (name: keyof typeof form, value: string | boolean) => setForm((last) => ({ ...last, [name]: value }));

  async function price(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const scenario: PricingScenario = {
      ...form, loanAmount: Number(form.loanAmount), propertyValue: Number(form.propertyValue),
      purchasePrice: form.purpose === "Purchase" && form.purchasePrice ? Number(form.purchasePrice) : null,
      creditScore: Number(form.creditScore), monthlyIncome: Number(form.monthlyIncome),
    };
    setPricing(true);
    setPreview(false);
    try { await save({ type: "runPricing", loanId: loan.id, scenario }); }
    finally { setPricing(false); }
  }

  function loadSample() {
    setForm({
      ...defaults(loan, draft), loanAmount: "360000", propertyValue: "450000", purchasePrice: form.purpose === "Purchase" ? "450000" : "",
      purpose: form.purpose, zip: "48009", creditScore: "760", monthlyIncome: "9500",
    });
  }

  return <div className="pricing-panel">
    <header className="pricing-heading">
      <div><h3><Calculator size={18} /> UWM Easy Qualifier</h3><p>Conventional purchase and rate-and-term refinance.</p></div>
      <span className="pill"><FlaskConical size={13} /> {current?.mode === "stage" ? "UWM stage" : current ? "Sample pricing" : "Demo workspace"}</span>
    </header>
    <form className="pricing-form" onSubmit={(event) => void price(event)}>
      <div className="form-grid">
        <label className="field"><span>Loan purpose</span><select value={form.purpose} onChange={(event) => change("purpose", event.target.value)}><option>Purchase</option><option>Refinance</option></select></label>
        <label className="field"><span>Loan amount</span><input required type="number" min="1" max="25000000" step="0.01" value={form.loanAmount} onChange={(event) => change("loanAmount", event.target.value)} /></label>
        <label className="field"><span>Estimated property value</span><input required type="number" min="1" max="25000000" step="0.01" value={form.propertyValue} onChange={(event) => change("propertyValue", event.target.value)} /></label>
        {form.purpose === "Purchase" && <label className="field"><span>Purchase price (optional)</span><input type="number" min="1" max="25000000" step="0.01" value={form.purchasePrice} onChange={(event) => change("purchasePrice", event.target.value)} /></label>}
        <label className="field"><span>Property ZIP</span><input required inputMode="numeric" pattern="[0-9]{5}" maxLength={5} value={form.zip} onChange={(event) => change("zip", event.target.value)} /></label>
        <label className="field"><span>FICO score</span><input required type="number" min="300" max="850" value={form.creditScore} onChange={(event) => change("creditScore", event.target.value)} /></label>
        <label className="field"><span>Gross monthly income</span><input required type="number" min="1" max="10000000" step="0.01" value={form.monthlyIncome} onChange={(event) => change("monthlyIncome", event.target.value)} /></label>
        <label className="field"><span>Occupancy</span><select value={form.occupancy} onChange={(event) => change("occupancy", event.target.value)}>{occupancies.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="field"><span>Property type</span><select value={form.propertyType} onChange={(event) => change("propertyType", event.target.value)}>{propertyTypes.map((value) => <option key={value}>{value}</option>)}</select></label>
      </div>
      {form.purpose === "Purchase" && <label className="demo-confirm"><input type="checkbox" checked={form.firstTimeBuyer} onChange={(event) => change("firstTimeBuyer", event.target.checked)} /> First-time homebuyer</label>}
      <div className="pricing-actions"><Button size="sm" variant="outline" disabled={busy} onClick={loadSample}>Load sample scenario</Button>
        <Button type="submit" disabled={busy}><Calculator /> {pricing ? "Pricing…" : "Run pricing"}</Button></div>
    </form>
    {saved && selected && <section className="quote-saved">
      <div className="section-heading"><h3><BadgeCheck size={17} /> Saved quote</h3>
        <Button size="sm" variant="outline" aria-expanded={preview} onClick={() => setPreview(!preview)}><Eye /> {preview ? "Hide preview" : "Preview borrower quote"}</Button>
      </div>
      <p>{selected.product} · {percentage(selected.rate)} · {cash(selected.principalAndInterest)} monthly P&amp;I</p>
      <p className="muted timestamp">{saved.mode === "mock" ? "Sample pricing" : "UWM stage"} · Priced {dateTime(saved.quotedAt)} ET</p>
      {preview && <div className="quote-preview">
        <p className="eyebrow">{saved.mode === "mock" ? "SAMPLE BORROWER QUOTE" : "UWM STAGE QUOTE"}</p>
        <strong>{selected.product}</strong>
        <p className="muted">{cash(saved.scenario.loanAmount)} loan · {saved.scenario.purpose}</p>
        <Terms offer={selected} />
        {saved.notices.map((notice, index) => <p key={index} className="quote-disclaimer">{notice}</p>)}
        {saved.mode === "mock" && (application?.submittedAt ? <div className="pricing-actions">
          <Button size="sm" disabled={busy || alreadyShared} onClick={() => void save({ type: "publishQuote", loanId: loan.id, runId: saved.id, offerId: selected.id })}>
            {alreadyShared ? "Published to borrower" : published ? "Replace shared sample quote" : "Publish sample quote"}
          </Button>
        </div> : <p className="muted">The borrower can see a shared quote after submitting their 1003.</p>)}
      </div>}
    </section>}
    {published && <section className="quote-saved" aria-label="Shared borrower quote">
      <div className="section-heading"><h3>Shared with borrower</h3>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void save({ type: "withdrawQuote", loanId: loan.id, publishedAt: published.publishedAt })}>Remove shared quote</Button></div>
      <p>{published.product} · {percentage(published.rate)} · {cash(published.principalAndInterest)} monthly P&amp;I</p>
      <p className="muted timestamp">Sample quote · Shared {dateTime(published.publishedAt)} ET</p>
    </section>}
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
        </article>;
      })}
      <details className="pricing-disclosures"><summary>Pricing disclosures</summary>
        {current.notices.map((notice, index) => <p key={index} className="quote-disclaimer">{notice}</p>)}</details>
    </section>}
  </div>;
}
