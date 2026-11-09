"use client";

import { prospectingBlocked, type InboxLead } from "@/lib/model";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

export const leadTaskTarget = (id: string) => `lead-task-${id}`;

export function LeadTasks({ lead, busy, save, showCampaignCallback = true }: {
  lead: InboxLead; busy: boolean; save: (input: unknown) => Promise<void>; showCampaignCallback?: boolean;
}) {
  const tasks = showCampaignCallback ? lead.importedTasks : lead.importedTasks.filter(({ id }) => id !== lead.campaignTaskId);
  if (!tasks.length) return null;
  return <div className="work-queue">
    <h4>Lead tasks</h4>
    <ul className="loan-task-list">{tasks.map((task) => {
      const blocked = prospectingBlocked(task.purpose, lead.outreachSuppressed);
      return <li className="loan-task" key={task.id} id={leadTaskTarget(task.id)} tabIndex={-1}>
        <div className="loan-task-copy"><strong>{task.title}</strong><span>{task.purpose} · {task.completedAt ? "Completed" : "Due"} {dateTime(task.completedAt ?? task.dueAt)} ET</span>
          {blocked && <span className="pill">Blocked by outreach opt-out</span>}</div>
        {task.id !== lead.campaignTaskId && <Button size="sm" variant="outline" disabled={busy || blocked || !!lead.heldAt} onClick={() => void save({
          type: "completeLeadTask", leadId: lead.id, taskId: task.id, completed: !task.completedAt,
        })}>{task.completedAt ? "Reopen task" : "Complete task"}</Button>}
      </li>;
    })}</ul>
  </div>;
}
