"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { brokerageRoles, brokerageUrl, pilotFeedbackStatuses, pilotPriorities, pilotSteps, pilotWalkthroughs, type BrokerageSettings } from "@/lib/brokerage-model";
import type { Workspace } from "@/lib/model";
import type { WorkspaceStaff } from "@/lib/staff-store";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

export function BrokerageTeam({ staff, state, refresh, openLoan }: {
  staff: WorkspaceStaff; state: Workspace; refresh: () => Promise<void>; openLoan: (id: string) => void;
}) {
  const endpoint = `/api/brokerages?brokerage=${staff.brokerage.id}`;
  const [settings, setSettings] = useState<BrokerageSettings | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loanId, setLoanId] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const creating = useRef<string | null>(null);
  const feedbackAttempt = useRef<{ id: string; fields: string } | null>(null);
  const measurementAttempt = useRef<{ id: string; fields: string } | null>(null);
  const loan = state.loans.find((item) => item.id === loanId);
  const admin = staff.brokerage.role === "Admin";
  const pilot = staff.brokerage.pilot;
  const activeMembers = settings?.members.filter((member) => member.status === "Active") ?? [];
  const scenarioOwners = activeMembers.filter((member) => member.role !== "Processor");
  const scenario = settings?.pilotScenario;

  useEffect(() => {
    const controller = new AbortController();
    fetch(endpoint, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("Reload the workspace to check your brokerage access.");
      setSettings(await response.json());
    }).catch((failure: Error) => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [endpoint]);

  async function change(action: Record<string, unknown>, reset?: () => void) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action) });
      const result = await response.json() as { error?: string; created?: string; message?: string };
      if (!response.ok) throw new Error(result.error ?? "Orbit could not save this change.");
      if (result.created) { window.location.assign(brokerageUrl(result.created)); return; }
      if ((action.type === "role" || action.type === "revoke") && action.email === staff.email) {
        window.location.assign(action.type === "revoke" ? "/workspace" : brokerageUrl(staff.brokerage.id));
        return;
      }
      if (action.type === "assign" || action.type === "loadPilotScenario") await refresh();
      const current = await fetch(endpoint);
      if (!current.ok) throw new Error("The change was saved. Reload to check your brokerage access.");
      setSettings(await current.json());
      setMessage(result.message ?? "Saved.");
      reset?.();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Orbit could not save this change."); }
    finally { setBusy(false); }
  }

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    creating.current ??= crypto.randomUUID();
    void change({ type: "create", name: fields.get("name"), id: creating.current, pilot: fields.has("pilot") });
  }

  function loadScenario(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const officerEmail = new FormData(event.currentTarget).get("officerEmail");
    if (scenario && !window.confirm("Reset the fictional scenario? This replaces its sample loans and referrals and closes their old links. Staff access, activity, and feedback stay available.")) return;
    void change({ type: "loadPilotScenario", id: crypto.randomUUID(), previousId: scenario?.id ?? null, officerEmail });
  }

  function sendFeedback(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const fields = { step: data.get("step"), message: data.get("message") };
    const signature = JSON.stringify(fields);
    if (feedbackAttempt.current?.fields !== signature) feedbackAttempt.current = { id: crypto.randomUUID(), fields: signature };
    void change({ type: "pilotFeedback", ...fields, id: feedbackAttempt.current.id }, () => {
      form.reset();
      feedbackAttempt.current = null;
    });
  }

  async function copyWorkspace() {
    try {
      await navigator.clipboard.writeText(new URL(brokerageUrl(staff.brokerage.id), window.location.origin).href);
      setCopyStatus("Pilot workspace link copied.");
    } catch { setCopyStatus("Copy the pilot workspace address from your browser."); }
  }

  return <div className="relationship-stack">
    <section className="pipeline relationship-panel" aria-label="Brokerage workspaces">
      <div className="section-heading"><h2>{staff.brokerage.name}</h2><span className="pill">{pilot ? "Pilot · " : ""}{staff.brokerage.role}</span></div>
      <div className="loan-application-actions">{settings?.brokerages.filter((item) => item.id !== staff.brokerage.id).map((item) =>
        <Button key={item.id} asChild size="sm" variant="outline"><a href={brokerageUrl(item.id)}>Open {item.name}</a></Button>)}</div>
      {admin && <details className="document-form"><summary>Create brokerage</summary><form onSubmit={create}>
        <label className="field">Brokerage name<input name="name" required minLength={2} maxLength={80} /></label>
        <label className="demo-confirm"><input name="pilot" type="checkbox" /> Create as a fictional pilot workspace</label>
        <Button type="submit" size="sm" disabled={busy}>Create workspace</Button>
      </form></details>}
    </section>
    {error && <p role="alert" className="application-message banner-error">{error}</p>}
    {message && <p role="status" className="application-message">{message}</p>}
    {pilot && <section className="pipeline relationship-panel" aria-label="Pilot scenario">
      <h2>Pilot scenario</h2>
      <p className="muted">Use fictional borrowers and built-in files. UWM, verification email, and scanning are simulated here.</p>
      {admin && settings && <>
        {scenario && <p className="muted">Loaded {dateTime(scenario.loadedAt)} ET for {scenario.officerEmail}.</p>}
        <form className="brokerage-form" onSubmit={loadScenario} key={scenario?.id ?? "new"}>
          <label className="field">Assign the scenario to<select name="officerEmail" required defaultValue={scenarioOwners.some((member) => member.email === scenario?.officerEmail) ? scenario?.officerEmail : staff.email}>
            {scenarioOwners.map((member) => <option key={member.email} value={member.email}>{member.name} · {member.email}</option>)}
          </select></label>
          <Button size="sm" type="submit" disabled={busy || !scenarioOwners.length}>{scenario ? "Reset fictional scenario" : "Load fictional scenario"}</Button>
        </form>
        <div><Button variant="outline" size="sm" onClick={() => void copyWorkspace()}>Copy pilot workspace link</Button></div>
        {copyStatus && <p role="status" className="muted">{copyStatus}</p>}
      </>}
      <ol className="pilot-walkthrough">
        <li>Open <strong>Tasks → My Tasks</strong> and convert Riley Pilot Referral. You can also start from <strong>New Lead</strong>.</li>
        <li>Open the 1003, load sample answers, and submit. Review it on the loan, then price and share a sample quote.</li>
        <li>Send the reviewed application to mock UWM and request a condition document. Use a demo code and try the blocked and clean PDFs.</li>
        <li>Accept the clean PDF, record mock delivery, and check UWM clearance from the checklist.</li>
      </ol>
    </section>}
    {pilot && admin && settings && <section className="pipeline relationship-panel" aria-label="Pilot measurements">
      <h2>Pilot measurements</h2>
      <ul>{settings.pilotMetrics?.map((item) => <li key={item.label}>{item.label} · {item.minutes === null ? "No completed samples" :
        `${item.minutes.toFixed(1)} min average across ${item.count} completed samples`}</li>)}</ul>
      <details className="loan-task-create"><summary>Record a timed walkthrough</summary>
        <form className="record-form" onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          const input = { type: "recordPilotMeasurement", walkthrough: data.get("walkthrough"), workflow: data.get("workflow"),
            seconds: Number(data.get("seconds")), repeatEntries: Number(data.get("repeatEntries")), systemSwitches: Number(data.get("systemSwitches")) };
          const fields = JSON.stringify(input);
          if (measurementAttempt.current?.fields !== fields) measurementAttempt.current = { id: crypto.randomUUID(), fields };
          void change({ ...input, id: measurementAttempt.current.id }, () => { measurementAttempt.current = null; form.reset(); });
        }}>
          <label className="field">Walkthrough<select name="walkthrough">{pilotWalkthroughs.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label className="field">Workflow<select name="workflow"><option>Orbit</option><option>Current brokerage workflow</option></select></label>
          <div className="form-grid">
            <label className="field">Elapsed seconds<input type="number" name="seconds" required min={1} max={86400} /></label>
            <label className="field">Fields entered again<input type="number" name="repeatEntries" required min={0} max={2000} defaultValue={0} /></label>
            <label className="field">System switches<input type="number" name="systemSwitches" required min={0} max={2000} defaultValue={0} /></label>
          </div>
          <div><Button size="sm" type="submit" disabled={busy}>Save walkthrough measurement</Button></div>
        </form>
      </details>
      {!!settings.pilotMeasurements?.length && <div className="table-scroll"><table className="data-table">
        <thead><tr><th>Walkthrough</th><th>Workflow</th><th>Elapsed</th><th>Repeated fields</th><th>Switches</th></tr></thead>
        <tbody>{settings.pilotMeasurements.map((entry) => <tr key={entry.id}>
          <td>{entry.walkthrough}<small>{dateTime(entry.createdAt)} ET</small></td><td>{entry.workflow}</td>
          <td>{entry.seconds}s</td><td>{entry.repeatEntries}</td><td>{entry.systemSwitches}</td>
        </tr>)}</tbody>
      </table></div>}
    </section>}
    {pilot && <section className="pipeline relationship-panel" aria-label="Pilot feedback">
      <h2>Pilot feedback</h2>
      <p className="muted">Describe the workflow and what happened using fictional examples. Keep application answers, links, and documents out of feedback.</p>
      <form className="record-form" onSubmit={sendFeedback}>
        <label className="field">Workflow step<select name="step" required><option value="">Choose a step</option>
          {pilotSteps.map((step) => <option key={step}>{step}</option>)}
        </select></label>
        <label className="field">Feedback<textarea name="message" required maxLength={1000} rows={3} /></label>
        <div><Button size="sm" type="submit" disabled={busy}>Send pilot feedback</Button></div>
      </form>
      {admin && settings && (settings.pilotFeedback?.length ? <ul className="document-list">{settings.pilotFeedback.map((item) => <li className="document-item" key={item.id}>
        <div className="document-item-head"><strong>{item.step}</strong><span className="pill">{item.priority} · {item.status}</span></div>
        <p>{item.message}</p><small className="muted">{item.author} · {dateTime(item.createdAt)} ET</small>
        <details className="loan-task-create"><summary>Update feedback</summary>
          <form className="record-form" key={item.revision} onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            void change({ type: "triagePilotFeedback", id: item.id, revision: item.revision, owner: data.get("owner") || null,
              status: data.get("status"), priority: data.get("priority"), retest: data.get("retest") });
          }}>
            <label className="field">Issue owner<select name="owner" defaultValue={item.owner ?? ""}>
              <option value="">Unassigned</option>{activeMembers.map((member) => <option key={member.email} value={member.email}>{member.name} · {member.email}</option>)}
            </select></label>
            <label className="field">Priority<select name="priority" defaultValue={item.priority}>{pilotPriorities.map((value) => <option key={value}>{value}</option>)}</select></label>
            <label className="field">Issue status<select name="status" defaultValue={item.status}>{pilotFeedbackStatuses.map((value) => <option key={value}>{value}</option>)}</select></label>
            <label className="field">Retest result<textarea name="retest" maxLength={500} defaultValue={item.retest} rows={2} /></label>
            <div><Button type="submit" size="sm" disabled={busy}>Save feedback status</Button></div>
          </form>
        </details>
      </li>)}</ul> : <p className="muted">Staff feedback will appear here.</p>)}
    </section>}
    {admin && settings && <>
      <section className="pipeline relationship-panel" aria-label="Staff access">
        <h2>Staff access</h2><p className="muted">Invite by Google email, then share the workspace link. The invite activates when that account signs in.</p>
        <form className="brokerage-form" onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          void change({ type: "invite", email: data.get("email"), role: data.get("role") }, () => form.reset());
        }}>
          <label className="field">Google email<input name="email" type="email" required maxLength={254} /></label>
          <label className="field">Invite role<select name="role" defaultValue="LO">{brokerageRoles.map((role) => <option key={role}>{role}</option>)}</select></label>
          <Button type="submit" size="sm" disabled={busy}>Save invitation</Button>
        </form>
        <ul className="document-list">{settings.members.map((member) => <li className="document-item" key={member.email}>
          <div className="document-item-head"><strong>{member.email}</strong><span className="pill">{member.status}</span></div>
          {member.status !== "Revoked" && <form className="brokerage-form" key={member.role} onSubmit={(event) => {
            event.preventDefault();
            void change({ type: "role", email: member.email, role: new FormData(event.currentTarget).get("role") });
          }}>
            <label className="field">Staff role<select name="role" defaultValue={member.role}>{brokerageRoles.map((role) => <option key={role}>{role}</option>)}</select></label>
            <Button type="submit" size="sm" variant="outline" disabled={busy}>Save role</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => {
              if (window.confirm(`Revoke brokerage access for ${member.email}?`)) void change({ type: "revoke", email: member.email });
            }}>Revoke access</Button>
          </form>}
        </li>)}</ul>
      </section>
      <section className="pipeline relationship-panel" aria-label="Loan reassignment">
        <h2>Loan reassignment</h2><p className="muted">Open tasks follow the loan’s new owner.</p>
        <form className="brokerage-form" onSubmit={(event) => {
          event.preventDefault();
          if (loan) void change({ type: "assign", loanId: loan.id, previousEmail: loan.officerEmail, email: new FormData(event.currentTarget).get("email") });
        }}>
          <label className="field">Loan<select value={loanId} onChange={(event) => setLoanId(event.target.value)} required><option value="">Choose a loan</option>
            {state.loans.map((item) => <option key={item.id} value={item.id}>{state.contacts.find((contact) => contact.id === item.contactId)?.name} · {item.address || item.stage}</option>)}</select></label>
          <label className="field">New owner<select name="email" required defaultValue=""><option value="">Choose active staff</option>
            {settings.members.filter((member) => member.status === "Active").map((member) => <option value={member.email} key={member.email}>{member.email}</option>)}</select></label>
          <Button type="submit" size="sm" disabled={busy || !loan}>Reassign loan</Button>
        </form>
        {loan && <p className="muted">Current owner {loan.officerEmail ?? (loan.officer || "Unassigned")}</p>}
      </section>
      <section className="pipeline relationship-panel" aria-label={pilot ? "Pilot activity and access history" : "Access history"}>
        <h2>{pilot ? "Pilot activity and access history" : "Access history"}</h2>
        <ul className="document-list">{settings.history.map((event) => {
          const subjectLoan = pilot && state.loans.find((loan) => loan.id === event.subject);
          const borrower = subjectLoan && state.contacts.find((contact) => contact.id === subjectLoan.contactId);
          return <li className="document-item" key={event.id}>
            <strong>{event.action}</strong>
            {subjectLoan && borrower ? <div><button className="name-link" onClick={() => openLoan(subjectLoan.id)}>{borrower.name}</button></div> : <p>{event.subject}</p>}
            <small className="muted">{event.actor} · {dateTime(event.createdAt)} ET</small>
          </li>;
        })}</ul>
        {!settings.history.length && <p className="muted">Staff and link changes will appear here.</p>}
      </section>
    </>}
  </div>;
}
