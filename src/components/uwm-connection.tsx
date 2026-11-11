"use client";
import { useState } from "react";
import { checkUwmConnection } from "@/app/actions";
import { Button } from "./ui/button";

export interface UwmConnectionStatus { pricing: string; pipeline: string; lenderActions: string }
export function UwmConnection({ connection, brokerageId, admin, overview = false }: { connection: UwmConnectionStatus; brokerageId?: string; admin: boolean; overview?: boolean }) {
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
  const services = [
    { name: "Pricing", detail: connection.pricing === "UWM stage API" ? "UWM test quotes · not a live offer" : connection.pricing === "Sample pricing" ? "Explore quotes with sample data" : "Lender pricing is not enabled yet", state: connection.pricing === "UWM stage API" ? "Test mode" : connection.pricing === "Sample pricing" ? "Demo" : "Setup needed" },
    { name: "Pipeline & conditions", detail: connection.pipeline === "UWM Insights" ? "Loan updates from UWM Insights" : connection.pipeline === "Sample pipeline" ? "Explore a sample loan pipeline" : "Requires a UWM Insights connection", state: connection.pipeline === "UWM Insights" ? "Connected" : connection.pipeline === "Sample pipeline" ? "Demo" : "Setup needed" },
    { name: "Submissions & locks", detail: connection.lenderActions === "Simulated" ? "Practice the workflow with sample data" : "Submit, deliver documents and lock in UWM for now", state: connection.lenderActions === "Simulated" ? "Demo" : "Not enabled" },
  ];
  return <div className={overview ? "uwm-services" : "document-form"}>
    {overview ? <><h3>Available services</h3><p className="uwm-section-description">Each service is enabled separately for your brokerage.</p>
      <ul className="uwm-service-list">{services.map(service => <li key={service.name}><div><strong>{service.name}</strong><p>{service.detail}</p></div><span className={`uwm-status ${service.state === "Connected" ? "is-ready" : ""}`}>{service.state}</span></li>)}</ul></>
      : <><p>Pricing · {connection.pricing}</p><p>Pipeline and conditions · {connection.pipeline}</p><p>Submissions, document delivery and locks · {connection.lenderActions}</p>
        {connection.pricing === "UWM stage API" && <p className="muted">Stage pricing comes from UWM&apos;s test environment. It is not a production offer or rate lock.</p>}
        {connection.lenderActions === "Onboarding required" && <p className="muted">Use your lender’s portal to price, submit, deliver documents, and lock. Record the quote and lender reference on the loan in Orbit.</p>}</>}
    {admin && brokerageId && connection.pricing === "UWM stage API" && <Button variant="outline" size="sm" disabled={busy} onClick={() => void verify()}>{busy ? "Verifying UWM…" : "Verify test pricing"}</Button>}
    {message && <p className="uwm-feedback" role="status">{message}</p>}
  </div>;
}
