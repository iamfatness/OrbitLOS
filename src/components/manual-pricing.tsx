"use client";

import { useRef } from "react";
import type { WorkspaceMutationSuccess } from "@/lib/commands";
import { easternDate } from "@/lib/client-retention";
import { manualQuoteLimit, type ManualQuoteDetails } from "@/lib/manual-pricing-model";
import type { PricingRun } from "@/lib/pricing-model";
import { Button } from "./ui/button";

export function ManualOfferForm({ run, busy, current, save }: { run: PricingRun; busy: boolean; current: boolean;
  save: (input: unknown, after?: (result: WorkspaceMutationSuccess) => void) => Promise<void> }) {
  const attempt = useRef<{ key: string; id: string } | null>(null);
  const today = easternDate();
  const capped = run.offers.filter(({ manual }) => manual).length >= manualQuoteLimit;
  if (!current || capped) return <p className="muted">{capped ? "Run sample pricing again to start a comparison with room for more manual offers." :
    "Run sample pricing from the current 1003 before adding a manual offer."}</p>;
  return <details className="document-form"><summary>Add a manual lender offer</summary>
    <p className="muted">Use a fictional fixed-rate offer for the scenario above. Orbit calculates principal and interest and keeps the quoted terms and source reference.</p>
    <form className="record-form" onSubmit={(event) => {
      event.preventDefault();
      if (busy) return;
      const form = event.currentTarget;
      const fields = new FormData(form);
      const text = (name: string) => String(fields.get(name) ?? "").trim();
      const optionalNumber = (name: string) => text(name) === "" ? null : Number(text(name));
      const details: ManualQuoteDetails = { lender: text("lender"), reference: text("reference"), product: text("product"),
        quotedOn: text("quotedOn"), expiresOn: text("expiresOn"), years: Number(text("years")), rate: Number(text("rate")),
        apr: optionalNumber("apr"), adjustment: optionalNumber("adjustment") };
      const key = JSON.stringify(details);
      if (attempt.current?.key !== key) attempt.current = { key, id: crypto.randomUUID() };
      void save({ type: "addManualQuote", loanId: run.loanId, runId: run.id, offerId: attempt.current.id, details }, () => {
        attempt.current = null;
        form.reset();
      });
    }}>
      <fieldset className="form-grid" disabled={busy}>
        <label className="field">Fictional lender name<input name="lender" required minLength={2} maxLength={100} /></label>
        <label className="field">Lender quote reference<input name="reference" required maxLength={100} /></label>
        <label className="field">Product name<input name="product" required minLength={2} maxLength={100} /></label>
        <label className="field">Fixed term (years)<input type="number" name="years" min={5} max={40} step={1} defaultValue={30} required /></label>
        <label className="field">Note rate (%)<input type="number" name="rate" min="0.001" max="25" step="0.001" required /></label>
        <label className="field">APR (%)<input type="number" name="apr" min="0.001" max="25" step="0.001" /></label>
        <label className="field">Quoted on (Eastern)<input type="date" name="quotedOn" defaultValue={today} max={today} required /></label>
        <label className="field">Expires on (Eastern)<input type="date" name="expiresOn" min={today} required /></label>
        <label className="field">Points or credit (%)<input type="number" name="adjustment" min="-10" max="10" step="0.001" />
          <small>Positive points, negative credit, or zero for neither. Leave blank when unknown.</small></label>
      </fieldset>
      <label className="demo-confirm"><input type="checkbox" required disabled={busy} /> These fictional terms use the same loan assumptions.</label>
      <div><Button type="submit" size="sm" disabled={busy}>Add manual offer to comparison</Button></div>
    </form>
  </details>;
}
