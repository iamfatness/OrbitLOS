"use client";

import { useRef, useState } from "react";
import { newPortalAccessCode, portalToken } from "@/lib/brokerage-model";
import type { LenderSharePage } from "@/lib/lender-handoff-share-model";
import type { ExportName } from "@/lib/lender-export-model";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

export function LenderHandoffShare({ brokerageId, loanId, revision, lenderRevision, names, canCreate, onCreated }: {
  brokerageId: string; loanId: string; revision: number; lenderRevision: number; names: ExportName[]; canCreate: boolean; onCreated: () => void;
}) {
  const [page, setPage] = useState<LenderSharePage>();
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ error: boolean; text: string }>();
  const [credentials, setCredentials] = useState<{ id: string; token: string; code: string }>();
  const [confirming, setConfirming] = useState<string>();
  const pending = useRef(false);
  const attempt = useRef<{ key: string; shareId: string; token: string; code: string } | null>(null);
  const active = page?.shares.find((share) => share.canRevoke);

  async function request(input: object) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setNotice(undefined);
    try {
      const response = await fetch(`/api/lender-packages?brokerage=${encodeURIComponent(brokerageId)}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ loanId, ...input }),
      });
      if (!response.headers.get("Content-Type")?.includes("application/json")) throw new Error("Could not load the lender package. Refresh your workspace.");
      const result = await response.json() as LenderSharePage | { error: string };
      if ("error" in result) throw new Error(result.error);
      if (!response.ok) throw new Error("Could not load the lender package.");
      setPage(result);
      if (result.message) setNotice({ error: false, text: result.message });
      return result;
    } catch (error) {
      setNotice({ error: true, text: error instanceof Error ? error.message : "Could not load the lender package." });
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  async function copy(kind: "link" | "code") {
    if (!credentials) return;
    try {
      await navigator.clipboard.writeText(kind === "link" ? `${window.location.origin}/lender-package#${credentials.token}` : credentials.code);
      setNotice({ error: false, text: kind === "link" ? "Lender link copied." : "Access code copied." });
    } catch {
      setNotice({ error: true, text: "Could not copy. Select and copy the value below." });
    }
  }

  return <details className="document-form">
    <summary onClick={() => { if (!page) void request({ type: "read" }); }}>Share a fictional lender package</summary>
    <div className="record-form">
      <p className="muted">Give a fictional lender the reviewed MISMO export and any approved sample PDFs you select. Copy the link and provide the code separately.</p>
      {notice && <p className="application-message" role={notice.error ? "alert" : "status"}>{notice.text}</p>}
      <div><Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => {
        setSelected([]);
        void request({ type: "read" });
      }}>{busy ? "Loading lender packages…" : "Refresh lender packages"}</Button></div>
      {credentials && active?.id === credentials.id && active.status === "Available" && <div className="document-item record-form">
        <p><strong>Copy these before leaving this panel.</strong> To issue new credentials, revoke this package and create a replacement.</p>
        <label className="field">Fictional lender link<input readOnly value={`${window.location.origin}/lender-package#${credentials.token}`} /></label>
        <label className="field">Fictional lender access code<input readOnly value={credentials.code} /></label>
        <div className="loan-application-actions">
          <Button size="sm" type="button" variant="outline" onClick={() => void copy("link")}>Copy lender link</Button>
          <Button size="sm" type="button" variant="outline" onClick={() => void copy("code")}>Copy access code</Button>
        </div>
      </div>}
      {page && !active && (canCreate ? <form className="record-form" onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const recipient = String(form.get("recipient") ?? "").trim();
        const documents = page.eligible.filter(({ id }) => selected.includes(id)).map(({ id, revision }) => ({ id, revision }));
        const input = { type: "create", revision, lenderRevision, names, recipient, hours: Number(form.get("hours")), documents,
          confirmedFictional: form.has("confirmed") };
        const key = JSON.stringify(input);
        if (attempt.current?.key !== key) attempt.current = { key, shareId: crypto.randomUUID(), token: portalToken(brokerageId), code: newPortalAccessCode() };
        const { shareId, token, code } = attempt.current;
        void request({ ...input, shareId, token, code }).then((result) => {
          if (result?.createdId === shareId) {
            setCredentials({ id: shareId, token, code });
            attempt.current = null;
            setSelected([]);
            onCreated();
          }
        });
      }}>
        <div className="form-grid">
          <label className="field">Fictional lender or recipient<input name="recipient" minLength={2} maxLength={120} placeholder="Example Wholesale Intake" required disabled={busy} /></label>
          <label className="field">Link expires after<select name="hours" defaultValue="24" disabled={busy}>
            <option value="1">1 hour</option><option value="24">24 hours</option><option value="72">72 hours</option>
          </select></label>
        </div>
        <fieldset className="record-form">
          <legend>Evidence to include</legend>
          <p className="muted">The reviewed MISMO XML is included. Select up to eight accepted PDFs uploaded through the demo scan.</p>
          {!page.eligible.length && <p className="muted">No accepted sample PDFs are available. You can share the XML on its own.</p>}
          {page.eligible.map((item) => <label className="demo-confirm" key={item.id}>
            <input type="checkbox" checked={selected.includes(item.id)} disabled={busy || (selected.length >= 8 && !selected.includes(item.id))}
              onChange={(event) => setSelected((previous) => event.target.checked ? [...previous, item.id] : previous.filter((id) => id !== item.id))} />
            {item.label}
          </label>)}
        </fieldset>
        <label className="demo-confirm"><input name="confirmed" type="checkbox" required disabled={busy} /> The package and recipient are fictional.</label>
        <div><Button size="sm" type="submit" disabled={busy}>Create lender link</Button></div>
      </form> : <p className="muted">Review the current 1003, complete any required second review, and verify the export names above to create a package.</p>)}
      {!!page?.shares.length && <ul className="document-list" aria-label="Recent lender packages">{page.shares.map((share) => <li className="document-item" key={share.id}>
        <div className="document-item-head"><strong>{share.recipient}</strong><span className="pill">{share.status}</span></div>
        <p className="muted">Created by {share.createdBy} · {dateTime(share.createdAt)} ET · Expires {dateTime(share.expiresAt)} ET</p>
        {share.status === "File changed" && <p className="muted">Revoke this link and prepare a new package from the current file.</p>}
        <ul>{share.files.map((item) => <li key={item.slot}>{item.label} · {item.downloads} {item.downloads === 1 ? "download" : "downloads"}
          {item.lastDownloadedAt && ` · Last ${dateTime(item.lastDownloadedAt)} ET`}</li>)}</ul>
        {share.canRevoke && <div className="loan-application-actions">
          {confirming === share.id ? <>
            <Button size="sm" type="button" disabled={busy} onClick={() => {
              void request({ type: "revoke", shareId: share.id }).then((result) => {
                if (result) { setCredentials(undefined); setConfirming(undefined); }
              });
            }}>Confirm lender link revocation</Button>
            <Button size="sm" type="button" variant="outline" disabled={busy} onClick={() => setConfirming(undefined)}>Cancel</Button>
          </> : <Button size="sm" type="button" variant="outline" disabled={busy} onClick={() => setConfirming(share.id)}>Revoke lender link</Button>}
        </div>}
      </li>)}</ul>}
    </div>
  </details>;
}
