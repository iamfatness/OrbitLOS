"use client";

import { useRef, useState } from "react";
import { lenderPackageFilename, lenderPackageUnavailable, type LenderPackageManifest, type SharedLenderPackageInput } from "@/lib/lender-handoff-share-model";
import { dateTime } from "@/lib/utils";
import { downloadSampleFile } from "./sample-download";
import { Button } from "./ui/button";

export function LenderPackage() {
  const [opened, setOpened] = useState<{ manifest: LenderPackageManifest; token: string; code: string }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pending = useRef(false);
  async function request(input: SharedLenderPackageInput) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/shared-lender-package", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
      });
      if (!response.ok) {
        if (response.status === 404) setOpened(undefined);
        throw new Error(response.status === 404 ? lenderPackageUnavailable : "Could not open the package. Try again.");
      }
      if (input.type === "read") setOpened({ manifest: await response.json() as LenderPackageManifest, token: input.token, code: input.code });
      else {
        downloadSampleFile(await response.blob(), lenderPackageFilename(input.slot));
        setNotice("Download ready.");
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not open the package.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return <main className="application-shell">
    <div className="application-intro">
      <p className="eyebrow">OrbitLOS · Fictional handoff</p>
      <h1>Lender package</h1>
      <p>Open the reviewed 1003 and the sample evidence selected for this handoff.</p>
    </div>
    {error && <p className="application-message banner-error" role="alert">{error}</p>}
    {notice && <p className="application-message" role="status">{notice}</p>}
    <section className="application-panel application-form document-section" aria-label="Lender package access">
      {opened ? <>
        <h2>{opened.manifest.recipient}</h2>
        <p className="muted">Fictional files · Expires {dateTime(opened.manifest.expiresAt)} ET</p>
        <ul className="document-list">{opened.manifest.files.map((file) => <li className="document-item" key={file.slot}>
          <div className="document-item-head"><strong>{file.label}</strong>
            <Button size="sm" type="button" variant="outline" aria-label={`Download ${file.label}`} disabled={busy} onClick={() => {
              void request({ type: "download", token: opened.token, code: opened.code, slot: file.slot });
            }}>Download {file.slot === 0 ? "XML" : "PDF"}</Button>
          </div>
        </li>)}</ul>
      </> : <form className="record-form" onSubmit={(event) => {
        event.preventDefault();
        const token = window.location.hash.slice(1);
        const code = String(new FormData(event.currentTarget).get("code") ?? "").trim();
        if (!token) return setError(lenderPackageUnavailable);
        void request({ type: "read", token, code });
      }}>
        <p className="muted">Enter the code you received separately from this link.</p>
        <label className="field">Lender access code<input type="password" name="code" autoComplete="off" autoCapitalize="none" spellCheck={false}
          minLength={24} maxLength={24} pattern="[A-Fa-f0-9]{24}" required disabled={busy} /></label>
        <div><Button type="submit" disabled={busy}>{busy ? "Opening package…" : "Open package"}</Button></div>
      </form>}
    </section>
  </main>;
}
