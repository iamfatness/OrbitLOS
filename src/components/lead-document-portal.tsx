"use client";

import { useRef, useState } from "react";
import { demoPdfFixtures } from "@/lib/document-files-model";
import { needsBorrowerDocument, type DocumentRequest } from "@/lib/document-model";
import { leadDocumentPortalUnavailable, type LeadDocumentPortalInput } from "@/lib/lead-document-model";
import { dateLabel } from "@/lib/client-retention";
import { PortalAccessCodeForm } from "./portal-access-code-form";
import { DocumentStatusPill } from "./sample-document";
import { Button } from "./ui/button";

async function send(input: LeadDocumentPortalInput) {
  const response = await fetch("/api/shared-lead-documents", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  });
  const data = await response.json() as { requests: DocumentRequest[] } | { received: boolean } | { error: string };
  return { response, data };
}

export function LeadDocumentPortal() {
  const [opened, setOpened] = useState<{ token: string; code: string; requests: DocumentRequest[] }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pending = useRef(false);
  async function request(input: LeadDocumentPortalInput) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await send(input);
      if (!result.response.ok) {
        if (result.response.status === 404) setOpened(undefined);
        throw new Error("error" in result.data ? result.data.error : leadDocumentPortalUnavailable);
      }
      const { token, code } = input;
      const checklist = input.type === "read" ? result : await send({ type: "read", token, code });
      if ("requests" in checklist.data) {
        setOpened({ token, code, requests: checklist.data.requests });
        if (input.type === "upload") setNotice("Sample PDF received. Your loan officer can review it now.");
      } else {
        if (checklist.response.status === 404) setOpened(undefined);
        throw new Error(leadDocumentPortalUnavailable);
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Orbit could not open the lead checklist.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return <main className="application-shell">
    <div className="application-intro">
      <p className="eyebrow">OrbitLOS · Fictional lead intake</p>
      <h1>Lead document checklist</h1>
      <p>Send the built-in sample PDFs your loan officer requested. Scanning is simulated.</p>
    </div>
    {error && <p className="application-message banner-error" role="alert">{error}</p>}
    {notice && <p className="application-message" role="status">{notice}</p>}
    <section className="application-panel application-form document-section" aria-label="Lead document access">
      {opened ? <>
        <div className="section-heading"><h2>Your sample requests</h2>
          <Button size="sm" variant="outline" type="button" disabled={busy} onClick={() => {
            void request({ type: "read", token: opened.token, code: opened.code });
          }}>Refresh checklist</Button>
        </div>
        <ul className="document-list">{opened.requests.map((item) => <li className="document-item" key={item.id}>
          <div className="document-item-head"><strong>{item.kind}</strong><DocumentStatusPill status={item.status} /></div>
          <p>{item.instructions}{item.dueOn && ` · Due ${dateLabel(item.dueOn)}`}</p>
          {item.replacementNote && <p className="muted">Replacement instructions · {item.replacementNote}</p>}
          {needsBorrowerDocument(item.status) && <form method="post" className="record-form" aria-label={`Send sample ${item.kind}`} onSubmit={(event) => {
            event.preventDefault();
            const fixture = new FormData(event.currentTarget).get("fixture") as keyof typeof demoPdfFixtures;
            void request({ type: "upload", token: opened.token, code: opened.code, requestId: item.id, revision: item.revision, fixture });
          }}>
            <label className="field">Sample PDF<select name="fixture" defaultValue={item.status === "Needs replacement" ? "replacement" : "clean"}>
              {Object.entries(demoPdfFixtures).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select></label>
            <div><Button size="sm" type="submit" disabled={busy || item.pdfStatus === "Processing"}>Submit sample PDF</Button></div>
          </form>}
        </li>)}</ul>
      </> : <PortalAccessCodeForm busy={busy} label="Lead document access code" submitLabel="Open lead checklist" open={(code) => {
        const token = window.location.hash.slice(1);
        if (!token) return setError(leadDocumentPortalUnavailable);
        void request({ type: "read", token, code });
      }} />}
    </section>
  </main>;
}
