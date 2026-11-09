"use client";

import { useEffect, useMemo, useState } from "react";
import { Copy, ExternalLink } from "lucide-react";
import { readRealtorWorkspace } from "@/app/actions";
import { demoBrokerageId } from "@/lib/brokerage-model";
import { realtorWorkUnavailable, type RealtorFilters, type RealtorProfile, type RealtorRecord, type RealtorWorkQuery,
  type RealtorWorkResult } from "@/lib/realtor-work-model";
import type { WorkspaceStaff } from "@/lib/staff-store";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";
import { PartnerConversion, RealtorRecords, type ConversionSelection } from "./partner-conversion";
import { useLeadOwners } from "./use-lead-owners";

const initialFilters: RealtorFilters = { from: "", through: "", officer: "", source: "" };

function useRealtorRead(query: RealtorWorkQuery | undefined, brokerageId: string, version: object, refresh: number) {
  const [data, setData] = useState<{ query: RealtorWorkQuery; version: object; brokerageId: string; refresh: number;
    result: RealtorWorkResult; moreError?: string }>();
  const [loading, setLoading] = useState(false);
  const current = data?.query === query && data?.version === version && data?.brokerageId === brokerageId && data?.refresh === refresh ? data : undefined;
  const result = current?.result;
  const error = result && "error" in result ? result.error : current?.moreError;
  useEffect(() => {
    if (!query) return;
    let active = true;
    const timer = window.setTimeout(() => {
      void readRealtorWorkspace(query, brokerageId).catch(() => ({ error: realtorWorkUnavailable })).then((result) => {
        if (active) setData({ query, version, brokerageId, refresh, result });
      });
    }, query.type === "directory" && query.search ? 180 : 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query, brokerageId, version, refresh]);

  async function loadMore() {
    if (!current || !query || !result || !("kind" in result) || result.kind === "profile" || !result.next || loading) return;
    const next = result.kind === "directory" && query.type === "directory" ? { ...query, after: result.next } :
      result.kind === "records" && query.type === "records" ? { ...query, after: result.next } : undefined;
    if (!next) return;
    setLoading(true);
    try {
      const response = await readRealtorWorkspace(next, brokerageId).catch(() => ({ error: realtorWorkUnavailable }));
      setData((latest) => {
        if (latest !== current) return latest;
        if ("error" in response) return { ...latest, moreError: response.error };
        if (result.kind === "directory" && response.kind === "directory") {
          const partners = new Map(result.partners.map((item) => [item.id, item]));
          for (const item of response.partners) partners.set(item.id, item);
          return { ...latest, moreError: undefined, result: { ...result, partners: [...partners.values()], next: response.next } };
        }
        if (result.kind === "records" && response.kind === "records") {
          const records = new Map(result.rows.map((item) => [`${item.kind}:${item.id}`, item]));
          for (const item of response.rows) records.set(`${item.kind}:${item.id}`, item);
          return { ...latest, moreError: undefined, result: { ...result, rows: [...records.values()], next: response.next } };
        }
        return latest;
      });
    } finally {
      setLoading(false);
    }
  }
  return { result, error, loading, loadMore };
}

export function RealtorCrm({ version, staff, busy, save, openLoan, openLead, openArchived, editRealtor, openContact }: {
  version: object; staff: WorkspaceStaff | null; busy: boolean; save: (input: unknown) => Promise<void>;
  openLoan: (loanId: string, target?: string) => void; openLead: (id: string) => void; openArchived: (id: string) => void;
  editRealtor: (realtorId: string) => void; openContact: (realtorId: string) => void;
}) {
  const brokerageId = staff?.brokerage.id ?? demoBrokerageId;
  const [selected, setSelected] = useState("");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState(initialFilters);
  const [refresh, setRefresh] = useState(0);
  const [selection, setSelection] = useState<ConversionSelection>();
  const [relationshipView, setRelationshipView] = useState<"linked" | "open">("linked");
  const query = useMemo<RealtorWorkQuery>(() => ({ type: "directory", filters, search }), [filters, search]);
  const directory = useRealtorRead(query, brokerageId, version, refresh);
  const page = directory.result && "kind" in directory.result && directory.result.kind === "directory" ? directory.result : undefined;
  const partnerId = selected || page?.partners[0]?.id || "";
  const profileQuery = useMemo<RealtorWorkQuery | undefined>(() => partnerId ? { type: "profile", partnerId } : undefined, [partnerId]);
  const linkedQuery = useMemo<RealtorWorkQuery | undefined>(() => partnerId ?
    { type: "records", partnerId, view: relationshipView, filters: initialFilters } : undefined, [partnerId, relationshipView]);
  const conversionQuery = useMemo<RealtorWorkQuery | undefined>(() => selection ?
    { type: "records", ...selection, filters } : undefined, [selection, filters]);
  const profileRead = useRealtorRead(profileQuery, brokerageId, version, refresh);
  const linkedRead = useRealtorRead(linkedQuery, brokerageId, version, refresh);
  const conversionRead = useRealtorRead(conversionQuery, brokerageId, version, refresh);
  const profile = profileRead.result && "kind" in profileRead.result && profileRead.result.kind === "profile" ? profileRead.result : undefined;
  const records = linkedRead.result && "kind" in linkedRead.result && linkedRead.result.kind === "records" ? linkedRead.result : undefined;
  const conversion = conversionRead.result && "kind" in conversionRead.result && conversionRead.result.kind === "records" ? conversionRead.result : undefined;

  function openRecord(row: RealtorRecord, target?: string) {
    if (row.kind === "loan") openLoan(row.id, target);
    else if (row.archived) openArchived(row.id);
    else openLead(row.id);
  }

  return <div className="relationship-stack">
    <PartnerConversion page={page} selected={partnerId} selection={selection} filters={filters} search={search}
      busy={busy || directory.loading} setFilters={setFilters} setSearch={(value) => { setSearch(value); setSelection(undefined); }}
      selectPartner={(id) => { setSelected(id); setRelationshipView("linked"); requestAnimationFrame(() => document.getElementById("realtor-partner")?.focus()); }}
      open={(item) => { setSelection(item); requestAnimationFrame(() => document.getElementById("partner-conversion-details")?.focus()); }}
      refresh={() => setRefresh((value) => value + 1)} loadMore={page?.next ? () => void directory.loadMore() : undefined} />
    {directory.error && <p className="empty-inline" role="alert">{directory.error}</p>}
    {!directory.result && <p className="empty-inline" role="status">Loading realtors…</p>}
    {selection && <RealtorRecords view={selection.view} page={conversion} busy={busy || conversionRead.loading}
      error={conversionRead.error} openRecord={(row) => openRecord(row, selection.view === "submitted" ? "loan-application" :
        selection.view === "funded" ? "loan-funding" : undefined)}
      loadMore={conversion?.next ? () => void conversionRead.loadMore() : undefined} close={() => setSelection(undefined)} />}
    {partnerId && <section className="pipeline relationship-panel" aria-label="Realtor partner" id="realtor-partner" tabIndex={-1}>
      <div className="section-heading"><h2>{profile?.contact.name ?? "Realtor partner"}</h2>
        {profile && <div className="loan-application-actions">
          <Button variant="outline" size="sm" disabled={busy} onClick={() => openContact(partnerId)}>Contact history</Button>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => editRealtor(partnerId)}>Edit contact</Button>
        </div>}
      </div>
      {profileRead.error && <p role="alert">{profileRead.error}</p>}
      {!profileRead.result && <p role="status">Loading realtor profile…</p>}
      {profile && <>
        {(profile.contact.email || profile.contact.phone) && <p className="muted">{[profile.contact.email, profile.contact.phone].filter(Boolean).join(" · ")}</p>}
        <div className="details-grid">
          <div><span>Referred loans</span><strong>{profile.linked}</strong></div>
          <div><span>Open referrals</span><strong>{profile.open}</strong></div>
          <div><span>Funded or closed</span><strong>{profile.closed}</strong></div>
        </div>
        <div className="view-toggle" aria-label="Realtor records">
          <button type="button" aria-pressed={relationshipView === "linked"} onClick={() => setRelationshipView("linked")}>Referred loans</button>
          <button type="button" aria-pressed={relationshipView === "open"} onClick={() => setRelationshipView("open")}>Open referrals</button>
        </div>
      </>}
    </section>}
    {profile && <RealtorLink key={`${partnerId}:${profile.portal?.revision ?? ""}:${profile.portal?.expiresAt ?? ""}`}
      profile={profile} staff={staff} busy={busy} save={save} />}
    {partnerId && <RealtorRecords view={relationshipView} page={records} busy={busy || linkedRead.loading}
      error={linkedRead.error} openRecord={openRecord} loadMore={records?.next ? () => void linkedRead.loadMore() : undefined} />}
  </div>;
}

function RealtorLink({ profile, staff, busy, save }: {
  profile: RealtorProfile; staff: WorkspaceStaff | null; busy: boolean; save: (input: unknown) => Promise<void>;
}) {
  const { contact: realtor, portal, routing, checkedAt } = profile;
  const [copyStatus, setCopyStatus] = useState("");
  const [selectedOwner, setSelectedOwner] = useState<string | null>(null);
  const admin = staff?.brokerage.role === "Admin";
  const { members, error: teamUnavailable } = useLeadOwners(admin ? staff.brokerage.id : null);
  const owner = selectedOwner ?? (portal ? portal.officerEmail ?? "" : staff?.email ?? "");
  const ownerAvailable = !owner || owner === staff?.email || members?.some((member) => member.email === owner);
  const route = routing.realtorRoute;
  const configuredOwner = route === "Assigned officer" ? routing.realtorOwner : route === "Link owner" ? portal?.officerEmail : null;
  const activeRouteOwner = members?.find((member) => member.email === configuredOwner);
  const active = Boolean(portal && portal.expiresAt > checkedAt);
  const path = active && portal ? `/referrals#${portal.token}` : "";

  async function copy() {
    try {
      await navigator.clipboard.writeText(new URL(path, window.location.origin).href);
      setCopyStatus("Referral link copied.");
    } catch {
      setCopyStatus("Open the realtor view and copy the address from your browser.");
    }
  }

  return <section className="pipeline relationship-panel" aria-label="Realtor access">
      <h2>Referral link</h2>
      <p className="muted">Share this private link so the realtor can submit prospects and check milestones. It expires after seven days.</p>
      {active && portal && <p className="muted">Expires {dateTime(portal.expiresAt)} ET.</p>}
      {active && staff && (configuredOwner && !members ?
        <p className="muted">{teamUnavailable ? "Current referral routing could not be verified." : "Checking referral routing…"}</p> :
        <p className="muted">New referrals route to {activeRouteOwner?.name || activeRouteOwner?.email || "the shared inbox"}.
          {configuredOwner && !activeRouteOwner && " The configured officer is unavailable."}</p>)}
      {admin && staff && <label className="field">{route === "Link owner" ? "Route new referrals to" : "Link owner"}
        <select value={owner} disabled={busy} onChange={(event) => setSelectedOwner(event.target.value)}>
          <option value="">Shared inbox</option>
          <option value={staff.email}>Me · {staff.email}</option>
          {members?.filter((member) => member.email !== staff.email).map((member) => <option key={member.email} value={member.email}>{member.name || member.email}</option>)}
          {owner && !ownerAvailable && <option value={owner} disabled>{owner} · Unavailable</option>}
        </select>
      </label>}
      {route !== "Link owner" && <p className="muted">Brokerage routing takes precedence over the link owner.</p>}
      {teamUnavailable && <p className="muted">Could not load your team. You can still choose yourself or the shared inbox.</p>}
      <div className="loan-application-actions">
        {path && <>
          <Button asChild variant="outline" size="sm"><a href={path} target="_blank" rel="noopener noreferrer"><ExternalLink /> Open realtor view</a></Button>
          <Button variant="outline" size="sm" onClick={() => void copy()}><Copy /> Copy referral link</Button>
        </>}
        {active && portal && admin && <Button size="sm" disabled={busy || !ownerAvailable || owner === (portal.officerEmail ?? "")}
          onClick={() => void save({ type: "saveRealtorLinkOwner", realtorId: realtor.id, token: portal.token,
            revision: portal.revision, officerEmail: owner || null })}>{route === "Link owner" ? "Save referral routing" : "Save link owner"}</Button>}
        <Button size="sm" variant={active ? "outline" : "default"} disabled={busy || !ownerAvailable} onClick={() => {
          setCopyStatus("");
          void save({ type: "createRealtorPortal", realtorId: realtor.id, officerEmail: admin ? owner || null : undefined });
        }}>{active ? "Replace link" : "Create referral link"}</Button>
        {active && <Button variant="ghost" size="sm" disabled={busy} onClick={() => {
          setCopyStatus("");
          void save({ type: "revokeRealtorPortal", realtorId: realtor.id });
        }}>Revoke link</Button>}
      </div>
      {active && <p className="empty-inline">Saving routing keeps the current link and applies to new referrals. Replacing or revoking the link closes access through it immediately.</p>}
      {copyStatus && <p className="muted" role="status">{copyStatus}</p>}
    </section>;
}
