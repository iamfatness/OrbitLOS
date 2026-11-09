"use client";

import { useState } from "react";
import { feeTemplateConfig, type FeeTemplate, type FeeTemplatePage } from "@/lib/fee-template-model";
import { blankFees, feeKeys, feeLabels } from "@/lib/quote-worksheet";
import { Button } from "./ui/button";

async function loadFeeTemplates(brokerageId: string, input: object): Promise<FeeTemplatePage> {
  const response = await fetch(`/api/fee-templates?brokerage=${encodeURIComponent(brokerageId)}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  });
  if (!response.headers.get("Content-Type")?.includes("application/json")) throw new Error("Could not open fee templates.");
  const result = await response.json() as FeeTemplatePage | { error: string };
  if ("error" in result) throw new Error(result.error);
  if (!response.ok) throw new Error("Could not open fee templates.");
  return result;
}

function useFeeTemplates(brokerageId: string) {
  const [page, setPage] = useState<FeeTemplatePage>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string }>();
  async function request(input: object, saved?: string) {
    if (busy) return false;
    setBusy(true);
    setMessage(undefined);
    try {
      setPage(await loadFeeTemplates(brokerageId, input));
      if (saved) setMessage({ error: false, text: saved });
      return true;
    } catch (error) {
      setMessage({ error: true, text: error instanceof Error ? error.message : "Could not open fee templates." });
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { page, busy, request, notice: message && <p className="application-message" role={message.error ? "alert" : "status"}>{message.text}</p> };
}

export function ManageFeeTemplates({ brokerageId }: { brokerageId: string }) {
  const { page, busy, request, notice } = useFeeTemplates(brokerageId);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<FeeTemplate>();
  const [draftError, setDraftError] = useState("");
  return <section className="pipeline relationship-panel" aria-label="Brokerage fee templates">
    <h2>Brokerage fee templates</h2>
    <p className="muted">Reuse sample fee estimates in pricing. Saved worksheets keep the template version and source used.</p>
    <details className="loan-task-create">
      <summary onClick={() => { if (!page && !busy) void request({ type: "manage" }); }}>Manage fee templates</summary>
      <div className="record-form">
        {notice}
        <form className="loan-application-actions" onSubmit={(event) => { event.preventDefault(); void request({ type: "manage", search }); }}>
          <label className="field">Find a fee template<input value={search} maxLength={80} disabled={busy} onChange={(event) => setSearch(event.target.value)} /></label>
          <Button size="sm" variant="outline" type="submit" disabled={busy}>Search fee templates</Button>
        </form>
        {busy && !page && <p role="status">Opening fee templates…</p>}
        {page && <>
          {!page.templates.length && <p className="muted">No fee templates match.</p>}
          {page.more && <p className="muted">Search by title to find more archived fee templates.</p>}
          {page.templates.length > 0 && <ul className="document-list">{page.templates.map((template) => <li className="document-item" key={template.id}>
            <div className="document-item-head"><strong>{template.title}</strong><span className="pill">{template.archived ? "Archived" : `Version ${template.revision}`}</span></div>
            <p>{template.purpose} · {template.zip || "Any ZIP"} · Effective {template.effectiveOn}</p>
            <p className="muted">{template.source}</p>
            <div className="loan-application-actions">
              {!template.archived && <Button size="sm" variant="outline" disabled={busy || !!draft} onClick={() => {
                setDraftError("");
                setDraft(template);
              }}>Edit fee template</Button>}
              <Button size="sm" variant="ghost" disabled={busy || !!draft} onClick={() => {
                void request({ type: "archive", id: template.id, revision: template.revision, archived: !template.archived },
                  template.archived ? "Fee template restored." : "Fee template archived.");
              }}>{template.archived ? "Restore fee template" : "Archive fee template"}</Button>
            </div>
          </li>)}</ul>}
          {!draft && <div><Button size="sm" disabled={busy} onClick={() => {
            setDraftError("");
            setDraft({ id: crypto.randomUUID(), revision: 0, title: "", source: "", purpose: "Any loan purpose", zip: "",
              effectiveOn: page.asOf, fees: blankFees(), archived: false });
          }}>
            New fee template
          </Button></div>}
        </>}
        {draft && <form className="document-item record-form" aria-label="Fee template editor" key={draft.id} onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const config = feeTemplateConfig.safeParse({ ...Object.fromEntries(data), fees: Object.fromEntries(feeKeys.map((key) => {
            const value = String(data.get(key) ?? "");
            return [key, value === "" ? null : Math.round(Number(value) * 100)];
          })) });
          if (!config.success) return setDraftError("Check the title, source, date, and ZIP, and enter at least one fee amount.");
          setDraftError("");
          void request({ type: "publish", id: draft.id, revision: draft.revision, config: config.data }, "Fee template published.")
            .then((saved) => { if (saved) { setDraft(undefined); setSearch(""); } });
        }}>
          {draftError && <p className="application-message" role="alert">{draftError}</p>}
          <div className="form-grid">
            <label className="field">Template title<input name="title" defaultValue={draft.title} maxLength={80} required /></label>
            <label className="field">Estimate source<input name="source" defaultValue={draft.source} maxLength={120} required placeholder="Fictional settlement schedule" /></label>
            <label className="field">Effective date<input name="effectiveOn" type="date" defaultValue={draft.effectiveOn} max={page?.asOf} required /></label>
            <label className="field">Loan purpose<select name="purpose" defaultValue={draft.purpose}>
              <option>Any loan purpose</option><option>Purchase</option><option>Refinance</option>
            </select></label>
            <label className="field">ZIP restriction<input name="zip" inputMode="numeric" pattern="[0-9]{5}" maxLength={5} defaultValue={draft.zip} placeholder="Any ZIP" /></label>
          </div>
          <p className="muted">Use fictional estimates. A blank fee stays unknown, and 0 records a zero-dollar estimate. The source is visible to staff.</p>
          <div className="form-grid">{feeKeys.map((key) => <label className="field" key={key}>{feeLabels[key]}
            <input type="number" name={key} min={0} max={25_000_000} step="0.01" defaultValue={draft.fees[key] === null ? "" : draft.fees[key] / 100} />
          </label>)}</div>
          <div className="loan-application-actions">
            <Button size="sm" type="submit" disabled={busy}>Publish fee template</Button>
            <Button size="sm" type="button" variant="outline" disabled={busy} onClick={() => setDraft(undefined)}>Cancel</Button>
          </div>
        </form>}
      </div>
    </details>
  </section>;
}

export function FeeTemplatePicker({ brokerageId, loanId, runId, disabled, onLoad }: {
  brokerageId: string; loanId: string; runId: string; disabled: boolean; onLoad: (template: FeeTemplate) => void;
}) {
  const { page, busy, request, notice } = useFeeTemplates(brokerageId);
  const [selectedId, setSelectedId] = useState("");
  const selected = page?.templates.find((template) => template.id === selectedId);
  return <div className="document-item record-form">
    <div className="loan-application-actions">
      <Button size="sm" variant="outline" type="button" disabled={busy || disabled} onClick={() => {
        void request({ type: "forQuote", loanId, runId });
      }}>{busy ? "Opening fee templates…" : page ? "Reload fee templates" : "Find brokerage fee templates"}</Button>
      {!!page?.templates.length && <label className="field">Brokerage fee template<select value={selectedId}
        disabled={busy || disabled} onChange={(event) => setSelectedId(event.target.value)}>
        <option value="">Choose a template</option>
        {page.templates.map((template) => <option key={template.id} value={template.id}>{template.title} · v{template.revision}</option>)}
      </select></label>}
    </div>
    {notice}
    {page && !page.templates.length && <p className="muted">No active template matches this quote’s loan purpose and ZIP.</p>}
    {selected && <><p className="muted">{selected.source} · Effective {selected.effectiveOn} · {selected.zip || "Any ZIP"}</p>
      <p className="muted">Loading replaces the fee fields below. Purchase price, payoffs, deposits, and credits stay in place.</p>
      <div><Button size="sm" type="button" disabled={busy || disabled} onClick={() => onLoad(selected)}>Load fee template</Button></div>
    </>}
  </div>;
}
