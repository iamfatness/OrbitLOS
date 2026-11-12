"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ArrowRight, CalendarClock } from "lucide-react";
import { accessComplianceCases } from "@/app/actions";
import type { LicenseRenewalCursor, LicenseRenewalQueue, LicenseRenewalTarget } from "@/lib/compliance-program-model";
import { observeTabReturn, observeVisibleChecks } from "@/lib/tab-return";
import { Button } from "./ui/button";

export type LicenseRenewalVisit = { target: LicenseRenewalTarget; after?: LicenseRenewalCursor };

const actionId = ({ entityId, licenseId }: LicenseRenewalTarget) => `renewal-${entityId}-${licenseId}`;

export function LicenseRenewalAttention({ brokerageId, busy, open, returning, mine = false }: {
  brokerageId: string; busy: boolean; open: (visit: LicenseRenewalVisit) => void; returning?: LicenseRenewalVisit; mine?: boolean;
}) {
  const [after, setAfter] = useState(returning?.after);
  const [data, setData] = useState<LicenseRenewalQueue>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [generation, setGeneration] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  const Heading = mine ? "h3" : "h2";
  const restoreFocus = useRef(!!returning);

  useEffect(() => {
    let active = true;
    let reading = false;
    async function read(isCurrent: () => boolean) {
      if (reading) return;
      reading = true;
      try {
        const result = await accessComplianceCases({ type: "program", input: { operation: "licenseRenewals", scope: mine ? "mine" : "brokerage", after } }, brokerageId);
        if (!active || !isCurrent()) return;
        if (!("kind" in result) || result.kind !== "licenseRenewals") throw new Error();
        setData(result);
        setError(false);
      } catch {
        if (active && isCurrent()) setError(true);
      } finally {
        if (active && isCurrent()) setLoading(false);
        reading = false;
      }
    }
    void read(() => true);
    const stop = observeTabReturn(document, window, (isCurrent) => void read(isCurrent));
    const stopChecks = mine ? observeVisibleChecks(document, window, read, 60_000) : undefined;
    const untilTomorrow = Date.parse(new Date().toISOString().slice(0, 10)) + 86400000 - Date.now();
    const timer = setTimeout(() => setGeneration(value => value + 1), Math.max(1000, untilTomorrow + 50));
    return () => { active = false; stop(); stopChecks?.(); clearTimeout(timer); };
  }, [after, brokerageId, generation, mine]);

  useEffect(() => {
    if (loading || !restoreFocus.current) return;
    restoreFocus.current = false;
    const button = returning && document.getElementById(actionId(returning.target));
    (button || heading.current)?.focus();
  }, [loading, returning]);

  function changePage(cursor?: LicenseRenewalCursor) {
    restoreFocus.current = true;
    setLoading(true);
    setError(false);
    setData(undefined);
    setAfter(cursor);
  }

  return <section className={mine ? "document-item record-form" : "integration record-form"} aria-labelledby={headingId}>
    <div className="section-heading">
      <Heading id={headingId} tabIndex={-1} ref={heading}>{!mine && <CalendarClock size={19} aria-hidden="true" />}{mine ? "My license renewals" : "License renewals"}</Heading>
      <Button type="button" size="sm" variant="outline" disabled={loading || busy} onClick={() => {
        setLoading(true); setError(false); setGeneration(value => value + 1);
      }}>Refresh renewals</Button>
    </div>
    {loading && !data && <p className="muted" role="status">Checking license renewals…</p>}
    {error && <p className="muted" role="alert">{data ? "Could not refresh renewals. Showing the last check." : "Could not load renewals. Refresh to try again."}</p>}
    {data && (data.total ? <>
      <p className="muted" role="status">{data.total} {data.total === 1 ? "license needs" : "licenses need"} renewal review</p>
      <ul className="document-list">{data.items.map(item => <li className="document-item" key={actionId(item)}>
        <div className="document-item-head"><strong>{item.jurisdiction} · {item.licenseType}</strong><span className="pill">{item.renewal}</span></div>
        <p className="muted">{item.entityName} · {item.holderLabel}</p>
        <p className="muted">{item.licenseNumber} · Expiration {item.expiresOn}</p>
        {!mine && <p className="muted">Renewal owner · {item.renewalOwner?.name ?? "Unassigned"}
          {item.renewalOwner && !item.renewalOwner.available && " · Owner needs review"}</p>}
        <Button id={actionId(item)} type="button" size="sm" variant="outline" disabled={busy}
          aria-label={`Review ${item.jurisdiction} license ${item.licenseNumber} for ${item.entityName}`}
          onClick={() => open({ target: item, after })}>Review license<ArrowRight aria-hidden="true" /></Button>
      </li>)}</ul>
      {!data.items.length && <p className="empty-inline">No renewals remain on this page.</p>}
    </> : <p className="empty-inline" role="status">{mine ? "No license renewals assigned to you need review." : "No licenses need renewal review."}</p>)}
    {(after || data?.next) && <div className="loan-application-actions">
      {after && <Button size="sm" variant="outline" disabled={loading || busy} onClick={() => changePage()}>First renewal page</Button>}
      {data?.next && <Button size="sm" variant="outline" disabled={loading || busy} onClick={() => changePage(data.next ?? undefined)}>Next renewal page</Button>}
    </div>}
  </section>;
}
