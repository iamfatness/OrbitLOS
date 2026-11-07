"use client";

import { useState, type FormEvent } from "react";
import type { DocumentRequest } from "@/lib/document-model";
import { maxPdfBytes } from "@/lib/document-files-model";
import { Button } from "./ui/button";

async function pdfResponse(response: Response) {
  const result = await response.json() as { error?: string; session?: string };
  if (!response.ok) throw new Error(result.error ?? "Orbit could not process the request.");
  return result;
}

export function useBorrowerPdf(refresh: () => void) {
  const [session, setSession] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [processing, setProcessing] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function verify(type: "sendCode" | "verifyCode", code?: FormDataEntryValue | null) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await pdfResponse(await fetch("/api/borrower-documents/verify", {
        method: "POST", credentials: "omit", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, code, token: window.location.hash.slice(1) }),
      }));
      if (result.session) setSession(result.session);
      else setCodeSent(true);
      setNotice(result.session ? "Email verified. You can upload your PDFs." : "Check the email on file for your verification code.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not verify your email."); }
    finally { setBusy(false); }
  }

  async function upload(event: FormEvent<HTMLFormElement>, request: DocumentRequest) {
    event.preventDefault();
    if (!session || busy) return;
    const form = event.currentTarget;
    const file = new FormData(form).get("pdf");
    setError("");
    setNotice("");
    if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".pdf") || !file.size || file.size > maxPdfBytes) {
      setError("Choose a PDF no larger than 5 MB.");
      return;
    }
    setBusy(true);
    setProcessing(request.id);
    try {
      const response = await fetch("/api/borrower-documents/upload", { method: "POST", credentials: "omit", headers: {
        "Content-Type": "application/pdf", "X-Orbit-Application": window.location.hash.slice(1), "X-Orbit-Upload-Session": session,
        "X-Orbit-Request": request.id, "X-Orbit-Revision": String(request.revision),
      }, body: file });
      if (response.status === 401) { setSession(""); setCodeSent(false); }
      await pdfResponse(response);
      form.reset();
      setNotice("PDF received and ready for your loan team to review.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not upload this PDF."); }
    finally { setBusy(false); setProcessing(""); refresh(); }
  }

  return { session, codeSent, busy, processing, error, notice, verify, upload };
}

export function BorrowerPdfVerification({ pdf, busy }: { pdf: ReturnType<typeof useBorrowerPdf>; busy: boolean }) {
  return <div className="borrower-next">
    <strong>Verify your email to upload PDFs</strong>
    <p>Orbit sends a code to the email address on your loan.</p>
    {pdf.codeSent && <form className="rate-lock-actions" onSubmit={(event) => {
      event.preventDefault();
      void pdf.verify("verifyCode", new FormData(event.currentTarget).get("code"));
    }}>
      <label className="field">Verification code<input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required /></label>
      <Button type="submit" size="sm" disabled={busy || pdf.busy}>Verify email</Button>
    </form>}
    <div><Button variant="outline" size="sm" disabled={busy || pdf.busy} onClick={() => void pdf.verify("sendCode")}>{pdf.codeSent ? "Send another code" : "Send verification code"}</Button></div>
  </div>;
}
