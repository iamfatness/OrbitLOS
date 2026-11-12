import type { BrokerageRole } from "./brokerage-model";

export const firstDaySteps = {
  Admin: [
    { id: "staff-access", title: "Set up staff access", description: "Review your roster and invite loan officers and processors into this brokerage.", action: "Open staff access" },
    { id: "loan-defaults", title: "Review loan settings", description: "Check loan defaults and the document and fee templates your team will use.", action: "Open loan settings" },
    { id: "lead-routing", title: "Review lead routing", description: "Check who receives website leads and where unassigned inquiries go.", action: "Open lead routing" },
    { id: "assign-processing", title: "Review the processing queue", description: "Find files that need a processor and confirm who owns the next handoff.", action: "Open processing queue" },
  ],
  LO: [
    { id: "today", title: "Review your work for today", description: "Find the follow-ups, replies, and loan actions that need your attention.", action: "Open Today" },
    { id: "lead-inbox", title: "Open your lead inbox", description: "Review incoming leads, open a record, and find its next contact action.", action: "Open Lead Inbox" },
    { id: "loan-pipeline", title: "Open a loan or start a 1003", description: "Open a pipeline record to review its next action, or start a 1003 from New Lead.", action: "Open Pipeline" },
  ],
  Processor: [
    { id: "accept-handoff", title: "Review incoming handoffs", description: "Open Ready to accept and review the file and instructions before accepting.", action: "Open Ready to accept" },
    { id: "assigned-files", title: "Review assigned files", description: "Open a file to see its checklist, outstanding conditions, and next action.", action: "Open Assigned files" },
    { id: "processing-tasks", title: "Review your tasks", description: "Check the deadlines and follow-ups assigned to you.", action: "Open Tasks" },
  ],
} as const satisfies Record<BrokerageRole, readonly { id: string; title: string; description: string; action: string }[]>;

export type FirstDayStepId = (typeof firstDaySteps)[BrokerageRole][number]["id"];
export type FirstDayProgress = { kind: "staffFirstDay"; steps: { id: FirstDayStepId; revision: number; completed: boolean }[] };
