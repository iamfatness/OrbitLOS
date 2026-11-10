"use client";
import { useState } from "react";
import { checkUwmConnection } from "@/app/actions";
import { Button } from "./ui/button";

export interface UwmConnectionStatus { pricing: string; pipeline: string; lenderActions: string }
export function UwmConnection({ connection, brokerageId, admin }: { connection: UwmConnectionStatus; brokerageId?: string; admin: boolean }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function verify() {
    if (!brokerageId) return;
    setBusy(true);
    try {
      const result = await checkUwmConnection(brokerageId);
      setMessage(result.error ?? result.message ?? "UWM verification failed.");
    } catch { setMessage("UWM verification could not complete. Try again."); }
    finally { setBusy(false); }
  }
  return <div className="document-form">
    <p>Pricing · {connection.pricing}</p><p>Pipeline and conditions · {connection.pipeline}</p>
    <p>Submissions, document delivery and locks · {connection.lenderActions}</p>
    <p className="muted">Stage pricing comes from UWM&apos;s test environment. It is not a production offer or rate lock.</p>
    {admin && brokerageId && <Button variant="outline" disabled={busy} onClick={() => void verify()}>{busy ? "Verifying UWM…" : "Verify UWM connection"}</Button>}
    {message && <p role="status">{message}</p>}
  </div>;
}
