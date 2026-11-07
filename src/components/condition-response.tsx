"use client";

import { useRef, useState } from "react";
import type { Condition } from "@/lib/model";
import type { LoanDocumentRequest } from "@/lib/document-model";
import { Button } from "./ui/button";

export function ConditionResponse({ condition, request, lender }: { condition: Condition; request?: LoanDocumentRequest; lender: string }) {
  const [status, setStatus] = useState("");
  const message = useRef<HTMLTextAreaElement>(null);
  const reviewed = request?.status === "Accepted";
  const detail = reviewed ? `${request.kind} was reviewed in Orbit (document revision ${request.revision}).` :
    request ? `The ${request.kind.toLowerCase()} is ${request.status.toLowerCase()} in the borrower checklist.` : "A borrower document request has not been linked.";
  const draft = `To the ${lender} loan team,\n\nCondition: ${condition.category}. ${condition.description}\n\n${detail}\n\n${reviewed ?
    "Please review the document once delivered and confirm whether it satisfies the condition." :
    "We will follow up when the requested information is available."}`;
  return <details className="document-form">
    <summary>Prepare condition response</summary>
    <p className="muted">Based on this lender request{request && <> and the <a href={`#document-${request.id}`}>linked checklist entry</a></>}. Review and edit the draft before sharing it.</p>
    <label>Editable condition response<textarea key={request?.revision ?? 0} ref={message} rows={5} defaultValue={draft} /></label>
    <Button size="sm" variant="outline" onClick={async () => {
      if (!message.current) return;
      try { await navigator.clipboard.writeText(message.current.value); setStatus("Draft copied."); }
      catch { message.current.select(); setStatus("Draft selected. Use your device’s copy shortcut."); }
    }}>Copy response draft</Button>
    {status && <p role="status">{status}</p>}
  </details>;
}
