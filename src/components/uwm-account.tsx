"use client";

import { useEffect, useState } from "react";
import { Button } from "./ui/button";

type Account = { configured: boolean; environment: string; connectedAt: string | null; expiresAt: number | null; message: string };
export function UwmAccount({ brokerageId }: { brokerageId: string }) {
  const [account, setAccount] = useState<Account | null>(null), [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [username, setUsername] = useState(""), [password, setPassword] = useState(""), [busy, setBusy] = useState(false);
  const url = `/api/uwm-account?brokerage=${encodeURIComponent(brokerageId)}`;
  useEffect(() => {
    const controller = new AbortController();
    fetch(url, { signal: controller.signal, cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error();
      setAccount(await response.json());
    }).catch(() => { if (!controller.signal.aborted) setError("UWM connection status is unavailable."); });
    return () => controller.abort();
  }, [url]);
  async function change(action: "connect" | "disconnect" | "verify") {
    setBusy(true); setError(""); setMessage("");
    const credentials = { username, password };
    setPassword("");
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...(action === "connect" ? { credentials } : {}) }) });
      const result = await response.json() as { error?: string; message?: string };
      if (!response.ok || result.error) throw new Error(result.error || "Could not update your UWM connection.");
      setMessage(result.message ?? "");
      const status = await fetch(url, { cache: "no-store" });
      if (!status.ok) throw new Error("Reconnect status could not be refreshed.");
      setAccount(await status.json());
    } catch (failure) { setError(failure instanceof Error ? failure.message : "UWM connection failed."); }
    finally { credentials.password = ""; setBusy(false); }
  }
  return <section className="document-form" aria-label="Your UWM account">
    <h3>Your UWM account</h3>
    {!account && !error && <p>Checking connection…</p>}
    {account && <p>{account.environment === "production" ? "Production" : `${account.environment.toUpperCase()} · test environment`}
      {account.connectedAt ? " · Connected" : " · Not connected"}</p>}
    {account && !account.configured && <p>{account.message}</p>}
    {account?.configured && <>
      <p>Connect with your UWM login for this environment. Your password is used to sign in and is not stored. Connecting does not submit a loan or request a lock.</p>
      <form onSubmit={(event) => { event.preventDefault(); void change("connect"); }}>
        <label className="field"><span>UWM username</span><input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} disabled={busy} required /></label>
        <label className="field"><span>UWM password</span><input type="password" autoComplete="off" value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} required /></label>
        <Button type="submit" disabled={busy}>{busy ? "Working…" : account.connectedAt ? "Reconnect UWM" : "Connect UWM"}</Button>
      </form>
      {account.connectedAt && <Button variant="outline" disabled={busy} onClick={() => void change("disconnect")}>Disconnect my UWM account</Button>}
      {account.connectedAt && <Button variant="outline" disabled={busy} onClick={() => void change("verify")}>Verify UWM broker access</Button>}
    </>}
    {error && <p role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
  </section>;
}
