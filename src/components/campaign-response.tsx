"use client";

import { useState } from "react";
import { assignmentResponseMinutes, campaignResponseStatus, type CampaignResponseRecord } from "@/lib/campaign-response-model";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

type Status = ReturnType<typeof campaignResponseStatus>;

function duration(minutes: number) {
  const rounded = Math.round(minutes);
  if (rounded < 1) return "<1 min";
  const hours = Math.floor(rounded / 60);
  return hours ? `${hours} hr ${rounded % 60} min` : `${rounded} min`;
}

function medianDuration(minutes: number[]) {
  const times = [...minutes].sort((a, b) => a - b);
  const middle = Math.floor(times.length / 2);
  return times.length ? duration((times[middle] + times[Math.floor((times.length - 1) / 2)]) / 2) : "—";
}

export function CampaignResponse({ records, now, openLead, openLoan }: {
  records: CampaignResponseRecord[]; now: number; openLead: (id: string) => void; openLoan: (id: string) => void;
}) {
  const [view, setView] = useState<Status | "All outcomes">("All outcomes");
  const rows = records.map((record) => ({ record, status: campaignResponseStatus(record, now), minutes: assignmentResponseMinutes(record) }));
  const times = rows.flatMap(({ minutes }) => minutes === null ? [] : [minutes]);
  const onTime = rows.filter(({ status }) => status === "On time").length;
  const missed = rows.filter(({ status }) => status === "Missed deadline").length;
  const visible = view === "All outcomes" ? rows : rows.filter(({ status }) => status === view);
  const officers = new Map<string | null, { name: string; times: number[]; logged: number; missed: number }>();
  for (const { record, status, minutes } of rows) {
    const first = record.firstOutreach?.assignment;
    if (first) {
      const officer = officers.get(first.email) ?? { name: first.officer, times: [], logged: 0, missed: 0 };
      officer.logged++;
      if (minutes !== null) officer.times.push(minutes);
      officers.set(first.email, officer);
    }
    if (status === "Missed deadline" && record.deadlineAssignment) {
      const { email, officer: name } = record.deadlineAssignment;
      const officer = officers.get(email) ?? { name, times: [], logged: 0, missed: 0 };
      officer.missed++;
      officers.set(email, officer);
    }
  }

  return <section className="work-queue" aria-label="Campaign response performance">
    <div><h3>First outreach performance</h3>
      <p className="muted">Response time uses the assignment that was active when the first outcome was logged. A missed deadline belongs to whoever owned the lead when it was due, including the shared inbox.</p>
    </div>
    <div className="loan-application-actions">
      <span className="pill">Median after assignment · {medianDuration(times)}</span>
      <Button size="sm" variant="outline" aria-pressed={view === "All outcomes"} onClick={() => setView("All outcomes")}>All outcomes</Button>
      <Button size="sm" variant="outline" aria-pressed={view === "On time"} onClick={() => setView(view === "On time" ? "All outcomes" : "On time")}>{onTime} on time</Button>
      <Button size="sm" variant="outline" aria-pressed={view === "Missed deadline"} onClick={() => setView(view === "Missed deadline" ? "All outcomes" : "Missed deadline")}>{missed} missed deadlines</Button>
    </div>
    <p className="muted" role="status">{view} · {visible.length} {visible.length === 1 ? "lead" : "leads"}</p>
    {officers.size > 0 && <div className="table-scroll" role="region" aria-label="Response performance by owner" tabIndex={0}><table className="data-table">
      <caption>Response time and missed deadlines by owner</caption>
      <thead><tr><th scope="col">Owner</th><th scope="col">First outreach logged</th><th scope="col">Median after assignment</th><th scope="col">Missed deadlines</th></tr></thead>
      <tbody>{[...officers].map(([email, officer]) => <tr key={email ?? "shared"}>
        <th scope="row">{officer.name}</th><td>{officer.logged}</td><td>{medianDuration(officer.times)}</td><td>{officer.missed}</td>
      </tr>)}</tbody>
    </table></div>}
    {visible.length ? <ul className="loan-task-list">{visible.map(({ record, status, minutes }) => <li className="loan-task" key={record.leadId}>
      <div className="loan-task-copy">
        <strong>{record.name} · {status}</strong>
        <span>First outreach due {dateTime(record.dueAt)} ET</span>
        {status === "Missed deadline" && <span>At deadline · {record.deadlineAssignment?.officer}</span>}
        {record.firstOutreach && <span>First outreach owner · {record.firstOutreach.assignment.officer} · {dateTime(record.firstOutreach.at)} ET
          {minutes !== null && ` · ${duration(minutes)} after assignment`}</span>}
        {record.replyReceivedAt && <span>Incoming reply · {dateTime(record.replyReceivedAt)} ET</span>}
        {record.currentAssignment && !record.firstOutreach && <span>Current owner · {record.currentAssignment.officer}</span>}
      </div>
      {record.loanId ? <Button variant="outline" size="sm" onClick={() => openLoan(record.loanId!)}>Open loan</Button> :
        !record.closedAt && <Button variant="outline" size="sm" onClick={() => openLead(record.leadId)}>Open lead</Button>}
    </li>)}</ul> : <p className="empty-inline">No leads in this view.</p>}
  </section>;
}
