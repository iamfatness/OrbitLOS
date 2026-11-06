import { CheckCircle2, Circle, RotateCcw } from "lucide-react";
import type { LoanTask } from "@/lib/model";
import { dateTime } from "@/lib/utils";
import { Button } from "./ui/button";

export function LoanTaskRow({ task, officer, busy, onChange, borrower, openLoan }: {
  task: LoanTask; officer: string; busy: boolean; onChange: () => void; borrower?: string; openLoan?: () => void;
}) {
  return <li className="loan-task">
    {task.completedAt ? <CheckCircle2 size={17} className="text-emerald-700" /> : <Circle size={17} className="text-violet-600" />}
    <div className="loan-task-copy">
      <strong>{task.title}</strong>
      {borrower && <button className="name-link" onClick={openLoan}>{borrower}</button>}
      <span className="muted">{officer || "Unassigned"}</span>
      <span className="muted">{task.completedAt ? `Completed ${dateTime(task.completedAt)} ET` : `Due ${dateTime(task.dueAt)} ET`}</span>
    </div>
    <Button size="sm" variant="outline" disabled={busy} onClick={onChange}>
      {task.completedAt ? <><RotateCcw /> Reopen</> : <><CheckCircle2 /> Mark complete</>}
    </Button>
  </li>;
}
