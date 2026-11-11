"use client";

import { useEffect, useRef, useState } from "react";
import type { ProcessorAssignmentReceipt } from "@/lib/loan-processing";
import type { LoanProcessing } from "@/lib/processing-model";
import { Button } from "./ui/button";

export const assignmentEndpoint = (brokerageId: string) => `/api/brokerages?brokerage=${encodeURIComponent(brokerageId)}`;
export const processorSaveKey = (brokerageId: string, loanId: string) => `orbit:processor-save:${brokerageId}:${loanId}`;
const shortcutKey = (brokerageId: string) => `orbit:processor-shortcut:${brokerageId}`;

export function readProcessorSave(key: string) {
  try { return sessionStorage.getItem(key) ?? ""; } catch { return ""; }
}

export function writeProcessorSave(key: string, value: string) {
  try {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch {
    // The current editor can still check an in-memory attempt.
  }
}

export async function checkProcessorReceipt(brokerageId: string, loanId: string, requestId: string) {
  const search = new URLSearchParams({ view: "processor-assignment-receipt", loanId, requestId });
  const response = await fetch(`${assignmentEndpoint(brokerageId)}&${search}`);
  if (!response.ok) throw new Error();
  const result = await response.json() as Partial<ProcessorAssignmentReceipt>;
  if (result.outcome !== "saved" && result.outcome !== "newer" && result.outcome !== "missing") throw new Error();
  return result.outcome;
}

type Attempt = { loanId: string; requestId: string; name?: string };
type Feedback = "unconfirmed" | "missing" | "failed" | "saved" | "newer";
type SaveResult = { kind: "saved"; message: string; processing?: LoanProcessing } |
  { kind: "rejected"; error: string } | { kind: "unconfirmed" };

function pendingShortcut(brokerageId: string): Attempt | undefined {
  const loanId = readProcessorSave(shortcutKey(brokerageId));
  const requestId = loanId && readProcessorSave(processorSaveKey(brokerageId, loanId));
  if (requestId) return { loanId, requestId };
}

export function useProcessorAssignmentShortcut(brokerageId: string, enabled: boolean) {
  const [attempt, setAttempt] = useState(() => enabled ? pendingShortcut(brokerageId) : undefined);
  const [activity, setActivity] = useState<"saving" | "checking">();
  const [feedback, setFeedback] = useState<Feedback>("unconfirmed");
  const running = useRef(false);
  const focusResult = useRef(false);
  const feedbackRef = useRef<HTMLParagraphElement>(null);
  const pending = !!attempt && feedback !== "saved" && feedback !== "newer";
  useEffect(() => {
    if (activity || !focusResult.current || !feedbackRef.current) return;
    focusResult.current = false;
    feedbackRef.current.focus();
  }, [activity, attempt, feedback]);

  function clear(saved: Attempt) {
    const key = processorSaveKey(brokerageId, saved.loanId);
    if (readProcessorSave(key) === saved.requestId) writeProcessorSave(key, "");
    if (readProcessorSave(shortcutKey(brokerageId)) === saved.loanId && !readProcessorSave(key)) {
      writeProcessorSave(shortcutKey(brokerageId), "");
    }
  }

  async function save(input: { loanId: string; email: string; revision: number; requireUnassigned?: boolean }, name: string): Promise<SaveResult> {
    if (!enabled || running.current || pending) return { kind: "unconfirmed" };
    const open = pendingShortcut(brokerageId);
    const key = processorSaveKey(brokerageId, input.loanId);
    const existing = readProcessorSave(key);
    const next = open ?? { loanId: input.loanId, requestId: existing || crypto.randomUUID(), name };
    setFeedback("unconfirmed");
    setAttempt(next);
    writeProcessorSave(shortcutKey(brokerageId), next.loanId);
    if (open || existing) {
      focusResult.current = true;
      return { kind: "unconfirmed" };
    }
    writeProcessorSave(key, next.requestId);
    running.current = true;
    setActivity("saving");
    try {
      const response = await fetch(assignmentEndpoint(brokerageId), { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "assignProcessor", ...input, requestId: next.requestId }) });
      const result = await response.json() as { error?: string; message?: string; processing?: LoanProcessing };
      if (response.ok && result.message && (!input.requireUnassigned || result.processing?.loanId === input.loanId)) {
        clear(next);
        setAttempt(undefined);
        return { kind: "saved", message: result.message, processing: result.processing };
      }
      if (!response.ok && response.status < 500 && result.error) {
        clear(next);
        setAttempt(undefined);
        return { kind: "rejected", error: result.error };
      }
    } catch {
      // A missing response leaves the exact attempt available for a read-only check.
    } finally {
      running.current = false;
      setActivity(undefined);
    }
    focusResult.current = true;
    return { kind: "unconfirmed" };
  }

  async function check(refresh: () => void) {
    if (!attempt || !pending || running.current) return;
    running.current = true;
    focusResult.current = true;
    setActivity("checking");
    try {
      const outcome = await checkProcessorReceipt(brokerageId, attempt.loanId, attempt.requestId);
      setFeedback(outcome);
      if (outcome !== "missing") {
        clear(attempt);
        refresh();
      }
    } catch {
      setFeedback("failed");
    } finally {
      running.current = false;
      setActivity(undefined);
    }
  }

  function review(open: (loanId: string) => void, refresh: () => void) {
    if (!attempt || running.current) return;
    if (feedback === "missing") {
      clear(attempt);
      setAttempt(undefined);
      refresh();
    }
    open(attempt.loanId);
  }

  return { attempt: enabled ? attempt : undefined, activity, feedback, feedbackRef, pending: enabled && pending, save, check, review };
}

export function ProcessorAssignmentRecovery({ recovery, refresh, open }: {
  recovery: ReturnType<typeof useProcessorAssignmentShortcut>; refresh: () => void; open?: (loanId: string) => void;
}) {
  const { attempt, activity, feedback, feedbackRef, pending, check, review } = recovery;
  if (!attempt) return null;
  const message = activity === "saving" ? "Saving processor access…" : activity === "checking" ? "Checking processor access…" : {
    unconfirmed: "Orbit couldn’t confirm the processor change.",
    failed: "Orbit couldn’t check this save. Try checking again.",
    missing: "No confirmation found yet. Check again or review the current processor.",
    saved: "Processor change saved.",
    newer: "This change was saved. A newer processing update is available.",
  }[feedback];
  return <div className="assignment-editor" role="group" aria-label="Processor assignment recovery">
    <p ref={feedbackRef} tabIndex={-1} role={feedback === "failed" && !activity ? "alert" : "status"} className="application-message">
      {attempt.name && <><strong>{attempt.name}</strong><br /></>}{message}</p>
    <div className="loan-application-actions">
      {pending && <Button size="sm" variant="outline" disabled={!!activity} onClick={() => void check(refresh)}>Check processor change</Button>}
      {open && (!pending || feedback === "missing") && <Button size="sm" variant="outline" disabled={!!activity}
        onClick={() => review(open, refresh)}>Review current access</Button>}
    </div>
  </div>;
}
