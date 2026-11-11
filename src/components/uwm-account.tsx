"use client";

import { useEffect, useState } from "react";
import { Link2, ShieldCheck, CheckCircle2 } from "lucide-react";
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
  const connected = !!account?.connectedAt;
  const form = <form className="uwm-signin-form" onSubmit={(event) => { event.preventDefault(); void change("connect"); }}>
    <label className="field"><span>UWM username</span><input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} disabled={busy} required /></label>
    <label className="field"><span>UWM password</span><input type="password" autoComplete="off" value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} required /></label>
    <Button type="submit" disabled={busy}><Link2 size={16} aria-hidden="true" />{busy ? "Connecting…" : connected ? "Reconnect UWM" : "Connect UWM"}</Button>
  </form>;
  return <section className="uwm-account-card" aria-label="Your UWM account" aria-busy={busy}>
    <div className="uwm-card-heading"><span className="uwm-step-icon"><Link2 size={20} aria-hidden="true" /></span>
      <div><h3>{connected || !account?.configured ? "Your UWM account" : "Connect your UWM account"}</h3>
        <p>{connected ? "Manage your personal lender connection." : account?.configured ? "Sign in to check your brokerage access." : "Account access for this workspace."}</p></div>
      {account && <span className={`uwm-status ${connected ? "is-ready" : ""}`}>{connected ? "Connected" : account.configured ? "Not connected" : "Not enabled"}</span>}
    </div>
    {!account && !error && <p className="uwm-loading" role="status">Checking your connection…</p>}
    {account?.configured && <div className="uwm-environment"><span className="uwm-status">{account.environment === "production" ? "Production" : "Test environment"}</span>
      <span>{account.environment === "production" ? "Your brokerage’s UWM connection" : "For testing with synthetic loan data"}</span></div>}
    {account && !account.configured && <div className="uwm-setup-note"><strong>UWM account access isn’t enabled here</strong><p>Orbit configures this connection during brokerage onboarding. There is no setting in this workspace to turn it on.</p><p>Once access is enabled, your UWM sign-in form will appear here. Connections on the test site are separate from production.</p></div>}
    {account?.configured && <>
      {connected ? <>
        <div className="uwm-connected-note"><CheckCircle2 size={20} aria-hidden="true" /><div><strong>Account connected</strong><p>Verify access to confirm the UWM brokerages available to you.</p></div></div>
        <div className="uwm-account-actions"><Button disabled={busy} onClick={() => void change("verify")}>{busy ? "Working…" : "Verify brokerage access"}</Button>
          <Button variant="ghost" disabled={busy} onClick={() => void change("disconnect")}>Disconnect</Button></div>
        <details className="uwm-reconnect"><summary>Use a different UWM login</summary>{form}</details>
      </> : form}
      <p className="uwm-security-note"><ShieldCheck size={16} aria-hidden="true" /><span>Your password is used once to sign in and is not stored. Connecting won’t submit a loan or lock a rate.</span></p>
    </>}
    {error && <p className="uwm-feedback is-error" role="alert">{error}</p>}
    {message && <p className="uwm-feedback" role="status">{message}</p>}
  </section>;
}
