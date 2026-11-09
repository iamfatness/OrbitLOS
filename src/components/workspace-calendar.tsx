"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { readCalendarWork } from "@/app/actions";
import { dateLabel, easternDate } from "@/lib/client-retention";
import { calendarGroupNames, queueActionLabel, type CalendarItem, type CalendarPage, type CalendarQuery } from "@/lib/officer-queue-model";
import { shiftReportDate } from "@/lib/report-date-range";
import { Button } from "./ui/button";

const weekdayLabel = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short" });
const clock = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeStyle: "short" });
const dateOf = (item: CalendarItem) => item.dueAt.length === 10 ? item.dueAt : easternDate(new Date(item.dueAt));

export function currentCalendarWeek() {
  const today = easternDate();
  const weekday = new Date(today).getUTCDay();
  return shiftReportDate(today, -((weekday + 6) % 7));
}

export function WorkspaceCalendar({ brokerageId, canSeeTeam, processor, query, onChange, version, openWork }: {
  brokerageId: string; canSeeTeam: boolean; processor: boolean; query: CalendarQuery; onChange: (query: CalendarQuery) => void;
  version: object; openWork: (item: CalendarItem) => void;
}) {
  const [data, setData] = useState<{ brokerageId: string; version: object; query: CalendarQuery; result: CalendarPage | { error: string } }>();
  useEffect(() => {
    let active = true;
    const update = (result: CalendarPage | { error: string }) => { if (active) setData({ brokerageId, version, query, result }); };
    void readCalendarWork(query, brokerageId).then(update, () => update({ error: "Could not load calendar work. Try refreshing." }));
    return () => { active = false; };
  }, [brokerageId, query, version]);

  const current = data?.brokerageId === brokerageId && data.version === version && data.query === query ? data.result : undefined;
  const page = current && !("error" in current) ? current : undefined;
  const days = Array.from({ length: 7 }, (_, offset) => shiftReportDate(query.week, offset));
  const today = page ? easternDate(new Date(page.checkedAt)) : easternDate();
  const groups = processor ? ["All", "Conversations", "Appointments", "Documents", "Reviews", "Closings"] as const : calendarGroupNames;
  const byDay = new Map<string, CalendarItem[]>();
  for (const item of page?.items ?? []) {
    const day = dateOf(item);
    const group = byDay.get(day) ?? [];
    group.push(item);
    byDay.set(day, group);
  }
  const selectWeek = (week: string) => onChange({ ...query, week, day: undefined, after: undefined });

  return <section className="integration record-form manager-panel calendar-panel" aria-label="Workspace calendar">
    <div className="section-heading"><h2>{dateLabel(query.week)} – {dateLabel(days[6])}</h2><span className="pill">Eastern time</span></div>
    <div className="calendar-controls">
      <div className="loan-application-actions" role="group" aria-label="Calendar week">
        <Button size="icon" variant="outline" aria-label="Previous week" onClick={() => selectWeek(shiftReportDate(query.week, -7))}><ChevronLeft /></Button>
        <Button size="sm" variant="outline" onClick={() => selectWeek(currentCalendarWeek())}>This week</Button>
        <Button size="icon" variant="outline" aria-label="Next week" onClick={() => selectWeek(shiftReportDate(query.week, 7))}><ChevronRight /></Button>
      </div>
      <div className="calendar-filters">
        {canSeeTeam && <label className="field">Calendar scope<select value={query.scope} onChange={(event) =>
          onChange({ ...query, scope: event.target.value === "Team" ? "Team" : "Mine", after: undefined })}>
          <option value="Mine">My calendar</option><option value="Team">Brokerage calendar</option>
        </select></label>}
        <label className="field">Work type<select value={query.group} onChange={(event) =>
          onChange({ ...query, group: event.target.value as CalendarQuery["group"], after: undefined })}>
          {groups.map((group) => <option key={group}>{group}</option>)}
        </select></label>
      </div>
    </div>
    <div className="calendar-days" role="group" aria-label="Calendar day">
      {days.map((day) => <Button key={day} variant={query.day === day ? "default" : "outline"}
        aria-pressed={query.day === day} aria-current={day === today ? "date" : undefined}
        aria-label={`${weekdayLabel.format(new Date(day))}, ${dateLabel(day)}`}
        onClick={() => onChange({ ...query, day: query.day === day ? undefined : day, after: undefined })}>
        <span>{weekdayLabel.format(new Date(day))}</span><strong>{Number(day.slice(-2))}</strong>
      </Button>)}
    </div>
    <div className="section-heading calendar-agenda-heading">
      <h3>{query.day ? `${dateLabel(query.day)} agenda` : "Week agenda"}</h3>
      <div className="loan-application-actions">
        {query.day && <Button variant="ghost" size="sm" onClick={() => onChange({ ...query, day: undefined, after: undefined })}>Show whole week</Button>}
        <Button variant="outline" size="sm" onClick={() => onChange({ ...query, after: undefined })}>Refresh calendar</Button>
      </div>
    </div>
    {query.group === "Appointments" && <p className="muted">To schedule an appointment, open Activity on its loan.</p>}
    {!current && <p className="muted" role="status">Loading calendar work…</p>}
    {current && "error" in current && <p role="alert">{current.error}</p>}
    {page && <>
      {[...byDay].map(([day, entries]) => <section key={day} className="calendar-agenda-day" aria-label={dateLabel(day)}>
        <h4>{weekdayLabel.format(new Date(day))}, {dateLabel(day)}</h4>
        <ul className="loan-task-list">{entries.map((item) => <li className="loan-task calendar-item" key={`${item.kind}:${item.id}`}>
          <div className="calendar-item-time"><time dateTime={item.dueAt}>{item.dueAt.length === 10 ? "All day" : clock.format(new Date(item.dueAt))}</time>
            {item.overdue && <span className="pill">Overdue</span>}</div>
          <div className="loan-task-copy"><strong>{item.title}</strong><span>{item.name}{query.scope === "Team" && ` · ${item.owner}`}</span></div>
          <Button size="sm" variant="outline" aria-label={`${queueActionLabel(item)} for ${item.name}`} onClick={() => openWork(item)}>{queueActionLabel(item)}</Button>
        </li>)}</ul>
      </section>)}
      {!byDay.size && <p className="empty-inline">{page.next ? "No actionable items on this page. Check the next page for more work." :
        query.after ? "No more open work in this view." : "No open work matches these dates and filters."}</p>}
      {(query.after || page.next) && <div className="loan-application-actions">
        {query.after && <Button size="sm" variant="outline" onClick={() => onChange({ ...query, after: undefined })}>First page</Button>}
        {page.next && <Button size="sm" variant="outline" onClick={() => onChange({ ...query, after: page.next ?? undefined })}>Next page</Button>}
      </div>}
    </>}
  </section>;
}
