"use client";

import { useState, type FormEvent } from "react";
import {
  brokerageUrl, demoBrokerageId, releaseWorkspaceClosed, workspaceFeatures, workspaceType,
  type Brokerage, type BrokerageSettings,
} from "@/lib/brokerage-model";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";
import type { UwmConnectionStatus } from "./uwm-connection";

type SaveWorkspace = (action: Record<string, unknown>, reset?: () => void) => Promise<void>;

export function WorkspaceFeatures({ workspace, connection, busy, save }: {
  workspace: Brokerage; connection: UwmConnectionStatus; busy: boolean; save: SaveWorkspace;
}) {
  const features = workspaceFeatures(workspace);
  const admin = workspace.role === "Admin";
  const compliance = !features.compliance ? "Off" : workspace.pilot ? "Internal workflows and sample files" : "Internal workflows";
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    void save({ type: "setWorkspaceFeatures", uwm: values.has("uwm"), compliance: values.has("compliance"), revision: features.revision });
  }
  return <div className="workspace-feature-settings">
    <h3>Workspace features</h3>
    <dl className="workspace-service-summary">
      <div><dt>UWM pricing</dt><dd>{features.uwm ? connection.pricing : "Off"}</dd></div>
      <div><dt>UWM pipeline &amp; conditions</dt><dd>{features.uwm ? connection.pipeline : "Off"}</dd></div>
      <div><dt>UWM submissions &amp; locks</dt><dd>{features.uwm ? connection.lenderActions : "Off"}</dd></div>
      <div><dt>Compliance</dt><dd>{compliance}</dd></div>
    </dl>
    {admin && <form key={features.revision} className="workspace-feature-form" onSubmit={submit}>
      <label className="demo-confirm"><input type="checkbox" name="uwm" defaultChecked={features.uwm} disabled={busy} /> Enable UWM</label>
      <label className="demo-confirm"><input type="checkbox" name="compliance" defaultChecked={features.compliance} disabled={busy} /> Enable Compliance</label>
      <p className="muted">{workspace.pilot
        ? "Pilot lender actions use sample data. Compliance includes sample file reviews."
        : "UWM services require separate account or brokerage access. Compliance opens licensing, reporting preparation, filing history, and internal policies."}</p>
      <Button type="submit" size="sm" className="min-h-10" disabled={busy}>Save workspace features</Button>
    </form>}
  </div>;
}

function WorkspaceLink({ workspace, preferred }: { workspace: Brokerage; preferred: boolean }) {
  const { uwm, compliance } = workspaceFeatures(workspace);
  return <a className="workspace-list-item" href={brokerageUrl(workspace.id)}>
    <strong>{workspace.name}</strong>
    <span>{workspace.role}{preferred ? " · Sign-in default" : ""}{workspace.maintenance ? " · Paused" : ""}
      {" · "}{workspaceType(workspace)}{workspace.pilot ? ` · ${workspace.id.slice(0, 8)}` : ""}</span>
    <span>UWM {uwm ? (workspace.pilot || workspace.id === demoBrokerageId ? "test" : "enabled") : "off"} · Compliance {compliance ? "on" : "off"}</span>
  </a>;
}

export function WorkspaceList({ current, settings, busy, save }: {
  current: Brokerage; settings: BrokerageSettings; busy: boolean; save: SaveWorkspace;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const others = settings.brokerages.filter(({ id }) => id !== current.id);
  const preferred = settings.preferredWorkspace;
  const operational = others.filter(item => !item.pilot && item.id !== demoBrokerageId);
  const closed = others.filter(item => releaseWorkspaceClosed(item));
  const hidden = others.filter(item => item.hidden && !releaseWorkspaceClosed(item));
  const samples = others.filter(item => (item.pilot || item.id === demoBrokerageId) && !item.hidden && !releaseWorkspaceClosed(item));
  const matches = samples.filter(item => `${item.name} ${item.id}`.toLowerCase().includes(query.trim().toLowerCase()));
  const selectable = matches.filter(item => item.pilot && item.id !== preferred);
  const selectedVisible = selectable.filter(({ id }) => selected.includes(id)).map(({ id }) => id);
  const allSelected = selectable.length > 0 && selectedVisible.length === selectable.length;
  const link = (item: Brokerage) => <WorkspaceLink key={item.id} workspace={item} preferred={item.id === preferred} />;

  return <>
    {!!operational.length && <div className="workspace-list"><h3>Operational workspaces</h3>{operational.map(link)}</div>}
    {!!samples.length && <details className="workspace-samples">
      <summary>Demo &amp; test workspaces ({samples.length})</summary>
      <label className="field">Find a demo or test workspace
        <input type="search" value={query} onChange={event => { setQuery(event.target.value); setSelected([]); }} placeholder="Search by name or reference" />
      </label>
      {!!selectable.length && <div className="loan-application-actions">
        <label className="demo-confirm"><input type="checkbox" checked={allSelected} disabled={busy}
          onChange={event => setSelected(event.target.checked ? selectable.map(({ id }) => id) : [])} /> Select matching workspaces</label>
        <Button variant="outline" size="sm" className="min-h-10" disabled={busy || !selectedVisible.length}
          onClick={() => void save({ type: "setWorkspaceListVisibility", ids: selectedVisible, hidden: true }, () => setSelected([]))}>
          Hide selected{selectedVisible.length > 0 ? ` (${selectedVisible.length})` : ""}
        </Button>
      </div>}
      <div className="workspace-list">{matches.map(item => <div key={item.id} className="workspace-list-control">
        {item.pilot && item.id !== preferred && <label className="workspace-row-select">
          <input type="checkbox" aria-label={`Select ${item.name} ${item.id.slice(0, 8)}`} checked={selected.includes(item.id)} disabled={busy}
            onChange={event => setSelected(previous => event.target.checked ? [...previous, item.id] : previous.filter(id => id !== item.id))} />
        </label>}
        {link(item)}
      </div>)}</div>
      {!matches.length && <p role="status">No matching workspaces.</p>}
    </details>}
    {!!hidden.length && <details className="workspace-samples">
      <summary>Hidden workspaces ({hidden.length})</summary>
      <p className="muted">Hidden for your account. Staff access and existing links stay active.</p>
      <div className="workspace-list">{hidden.map(item => <div key={item.id} className="workspace-list-control">
        {link(item)}
        <Button variant="outline" size="sm" className="min-h-10" disabled={busy} aria-label={`Restore ${item.name} ${item.id.slice(0, 8)}`}
          onClick={() => void save({ type: "setWorkspaceListVisibility", ids: [item.id], hidden: false })}>Restore</Button>
      </div>)}</div>
    </details>}
    {!!closed.length && <details className="workspace-samples">
      <summary>Closed release tests ({closed.length})</summary>
      <div className="workspace-list">{closed.map(item => <div key={item.id} className="workspace-list-item">
        <strong>{item.name}</strong><span>Closed {dateTime(item.releaseEndsAt!)} ET</span>
      </div>)}</div>
    </details>}
  </>;
}
