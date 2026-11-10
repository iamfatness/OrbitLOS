"use client";

import { useState } from "react";
import type { BrokerageMember } from "@/lib/brokerage-model";
import { quoteBranchLimit, quoteRoutingLabel, type QuoteIntakeConfig, type QuoteRoutingReceipt } from "@/lib/quote-intake-model";
import { Button } from "./ui/button";

export function QuoteBranchRouting({ draft, officers, change, preview, busy }: {
  draft: QuoteIntakeConfig; officers: BrokerageMember[]; change: (update: Partial<QuoteIntakeConfig>) => void;
  preview: (zip: string, hasPhone: boolean) => Promise<QuoteRoutingReceipt>; busy: boolean;
}) {
  const [zip, setZip] = useState("");
  const [hasPhone, setHasPhone] = useState(false);
  const [checking, setChecking] = useState(false);
  const [previewed, setPreviewed] = useState<{ key: string; result: QuoteRoutingReceipt | string }>();
  const rules = draft.branches ?? [];
  const key = JSON.stringify([draft, zip, hasPhone]);
  const result = previewed?.key === key ? previewed.result : undefined;

  function edit(id: string, update: Partial<(typeof rules)[number]>) {
    change({ branches: rules.map((rule) => rule.id === id ? { ...rule, ...update } : rule) });
  }

  async function check() {
    if (checking) return;
    if (zip && !/^\d{5}$/.test(zip)) {
      setPreviewed({ key, result: "Enter a five-digit property ZIP or leave it blank." });
      return;
    }
    setChecking(true);
    setPreviewed(undefined);
    try {
      setPreviewed({ key, result: await preview(zip, hasPhone) });
    } catch (error) {
      setPreviewed({ key, result: error instanceof Error ? error.message : "Could not preview the route." });
    } finally {
      setChecking(false);
    }
  }

  return <details className="document-form">
    <summary>Branch defaults and routing preview{rules.length ? ` · ${rules.length}` : ""}</summary>
    <div className="record-form">
      <p className="muted">After campaign routing, an exact five-digit ZIP wins over a three-digit prefix. Without a match, the profile’s direct routing applies.</p>
      {draft.zip === "Hidden" && <p className="muted">Show the property ZIP field to enable branch defaults.</p>}
      {rules.map((rule, index) => <fieldset key={rule.id} className="document-item" disabled={busy}>
        <legend>Branch rule {index + 1}</legend>
        <div className="form-grid">
          <label className="field">Branch name<input value={rule.name} maxLength={60}
            onChange={(event) => edit(rule.id, { name: event.target.value })} /></label>
          <label className="field">ZIP or ZIP prefix<input value={rule.zip} inputMode="numeric" maxLength={5}
            onChange={(event) => edit(rule.id, { zip: event.target.value })} /></label>
          <label className="field">Default branch LO<select value={rule.ownerEmail ?? ""}
            onChange={(event) => edit(rule.id, { ownerEmail: event.target.value || null })}>
            <option value="">Shared inbox</option>
            {officers.map(({ email, name }) => <option key={email} value={email}>{name} · {email}</option>)}
            {rule.ownerEmail && !officers.some(({ email }) => email === rule.ownerEmail) && <option value={rule.ownerEmail}>Unavailable owner</option>}
          </select></label>
        </div>
        <div><Button size="sm" variant="outline" aria-label={`Remove branch rule ${index + 1}`}
          onClick={() => change({ branches: rules.filter(({ id }) => id !== rule.id) })}>Remove rule</Button></div>
      </fieldset>)}
      <div><Button size="sm" variant="outline" disabled={busy || draft.zip === "Hidden" || rules.length >= quoteBranchLimit}
        onClick={() => change({ branches: [...rules, { id: crypto.randomUUID(), name: "", zip: "", ownerEmail: null }] })}>Add branch rule</Button></div>
      <section className="work-queue" aria-label="Intake routing preview">
        <h4>Try a route</h4>
        <p className="muted">Preview the draft without publishing or creating a lead.</p>
        <div className="form-grid">
          <label className="field">Test property ZIP<input value={zip} inputMode="numeric" maxLength={5} disabled={busy || draft.zip === "Hidden"}
            onChange={(event) => setZip(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void check(); } }} /></label>
          <label className="demo-confirm"><input type="checkbox" checked={hasPhone} disabled={busy} onChange={(event) => setHasPhone(event.target.checked)} />
            <span>Request includes a phone number</span></label>
        </div>
        <div><Button size="sm" variant="outline" disabled={busy || checking} onClick={() => void check()}>{checking ? "Checking route…" : "Preview route"}</Button></div>
        {typeof result === "string" ? <p role="alert">{result}</p> : result && <div role="status">
          <p><strong>{quoteRoutingLabel(result)}</strong></p>
          {result.note && <p>{result.note}</p>}
        </div>}
      </section>
    </div>
  </details>;
}
