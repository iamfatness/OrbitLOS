"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { demoBrokerageId, brokerageRoles, brokerageUrl, defaultWorkspaceUrl, pilotSeatFull, pilotWalkthroughs, type BrokerageSettings } from "@/lib/brokerage-model";
import type { WorkspaceStaff } from "@/lib/staff-store";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";
import { PilotBenchmarks } from "./pilot-benchmarks";
import { StaffOffboarding } from "./staff-offboarding";
import type { DepartureItem } from "@/lib/offboarding-model";
import { TeamLoanAssignment } from "./loan-assignment";
import { ManageDocumentTemplates } from "./document-checklist-templates";
import { ManageFeeTemplates } from "./fee-templates";
import { ManagePreapprovalTemplates } from "./preapproval-template-settings";
import { ManagePreapprovalPolicy } from "./preapproval-policy-settings";
import { BrokerageBranches } from "./brokerage-branches";
import { PilotSupportRequests } from "./pilot-support-requests";

const teamPanels = ["Staff access", "Branches", "Loan settings", "Workspaces", "Pilot tools", "Support requests", "Access history"] as const;
export type TeamPanel = (typeof teamPanels)[number];

export function BrokerageTeam({ staff, version, panel, setPanel, refresh, openLoan, openDepartureWork, openRouting }: {
  staff: WorkspaceStaff; version: object; refresh: () => Promise<void>; openLoan: (id: string, target?: string) => void;
  openDepartureWork: (item: DepartureItem) => void; panel: TeamPanel; setPanel: (panel: TeamPanel) => void;
  openRouting: () => void;
}) {
  const endpoint = `/api/brokerages?brokerage=${staff.brokerage.id}`;
  const [settings, setSettings] = useState<BrokerageSettings | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const [invitation, setInvitation] = useState<{ email: string; role: string }>();
  const [seatDraft, setSeatDraft] = useState<string | null>(null);
  const seatEditor = useRef<HTMLButtonElement>(null);
  const seatAttempt = useRef<{ key: string; id: string } | null>(null);
  const [inviteAttempt, setInviteAttempt] = useState<{ key: string; id: string } | null>(null);
  const [invitationCopy, setInvitationCopy] = useState<{ email: string; url: string; copied: boolean }>();
  const [workspaceSearch, setWorkspaceSearch] = useState("");
  const [offboardingEmail, setOffboardingEmail] = useState<string | null>(null);
  const offboardingReturn = useRef<string | null>(null);
  const creating = useRef<string | null>(null);
  const scenarioAttempt = useRef<{ key: string; id: string } | null>(null);
  const resetButton = useRef<HTMLButtonElement>(null);
  const feedback = useRef<HTMLParagraphElement>(null);
  const inviteFeedback = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (message) feedback.current?.focus(); }, [message]);
  useEffect(() => { if (invitation) inviteFeedback.current?.focus(); }, [invitation]);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const measurementAttempt = useRef<{ id: string; fields: string } | null>(null);
  const admin = staff.brokerage.role === "Admin";
  const pilot = staff.brokerage.pilot;
  const canUseSampleTools = pilot || staff.brokerage.id === demoBrokerageId;
  const panels = teamPanels.filter((item) => item === "Support requests" ? pilot :
    (item !== "Branches" && item !== "Pilot tools") || canUseSampleTools);
  const activePanel = panels.includes(panel) ? panel : "Staff access";
  const activeMembers = settings?.members.filter((member) => member.status === "Active") ?? [];
  const scenarioOwners = activeMembers.filter((member) => member.role !== "Processor");
  const explorationOwners = settings?.members.filter(member => member.role !== "Processor" &&
    (member.status === "Active" || member.status === "Invited")) ?? [];
  const scenario = settings?.pilotScenario;
  const seats = settings?.seatCapacity;
  const otherWorkspaces = settings?.brokerages.filter(item => item.id !== staff.brokerage.id) ?? [];
  const sampleWorkspaces = otherWorkspaces.filter(item => item.pilot || item.id === demoBrokerageId);
  const operationalWorkspaces = otherWorkspaces.filter(item => !item.pilot && item.id !== demoBrokerageId);
  const matchingSamples = sampleWorkspaces.filter(item => `${item.name} ${item.id}`.toLowerCase().includes(workspaceSearch.trim().toLowerCase()));


  useEffect(() => {
    const controller = new AbortController();
    fetch(endpoint, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("Reload the workspace to check your brokerage access.");
      setSettings(await response.json());
    }).catch((failure: Error) => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [endpoint]);

  async function reloadTeam() {
    const current = await fetch(endpoint);
    if (!current.ok) throw new Error("Reload Team to check current brokerage access.");
    const updated = await current.json() as BrokerageSettings;
    setSettings(updated);
    return updated;
  }

  async function refreshAccess() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await reloadTeam();
      setMessage("Staff access refreshed.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not refresh staff access."); }
    finally { setBusy(false); }
  }

  async function change(action: Record<string, unknown>, reset?: () => void, onError?: (message: string) => void) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const capacityAction = action.type === "setPilotSeatLimit" || action.type === "cancelInvitation" ||
        (action.type === "invite" && Boolean(action.operationId));
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action) })
        .catch(() => { throw new Error("Orbit could not confirm the change. Try again or refresh staff access."); });
      const result = await response.json() as { error?: string; created?: string; message?: string };
      if (!response.ok) {
        if (capacityAction && response.status === 409) {
          if (action.type === "invite") setInviteAttempt(null);
          await reloadTeam().catch(() => undefined);
        }
        throw new Error(result.error ?? "Orbit could not save this change.");
      }
      if (result.created) { window.location.assign(brokerageUrl(result.created)); return; }
      if (action.type === "invite" && typeof action.email === "string" && typeof action.role === "string") {
        setInvitation({ email: action.email.trim().toLowerCase(), role: action.role });
        setInvitationCopy(undefined);
        reset?.();
        await reloadTeam();
        return;
      }
      if ((action.type === "role" || action.type === "revoke") && action.email === staff.email) {
        window.location.assign(action.type === "revoke" ? "/workspace" : brokerageUrl(staff.brokerage.id));
        return;
      }
      if (action.type === "loadPilotScenario" || action.type === "loadPilotExploration" || action.type === "role" || action.type === "revoke") await refresh();
      await reloadTeam();
      if (!onError) setMessage(result.message ?? "Saved.");
      reset?.();
    } catch (failure) { (onError ?? setError)(failure instanceof Error ? failure.message : "Orbit could not save this change."); }
    finally { setBusy(false); }
  }

  function saveSeatLimit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !seats || seatDraft === null) return;
    const limit = seatDraft.trim() === "" ? null : Number(seatDraft);
    if (limit !== null && (!Number.isSafeInteger(limit) || limit < 1)) {
      setError("Enter a positive whole number or leave the seat limit blank.");
      return;
    }
    const key = JSON.stringify([seats.revision, limit]);
    if (seatAttempt.current?.key !== key) seatAttempt.current = { key, id: crypto.randomUUID() };
    void change({ type: "setPilotSeatLimit", limit, revision: seats.revision, operationId: seatAttempt.current.id }, () => {
      seatAttempt.current = null;
      setSeatDraft(null);
    });
  }

  function saveInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const email = String(fields.get("email")).trim().toLowerCase();
    const role = fields.get("role");
    const key = JSON.stringify([staff.brokerage.id, email, role]);
    const retry = inviteAttempt?.key === key ? inviteAttempt : null;
    if (seats?.remaining === 0 && !retry) {
      setError(pilotSeatFull);
      return;
    }
    const attempt = seats ? retry ?? { key, id: crypto.randomUUID() } : null;
    setInviteAttempt(attempt);
    void change({ type: "invite", email, role, operationId: attempt?.id }, () => {
      setInviteAttempt(null);
      form.reset();
    });
  }

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    creating.current ??= crypto.randomUUID();
    void change({ type: "create", name: fields.get("name"), id: creating.current, pilot: fields.has("pilot") });
  }

  function loadScenario(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (scenario && !confirmingReset) { setConfirmingReset(true); return; }
    const fields = new FormData(event.currentTarget);
    const officerEmail = fields.get("officerEmail");
    const presenter = fields.has("presenter");
    const previousId = scenario?.id ?? null;
    const key = JSON.stringify({ previousId, officerEmail, presenter });
    if (scenarioAttempt.current?.key !== key) scenarioAttempt.current = { key, id: crypto.randomUUID() };
    void change({ type: "loadPilotScenario", id: scenarioAttempt.current.id, previousId, officerEmail, presenter }, () => {
      scenarioAttempt.current = null;
      setConfirmingReset(false);
    });
  }

  async function copyWorkspace() {
    try {
      await navigator.clipboard.writeText(new URL(brokerageUrl(staff.brokerage.id), window.location.origin).href);
      setCopyStatus("Workspace link copied.");
    } catch { setCopyStatus("Copy the workspace address from your browser."); }
  }

  async function copyInvitation(email: string) {
    const signIn = new URL("/login", window.location.origin);
    signIn.searchParams.set("brokerage", staff.brokerage.id);
    const url = signIn.href;
    try {
      await navigator.clipboard.writeText(url);
      setInvitationCopy({ email, url, copied: true });
    } catch { setInvitationCopy({ email, url, copied: false }); }
  }

  function invitationLink(email: string, primary = false) {
    const status = invitationCopy?.email === email ? invitationCopy : undefined;
    return <div className="record-form">
      <div><Button size="sm" className="min-h-11" variant={primary ? "default" : "outline"} onClick={() => void copyInvitation(email)}>Copy sign-in link</Button></div>
      {status?.copied && <p role="status" className="muted">Sign-in link copied. Share it with {email}.</p>}
      {status && !status.copied && <label className="field">Copy this sign-in link
        <input readOnly value={status.url} onFocus={(event) => event.target.select()} /></label>}
    </div>;
  }

  return <div className="relationship-stack">
    {admin && <nav className="loan-application-actions team-panel-nav" aria-label="Team views">
      {panels.map((item) => <Button key={item} size="sm" variant={activePanel === item ? "default" : "outline"}
        aria-current={activePanel === item ? "page" : undefined} disabled={busy} onClick={() => {
          setPanel(item);
          setConfirmingReset(false);
          setCopyStatus("");
          setInvitation(undefined);
          setInvitationCopy(undefined);
        }}>{item}</Button>)}
    </nav>}
    {!settings && !error && <p className="muted" role="status">Loading team…</p>}
    {(!admin || activePanel === "Workspaces") && <section className="pipeline relationship-panel" aria-label="Brokerage workspaces">
      <div className="section-heading"><h2>{staff.brokerage.name}</h2><span className="pill">{pilot ? "Pilot · " : ""}{staff.brokerage.role}</span></div>
      {admin && pilot && <div className="loan-application-actions">
        <Button asChild variant="outline" size="sm"><a href={`/workspace-maintenance?brokerage=${staff.brokerage.id}`}>Workspace maintenance</a></Button>
        <Button asChild variant="outline" size="sm"><a href={`/workspace-maintenance?brokerage=${staff.brokerage.id}#pilot-support-report`}>Support report</a></Button>
      </div>}
      <p className="muted">Current workspace · {canUseSampleTools ? "Fictional data and practice workflows" : "Operational workspace"}</p>
      <div className="loan-application-actions">
        <Button asChild variant="outline" size="sm"><a href={defaultWorkspaceUrl(staff.brokerage.id)}>Make this my default</a></Button>
        <Button variant="outline" size="sm" onClick={()=>void copyWorkspace()}>Copy workspace link</Button>
      </div>
      {copyStatus && <p role="status">{copyStatus}</p>}
      {!!(operationalWorkspaces.length || sampleWorkspaces.length) && <p className="muted">Opening another workspace keeps your sign-in default.</p>}
      {!!operationalWorkspaces.length && <div className="workspace-list"><h3>Operational workspaces</h3>{operationalWorkspaces.map(item =>
        <a className="workspace-list-item" key={item.id} href={brokerageUrl(item.id)}><strong>{item.name}</strong><span>{item.role}{item.maintenance ? " · Paused" : ""}</span></a>)}</div>}
      {!!sampleWorkspaces.length && <details className="workspace-samples"><summary>Demo &amp; test workspaces ({sampleWorkspaces.length})</summary>
        <label className="field">Find a demo or test workspace<input type="search" value={workspaceSearch} onChange={event=>setWorkspaceSearch(event.target.value)} placeholder="Search by name or reference"/></label>
        <div className="workspace-list">{matchingSamples.map(item => <a className="workspace-list-item" key={item.id} href={brokerageUrl(item.id)}>
          <strong>{item.name}</strong><span>{item.role} · {item.id === demoBrokerageId ? "Demo" : "Test"}{item.maintenance ? " · Paused" : ""} · {item.id.slice(0,8)}</span></a>)}</div>
        {!matchingSamples.length && <p role="status">No matching workspaces.</p>}
      </details>}
      {admin && <details className="document-form"><summary>Create brokerage</summary><form onSubmit={create}>
        <label className="field">Brokerage name<input name="name" required minLength={2} maxLength={80} /></label>
        <label className="demo-confirm"><input name="pilot" type="checkbox" /> Create as a fictional pilot workspace</label>
        <Button type="submit" size="sm" disabled={busy}>Create workspace</Button>
      </form></details>}
    </section>}
    {error && <div className="loan-application-actions">
      <p role="alert" className="application-message banner-error">{error}</p>
      {!settings && <Button size="sm" variant="outline" onClick={() => {
        setError("");
        void reloadTeam().catch((failure: Error) => setError(failure.message));
      }}>Retry loading team</Button>}
    </div>}
    {message && <p ref={feedback} tabIndex={-1} role="status" className="application-message">{message}</p>}
    {admin && settings && activePanel === "Branches" && canUseSampleTools && <BrokerageBranches key={`branches-${staff.brokerage.id}`} endpoint={endpoint}
      members={settings.members} refreshTeam={reloadTeam} openRouting={openRouting} />}
    {admin && settings && activePanel === "Pilot tools" && canUseSampleTools && <section className="pipeline relationship-panel" aria-label="Demo examples">
        <details className="document-form"><summary>Self-guided demo examples</summary>
          <p className="muted">Populate Today, Calendar, Lead Inbox, and the daily workspace with linked fictional records.</p>
          <form className="brokerage-form" onSubmit={(event) => {
            event.preventDefault();
            const fields = new FormData(event.currentTarget);
            void change({ type: "loadPilotExploration", officerEmail: fields.get("officerEmail"), processorEmail: fields.get("processorEmail") || null });
          }}>
            <label className="field">Loan officer for demo examples<select name="officerEmail" required defaultValue={staff.email}>
              {explorationOwners.map(member => <option key={member.email} value={member.email}>{member.name === member.email ? member.email : `${member.name} · ${member.email}`}{member.status === "Invited" ? " · Invited" : ""}</option>)}
            </select></label>
            <label className="field">Processor for demo examples<select name="processorEmail" defaultValue="">
              <option value="">Assign processing later</option>
              {activeMembers.filter(member => member.role === "Processor").map(member => <option key={member.email} value={member.email}>{member.name} · {member.email}</option>)}
            </select></label>
            <p className="muted">Adds examples once per loan officer. Run again to refresh unchanged sample dates.</p>
            <Button size="sm" type="submit" disabled={busy}>Add or refresh demo examples</Button>
          </form>
        </details>
    </section>}
    {pilot && (!admin || activePanel === "Pilot tools") && <section className="pipeline relationship-panel" aria-label="Pilot scenario">
      <h2>Pilot scenario</h2>
      <p className="muted">Use fictional borrowers and built-in files. UWM, verification email, and scanning are simulated here.</p>
      {admin && settings && <>
        {scenario && <p className="muted">{scenario.presenter ? "Presenter scenario" : "Standard scenario"} loaded {dateTime(scenario.loadedAt)} ET for {scenario.officerEmail}.</p>}
        <form className="brokerage-form" onSubmit={loadScenario} key={scenario?.id ?? "new"}>
          <label className="field">Assign the scenario to<select name="officerEmail" required defaultValue={scenarioOwners.some((member) => member.email === scenario?.officerEmail) ? scenario?.officerEmail : staff.email}>
            {scenarioOwners.map((member) => <option key={member.email} value={member.email}>{member.name} · {member.email}</option>)}
          </select></label>
          <label className="demo-confirm"><input name="presenter" type="checkbox" defaultChecked={scenario?.presenter} /> Include dashboard examples for the presenter walkthrough</label>
          {confirmingReset && <p className="muted" role="status" id="scenario-reset-summary">This replaces the sample loans and referrals and closes their old links. Staff access, activity, and feedback stay available.</p>}
          <div className="loan-application-actions">
            <Button ref={resetButton} size="sm" type="submit" disabled={busy || !scenarioOwners.length} aria-describedby={confirmingReset ? "scenario-reset-summary" : undefined}>
              {confirmingReset ? "Confirm scenario reset" : scenario ? "Reset fictional scenario" : "Load fictional scenario"}</Button>
            {confirmingReset && <Button size="sm" variant="outline" type="button" disabled={busy} onClick={() => {
              setConfirmingReset(false);
              resetButton.current?.focus();
            }}>Cancel reset</Button>}
          </div>
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
    {pilot && admin && settings && activePanel === "Pilot tools" && <section className="pipeline relationship-panel" aria-label="Pilot measurements">
      <h2>Pilot measurements</h2>
      <ul>{settings.pilotMetrics?.map((item) => <li key={item.label}>{item.label} · {item.minutes === null ? "No completed samples" :
        `${item.minutes.toFixed(1)} min average across ${item.count} completed samples`}</li>)}</ul>
      <PilotBenchmarks benchmarks={settings.pilotBenchmarks ?? []} pending={settings.pendingPilotBenchmarks ?? []} busy={busy} save={change} />
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
    {pilot && (!admin || activePanel === "Support requests") &&
      <PilotSupportRequests key={staff.brokerage.id} endpoint={endpoint} admin={admin} members={activeMembers} refreshMembers={reloadTeam} />}
    {admin && settings && activePanel === "Staff access" &&
      <section className="pipeline relationship-panel team-access-panel" aria-label="Staff access">
        <div className="section-heading team-access-heading"><h2>Staff access</h2>
          <Button size="sm" className="min-h-11" variant="outline" aria-disabled={busy} onClick={() => { if (!busy) void refreshAccess(); }}>Refresh staff access</Button></div>
        {seats && <section className="pilot-seat-capacity" aria-labelledby="pilot-seat-heading">
          <div className="section-heading team-access-heading">
            <h3 id="pilot-seat-heading">Pilot seats</h3>
            {seatDraft === null && <Button ref={seatEditor} size="sm" className="min-h-11" variant="outline" disabled={busy}
              onClick={() => setSeatDraft(seats.limit?.toString() ?? "")}>Edit seat limit</Button>}
          </div>
          <dl className="pilot-seat-counts">
            <div><dt>Active staff</dt><dd>{seats.active}</dd></div>
            <div><dt>Pending invites</dt><dd>{seats.reserved}</dd></div>
            <div><dt>Seats left</dt><dd>{seats.remaining ?? "No limit"}</dd></div>
          </dl>
          {seatDraft === null ? <p className="muted">{seats.limit === null ? "Pending invitations reserve a seat." :
            `${seats.limit} total seats. Pending invitations reserve a seat.`}</p> :
            <form className="brokerage-form" onSubmit={saveSeatLimit}>
              <label className="field">Total seat limit<input type="number" min={1} step={1} value={seatDraft} autoFocus
                aria-describedby="pilot-seat-limit-help" onChange={event => setSeatDraft(event.target.value)} /></label>
              <Button type="submit" size="sm" className="min-h-11" disabled={busy}>Save seat limit</Button>
              <Button size="sm" className="min-h-11" variant="ghost" disabled={busy} onClick={() => {
                setSeatDraft(null);
                requestAnimationFrame(() => seatEditor.current?.focus());
              }}>Cancel</Button>
              <p id="pilot-seat-limit-help" className="muted">Leave blank for no limit. Active staff and pending invitations each use one seat.</p>
            </form>}
          {seats.remaining === 0 && <p className="muted" role="status" id="pilot-seats-full">{pilotSeatFull}</p>}
        </section>}
        <p className="muted">Invite staff using their existing email address. Share the sign-in link after saving.</p>
        <form className="brokerage-form staff-invite-form" onSubmit={saveInvitation}>
          <label className="field staff-invite-address">Email address<input name="email" type="email" autoComplete="off" required maxLength={254} /></label>
          <label className="field">Invite role<select name="role" defaultValue="LO" aria-describedby="invite-role-help">{brokerageRoles.map((role) => <option key={role}>{role}</option>)}</select></label>
          <Button type="submit" size="sm" className="min-h-10" aria-describedby={seats?.remaining === 0 ? "pilot-seats-full" : undefined}
            disabled={busy || (seats?.remaining === 0 && !inviteAttempt)}>Save invitation</Button>
        </form>
        <p id="invite-role-help" className="muted">LOs start in Today. Processors start in Processing with their assigned files. Admins start in the brokerage overview and can manage staff access.</p>
        {invitation && !settings.members.some((member) => member.email === invitation.email && member.status !== "Invited") &&
          <section className="document-item record-form staff-invite-feedback" aria-label="Saved invitation">
            <p ref={inviteFeedback} tabIndex={-1} role="status"><strong>Invitation saved</strong> · {invitation.email} · {invitation.role}</p>
            <p className="muted">Access activates when they sign in with the invited email address.</p>
            {invitationLink(invitation.email, true)}
          </section>}
        <ul className="document-list">{settings.members.map((member) => <li className="document-item" key={member.email}>
          <div className="document-item-head"><strong>{member.email}</strong><span className="pill">{member.status}</span></div>
          {member.status === "Invited" && member.email !== invitation?.email && invitationLink(member.email)}
          {member.status !== "Revoked" && <form className="brokerage-form" key={member.role} onSubmit={(event) => {
            event.preventDefault();
            void change({ type: "role", email: member.email, role: new FormData(event.currentTarget).get("role") });
          }}>
            <label className="field">Staff role<select name="role" defaultValue={member.role}>{brokerageRoles.map((role) => <option key={role}>{role}</option>)}</select></label>
            <Button type="submit" size="sm" variant="outline" disabled={busy}>Save role</Button>
            {member.status === "Invited" && <Button size="sm" variant="ghost" disabled={busy} onClick={() => {
              if (window.confirm(`Cancel the invitation for ${member.email}?`)) void change({
                type: "cancelInvitation", email: member.email, expectedAccessRevision: member.accessRevision ?? 0,
              });
            }}>Cancel invitation</Button>}
          </form>}
          {member.status !== "Invited" && offboardingEmail !== member.email && <Button size="sm" variant="outline" disabled={busy}
            ref={(button) => {
              if (button && offboardingReturn.current === member.email) {
                button.focus();
                offboardingReturn.current = null;
              }
            }} onClick={() => setOffboardingEmail(member.email)}>{member.status === "Revoked" ? "Recover open work" : "Review offboarding"}</Button>}
          {member.status !== "Invited" && offboardingEmail === member.email && <StaffOffboarding key={member.email} email={member.email}
            viewer={staff.email} endpoint={endpoint} members={settings.members} open={openDepartureWork} onRevoke={async () => { await reloadTeam(); }} onClose={() => {
              offboardingReturn.current = member.email;
              setOffboardingEmail(null);
              void Promise.all([reloadTeam(), refresh()]).catch((failure: Error) => setError(failure.message));
            }} />}
        </li>)}</ul>
      </section>}
    {admin && settings && activePanel === "Loan settings" && <>
      <TeamLoanAssignment brokerageId={staff.brokerage.id} version={version} openLoan={openLoan} onChanged={() => {
        void Promise.all([refresh(), reloadTeam()]).catch(() => setError("Assignment saved. Refresh Team to see the latest access history."));
      }} />
      {canUseSampleTools && <ManageDocumentTemplates key={staff.brokerage.id} brokerageId={staff.brokerage.id} />}
      {canUseSampleTools && <ManagePreapprovalTemplates key={`preapproval-${staff.brokerage.id}`} brokerageId={staff.brokerage.id} />}
      {canUseSampleTools && <ManagePreapprovalPolicy key={`preapproval-policy-${staff.brokerage.id}`} brokerageId={staff.brokerage.id} openLoan={openLoan} />}
      <ManageFeeTemplates key={`fees-${staff.brokerage.id}`} brokerageId={staff.brokerage.id} />
    </>}
    {admin && settings && activePanel === "Access history" &&
      <section className="pipeline relationship-panel" aria-label={pilot ? "Pilot activity and access history" : "Access history"}>
        <h2>{pilot ? "Pilot activity and access history" : "Access history"}</h2>
        <ul className="document-list">{settings.history.map((event) => <li className="document-item" key={event.id}>
            <strong>{event.action}</strong>
            {event.loanName ? <div><button className="name-link" onClick={() => openLoan(event.subject)}>{event.loanName}</button></div> : <p>{event.subject}</p>}
            <small className="muted">{event.actor} · {dateTime(event.createdAt)} ET</small>
          </li>)}</ul>
        {!settings.history.length && <p className="muted">Staff and link changes will appear here.</p>}
      </section>}
  </div>;
}
