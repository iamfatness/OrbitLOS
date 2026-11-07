"use client";

import { useState, type FormEvent } from "react";
import type { DocumentRequest } from "@/lib/document-model";
import { demoPdfFixtures, maxPdfBytes, type DocumentUploadMode } from "@/lib/document-files-model";
import { Button } from "./ui/button";

async function pdfResponse(response: Response) {
  const result = await response.json() as { error?: string; session?: string; demoCode?: string };
  if (!response.ok) throw new Error(result.error ?? "Orbit could not process the request.");
  return result;
}

export function useBorrowerPdf(token: string, refresh: () => void, mode?: DocumentUploadMode) {
  const [session, setSession] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [demoCode, setDemoCode] = useState("");
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
        body: JSON.stringify({ type, code, token }),
      }));
      if (result.session) { setSession(result.session); setDemoCode(""); }
      else { setCodeSent(true); setDemoCode(result.demoCode ?? ""); }
      setNotice(result.session ? (mode === "mock" ? "Demo code verified. Choose a sample PDF." : "Email verified. You can upload your PDFs.")
        : mode === "mock" ? "Your demo code is shown below." : "Check the email on file for your verification code.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not verify your email."); }
    finally { setBusy(false); }
  }

  async function upload(event: FormEvent<HTMLFormElement>, request: DocumentRequest) {
    event.preventDefault();
    if (!session || busy) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const file = fields.get("pdf");
    setError("");
    setNotice("");
    if (mode !== "mock" && (!(file instanceof File) || !file.name.toLowerCase().endsWith(".pdf") || !file.size || file.size > maxPdfBytes)) {
      setError("Choose a PDF no larger than 5 MB.");
      return;
    }
    setBusy(true);
    setProcessing(request.id);
    try {
      const response = await fetch("/api/borrower-documents/upload", mode === "mock" ? {
        method: "POST", credentials: "omit", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, session, requestId: request.id, revision: request.revision, fixture: fields.get("fixture") }),
      } : {
        method: "POST", credentials: "omit", headers: { "Content-Type": "application/pdf", "X-Orbit-Application": token,
          "X-Orbit-Upload-Session": session, "X-Orbit-Request": request.id, "X-Orbit-Revision": String(request.revision) }, body: file,
      });
      if (response.status === 401) { setSession(""); setCodeSent(false); setDemoCode(""); }
      await pdfResponse(response);
      form.reset();
      setNotice(mode === "mock" ? "Demo PDF passed the mock scan and is ready for review." : "PDF received and ready for your loan team to review.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not upload this PDF."); }
    finally { setBusy(false); setProcessing(""); refresh(); }
  }

  return { session, codeSent, demoCode, busy, processing, error, notice, verify, upload };
}

export function BorrowerPdfVerification({ pdf, busy, demo }: { pdf: ReturnType<typeof useBorrowerPdf>; busy: boolean; demo: boolean }) {
  return <div className="borrower-next">
    <strong>{demo ? "Try demo verification" : "Verify your email to upload PDFs"}</strong>
    <p>{demo ? "Orbit displays a demo code here. Use it to try a built-in PDF and mock scan." : "Orbit sends a code to the email address on your loan."}</p>
    {pdf.demoCode && <p>Demo code <strong>{pdf.demoCode}</strong></p>}
    {pdf.codeSent && <form className="rate-lock-actions" onSubmit={(event) => {
      event.preventDefault();
      void pdf.verify("verifyCode", new FormData(event.currentTarget).get("code"));
    }}>
      <label className="field">Verification code<input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required /></label>
      <Button type="submit" size="sm" disabled={busy || pdf.busy}>{demo ? "Verify demo code" : "Verify email"}</Button>
    </form>}
    <div><Button variant="outline" size="sm" disabled={busy || pdf.busy} onClick={() => void pdf.verify("sendCode")}>{demo ? "Get demo code" : pdf.codeSent ? "Send another code" : "Send verification code"}</Button></div>
  </div>;
}

export function BorrowerPdfForm({ pdf, request, busy, demo }: { pdf: ReturnType<typeof useBorrowerPdf>; request: DocumentRequest; busy: boolean; demo: boolean }) {
  return <form className="rate-lock-actions" onSubmit={(event) => void pdf.upload(event, request)}>
    {demo ? <label className="field">Demo PDF<select name="fixture" disabled={busy || pdf.busy} defaultValue={request.status === "Needs replacement" ? "replacement" : "clean"}>
      {Object.entries(demoPdfFixtures).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
    </select></label> : <label className="field">{request.status === "Needs replacement" ? "Replacement PDF" : "Choose PDF"}
      <input type="file" name="pdf" accept=".pdf,application/pdf" required disabled={busy || pdf.busy} />
    </label>}
    <Button type="submit" size="sm" disabled={busy || pdf.busy}>{demo ? "Submit demo PDF" : "Upload PDF"}</Button>
  </form>;
}
