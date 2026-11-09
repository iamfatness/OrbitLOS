"use client";

import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { dateLabel } from "@/lib/client-retention";
import { sharedPreapprovalUnavailable, type PreapprovalAudience, type SharedPreapprovalLetter } from "@/lib/preapproval-model";
import { downloadSampleFile } from "./sample-download";
import { Button } from "./ui/button";

export function SharedPreapprovalDownload({ letter, token, audience, name }: {
  letter: SharedPreapprovalLetter; token: string; audience: PreapprovalAudience; name?: string;
}) {
  const active = useRef<AbortController>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => () => active.current?.abort(), []);

  async function download() {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/shared-preapproval", { method: "POST", credentials: "omit", signal: controller.signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, audience, grantId: letter.grantId }) });
      if (!response.ok) { setError(sharedPreapprovalUnavailable); return; }
      const { pdf, filename } = await response.json() as { pdf: string; filename: string };
      if (!controller.signal.aborted && window.location.hash.slice(1) === token) downloadSampleFile(pdf, filename, "application/pdf");
    } catch {
      if (!controller.signal.aborted) setError("Could not download the sample letter. Try again.");
    } finally {
      active.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return <div>
    <small className="muted">Fictional sample · Expires {dateLabel(letter.expiresOn)}</small>
    <div><Button variant="outline" size="sm" disabled={busy} onClick={() => void download()}
      aria-label={`Download sample letter${name ? ` for ${name}` : ""} PDF`}><Download /> Sample letter PDF</Button></div>
    {error && <small role="alert">{error}</small>}
  </div>;
}
