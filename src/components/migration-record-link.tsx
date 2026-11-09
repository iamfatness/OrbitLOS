"use client";

import { useEffect, useRef, useState } from "react";
import { openMigrationRecord } from "@/app/actions";
import { migrationRecordUnavailable, type MigrationDestination, type MigrationRecord, type MigrationRecordQuery } from "@/lib/migration-record-model";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

export function MigrationRecordLink({ brokerageId, query, busy, open, label }: {
  brokerageId: string; query: MigrationRecordQuery; busy: boolean;
  open: (destination: MigrationDestination) => void; label?: string;
}) {
  const active = useRef(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [record, setRecord] = useState<MigrationRecord>();
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  async function lookup() {
    if (loading) return;
    setLoading(true);
    setError("");
    setRecord(undefined);
    try {
      const result = await openMigrationRecord(query, brokerageId);
      if (!active.current) return;
      if ("error" in result) setError(result.error);
      else if (result.evidence) setRecord(result);
      else open(result.destination);
    } catch {
      if (active.current) setError(migrationRecordUnavailable);
    } finally {
      if (active.current) setLoading(false);
    }
  }

  const evidence = record?.evidence;
  return <div className="record-form">
    <div><Button type="button" size="sm" variant="outline" disabled={busy || loading} onClick={() => {
      if (evidence) setRecord(undefined);
      else void lookup();
    }}>{loading ? "Finding record…" : evidence ? "Hide evidence" : label ?? "Open record"}</Button></div>
    {error && <p role="alert">{error}</p>}
    {evidence && record && <section className="document-item" aria-label="Imported record evidence">
      <strong>{evidence.title}</strong>
      {evidence.text && <p>{evidence.text}</p>}
      {evidence.at && <p className="muted">Recorded {dateTime(evidence.at)} ET</p>}
      {evidence.dueAt && <p className="muted">Due {dateTime(evidence.dueAt)} ET
        {evidence.completedAt ? ` · Completed ${dateTime(evidence.completedAt)} ET` : " · Open"}</p>}
      <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => open(record.destination)}>
        {record.destination.kind === "loan" ? "Open linked loan" : record.destination.kind === "archivedLead" ? "Open archived lead" : "Open linked lead"}
      </Button>
    </section>}
  </div>;
}
