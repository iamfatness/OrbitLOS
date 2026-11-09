import { CheckCircle2, Circle, RotateCcw } from "lucide-react";
import type { ReactNode } from "react";
import { followUpPurposes, type FollowUpPurpose, type LoanTask } from "@/lib/model";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

export function FollowUpPurposeField({ optedOut, defaultPurpose = "Loan service" }: { optedOut?: boolean; defaultPurpose?: FollowUpPurpose }) {
  return <label className="field">Follow-up purpose<select key={String(optedOut)} name="purpose" defaultValue={optedOut ? "Loan service" : defaultPurpose}>
    {followUpPurposes.map((purpose) => <option key={purpose} disabled={optedOut && purpose === "Prospecting"}>{purpose}</option>)}
  </select></label>;
}

export function LoanTaskRow({ id, task, officer, busy, blocked, onChange, borrower, openLoan, context, children, action }: {
  id?: string;
  task: Pick<LoanTask, "title" | "dueAt" | "completedAt" | "purpose">; officer: string; busy: boolean; blocked?: boolean;
  onChange?: () => void; borrower?: string; openLoan?: () => void; context?: string; children?: ReactNode; action?: ReactNode;
}) {
  return <li className="loan-task" id={id} tabIndex={id ? -1 : undefined}>
    {task.completedAt ? <CheckCircle2 size={17} className="text-emerald-700" /> : <Circle size={17} className="text-violet-600" />}
    <div className="loan-task-copy">
      <strong>{task.title}</strong>
      {borrower && <button className="name-link" onClick={openLoan}>{borrower}</button>}
      {context && <p className="rate-task-context">{context}</p>}
      <span className="muted">{officer || "Unassigned"} · {task.purpose}</span>
      <span className="muted">{task.completedAt ? `Completed ${dateTime(task.completedAt)} ET` : `Due ${dateTime(task.dueAt)} ET`}</span>
      {blocked && <span className="pill">Blocked by outreach opt-out</span>}
      {children}
    </div>
    {action ?? (onChange && <Button size="sm" variant="outline" disabled={busy || blocked} onClick={onChange}>
      {task.completedAt ? <><RotateCcw /> Reopen</> : <><CheckCircle2 /> Mark complete</>}
    </Button>)}
  </li>;
}
