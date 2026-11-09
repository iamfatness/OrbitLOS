"use client";

import { useState, useSyncExternalStore } from "react";
import { Button } from "./ui/button";

const subscribe = () => () => {};

export function PortalAccessCodeForm({ busy, label, submitLabel, open }: {
  busy: boolean; label: string; submitLabel: string; open: (code: string) => void;
}) {
  const ready = useSyncExternalStore(subscribe, () => true, () => false);
  const [code, setCode] = useState("");
  return <form method="post" className="record-form" onSubmit={(event) => {
    event.preventDefault();
    open(code.trim());
  }}>
    <p className="muted">Enter the code you received separately from this link.</p>
    <label className="field">{label}<input type="password" autoComplete="off" autoCapitalize="none" spellCheck={false}
      minLength={24} maxLength={24} pattern="[A-Fa-f0-9]{24}" required disabled={busy || !ready} value={code}
      onChange={(event) => setCode(event.target.value)} /></label>
    <div><Button type="submit" disabled={busy || !ready}>{busy ? "Opening…" : submitLabel}</Button></div>
  </form>;
}
