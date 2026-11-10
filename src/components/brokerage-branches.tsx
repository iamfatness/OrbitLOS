"use client";

import { useEffect, useRef, useState } from "react";
import { branchLimit, branchStaffCurrent, branchStaffLimit, type BranchChange, type BrokerageBranch } from "@/lib/branch-model";
import type { VersionedBrokerageMember } from "@/lib/brokerage-model";
import { Button } from "./ui/button";

type BranchDraft = Extract<BranchChange, { type: "saveBranch" }>;

async function branchRequest<Result extends object>(endpoint: string, options?: RequestInit) {
  const response = await fetch(endpoint, options);
  const result = await response.json() as Result | { error: string };
  if ("error" in result || !response.ok) throw new Error("error" in result ? result.error : "Orbit could not load or save branches.");
  return result;
}

export function BrokerageBranches({ endpoint, members, refreshHistory }: {
  endpoint: string; members: VersionedBrokerageMember[]; refreshHistory: () => Promise<void>;
}) {
  const [branches, setBranches] = useState<BrokerageBranch[]>();
  const [draft, setDraft] = useState<BranchDraft>();
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState<{ message: string } | { error: string }>();
  const [busy, setBusy] = useState(false);
  const formName = useRef<HTMLInputElement>(null);
  const add = useRef<HTMLButtonElement>(null);
  const noticeElement = useRef<HTMLParagraphElement>(null);
  const readEndpoint = `${endpoint}&view=branches`;
  const eligible = members.filter(({ status }) => status !== "Revoked");
  const owners = eligible.filter(({ email, role, status }) => draft?.staffEmails.includes(email) && role !== "Processor" && status === "Active");
  const shown = eligible.filter(({ email, name }) => `${name} ${email}`.toLowerCase().includes(search.toLowerCase().trim()));

  useEffect(() => {
    const controller = new AbortController();
    void branchRequest<{ branches: BrokerageBranch[] }>(readEndpoint, { signal: controller.signal })
      .then(({ branches }) => setBranches(branches), (error: Error) => { if (!controller.signal.aborted) setNotice({ error: error.message }); });
    return () => controller.abort();
  }, [readEndpoint]);

  useEffect(() => { if (draft?.id) formName.current?.focus(); }, [draft?.id]);
  useEffect(() => { if (notice && "message" in notice) noticeElement.current?.focus(); }, [notice]);

  function edit(branch?: BrokerageBranch) {
    setNotice(undefined);
    setSearch("");
    const staffEmails = branch?.staff.filter((entry) => eligible.some(({ email }) => email === entry.email)).map(({ email }) => email) ?? [];
    const owner = eligible.find(({ email }) => email === branch?.ownerEmail);
    setDraft({ type: "saveBranch", id: branch?.id ?? crypto.randomUUID(), revision: branch?.revision ?? 0,
      name: branch?.name ?? "", staffEmails, ownerEmail: owner?.status === "Active" && owner.role !== "Processor" ? owner.email : null });
  }

  async function reload() {
    setBusy(true);
    try {
      const result = await branchRequest<{ branches: BrokerageBranch[] }>(readEndpoint);
      setBranches(result.branches);
      setDraft(undefined);
      setNotice(undefined);
    } catch (failure) { setNotice({ error: failure instanceof Error ? failure.message : "Could not reload branches." }); }
    finally { setBusy(false); }
  }

  async function save(input: BranchChange) {
    setBusy(true);
    setNotice(undefined);
    try {
      const result = await branchRequest<{ message: string }>(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
      });
      const refreshed = await branchRequest<{ branches: BrokerageBranch[] }>(readEndpoint);
      setBranches(refreshed.branches);
      setDraft(undefined);
      setNotice(result);
      void refreshHistory().catch(() => undefined);
    } catch (failure) { setNotice({ error: failure instanceof Error ? failure.message : "Could not save this branch." }); }
    finally { setBusy(false); }
  }

  function toggle(email: string, checked: boolean) {
    setDraft((current) => current && { ...current, staffEmails: checked ? [...current.staffEmails, email] : current.staffEmails.filter((item) => item !== email),
      ownerEmail: !checked && current.ownerEmail === email ? null : current.ownerEmail });
  }

  return <section className="pipeline relationship-panel branch-panel" aria-label="Branches">
    <div className="section-heading"><h2>Branches</h2>
      <Button className="min-h-11" ref={add} disabled={busy || !branches || branches.length >= branchLimit} onClick={() => edit()}>Add branch</Button></div>
    <p className="muted">Assign staff and choose a default LO for website ZIP rules. Existing loan access follows the loan assignment.</p>
    {notice && <p ref={noticeElement} tabIndex={-1} role={"error" in notice ? "alert" : "status"} className="application-message">
      {"error" in notice ? notice.error : notice.message}</p>}
    {!branches && !notice && <p role="status">Loading branches…</p>}
    {notice && "error" in notice && <div><Button size="sm" variant="outline" disabled={busy} onClick={() => void reload()}>Reload branches</Button></div>}
    {branches?.length === 0 && !draft && <p className="empty-inline">Add a branch to reuse its routing settings across intake profiles.</p>}
    {draft && <form className="record-form branch-editor" aria-label={draft.revision ? "Edit branch" : "New branch"} onSubmit={(event) => {
      event.preventDefault();
      if (!busy) void save(draft);
    }}>
      <h3 className="font-semibold">{draft.revision ? "Edit branch" : "New branch"}</h3>
      <label className="field">Branch name<input ref={formName} required minLength={2} maxLength={60} value={draft.name} disabled={busy}
        onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
      <fieldset className="record-form" disabled={busy}>
        <legend>Assigned staff · {draft.staffEmails.length}</legend>
        <p className="muted">Invited staff join this branch when they sign in.</p>
        {eligible.length > 8 && <label className="field">Find staff<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} /></label>}
        {shown.length ? <div className="branch-member-list">{shown.map(({ name, email, role, status }) => {
          const selected = draft.staffEmails.includes(email);
          return <label key={email} className="branch-member-option"><input type="checkbox" checked={selected}
            disabled={!selected && draft.staffEmails.length >= branchStaffLimit} onChange={(event) => toggle(email, event.target.checked)} />
            <span><strong>{name || email}</strong><small>{role}{status === "Invited" ? " · Invited" : ""}{name && name !== email ? ` · ${email}` : ""}</small></span></label>;
        })}</div> : <p className="muted">No staff match this search.</p>}
      </fieldset>
      <label className="field">Default branch LO<select value={draft.ownerEmail ?? ""} disabled={busy}
        onChange={(event) => setDraft({ ...draft, ownerEmail: event.target.value || null })}>
        <option value="">Shared inbox</option>
        {owners.map(({ email, name }) => <option key={email} value={email}>
          {name && owners.some((member) => member.email !== email && member.name === name) ? `${name} · ${email}` : name || email}
        </option>)}
      </select></label>
      <div className="loan-application-actions">
        <Button type="submit" className="min-h-11" disabled={busy || draft.name.trim().length < 2}>Save branch</Button>
        <Button className="min-h-11" variant="outline" disabled={busy} onClick={() => { setDraft(undefined); add.current?.focus(); }}>Cancel</Button>
      </div>
    </form>}
    {!!branches?.length && <ul className="document-list">{branches.map((branch) => {
      const current = branch.staff.filter((assignment) => branchStaffCurrent(assignment, members.find(({ email }) => email === assignment.email)));
      const owner = members.find(({ email, role, status }) => email === branch.ownerEmail && role !== "Processor" && status === "Active");
      const ownerReady = current.some(({ email }) => email === owner?.email);
      return <li key={branch.id} className="document-item record-form">
        <div className="document-item-head"><strong>{branch.name}</strong><span className="pill">{branch.active ? "Active" : "Archived"}</span></div>
        <p>{current.length} assigned · {branch.ownerEmail ? ownerReady ? `Default LO ${owner?.name || owner?.email}` : "Default LO needs review" : "Shared inbox"}</p>
        {current.length < branch.staff.length && <p className="muted">Staff access changed. Review this branch’s assignments.</p>}
        <div className="loan-application-actions">
          <Button size="sm" className="min-h-11" variant="outline" disabled={busy} onClick={() => edit(branch)}>Edit branch</Button>
          <Button size="sm" className="min-h-11" variant="ghost" disabled={busy} onClick={() => void save({ type: "setBranchActive", id: branch.id,
            revision: branch.revision, active: !branch.active })}>{branch.active ? "Archive" : "Reactivate"}</Button>
        </div>
      </li>;
    })}</ul>}
  </section>;
}
