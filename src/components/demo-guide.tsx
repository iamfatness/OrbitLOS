"use client";

import { ArrowRight, CircleCheck, ExternalLink, Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useSyncExternalStore } from "react";
import { brokerageUrl } from "@/lib/brokerage-model";
import type { Workspace } from "@/lib/model";
import type { WorkspaceStaff } from "@/lib/staff-store";
import { conditionTarget } from "@/lib/uwm-alert-model";
import { rateTargetReached } from "@/lib/client-retention";
import { Button } from "./ui/button";

function subscribeToPreviewStorage(notify: () => void) {
  window.addEventListener("storage", notify);
  return () => window.removeEventListener("storage", notify);
}

type GuideStep = { title: string; description: string; done: boolean; action?: React.ReactNode };

export function DemoGuide({ state, staff, busy, save, open, openPricing, openLead, convert, previewRealtor, showTasks }: {
  state: Workspace; staff: WorkspaceStaff | null; busy: boolean; save: (input: unknown) => Promise<void>;
  open: (id: string, target?: string) => void; openPricing: (id: string) => void; openLead: (id: string) => void;
  convert: (id: string) => void; previewRealtor: (id: string, draftId: string) => void; showTasks: () => void;
}) {
  const router = useRouter();
  const [setupError, setSetupError] = useState("");
  const [previewedDraft, setPreviewedDraft] = useState("");
  const previewKey = `orbit:demo-realtor-preview:${staff?.brokerage.id ?? "local"}`;
  const savedPreview = useSyncExternalStore(subscribeToPreviewStorage, () => {
    try { return window.localStorage.getItem(previewKey) ?? ""; }
    catch { return ""; }
  }, () => "");
  const [creating, setCreating] = useState(false);
  const attempt = useRef<string | null>(null);
  const demo = state.demoGuide;
  const canReset = !staff || (staff.brokerage.pilot && staff.brokerage.role === "Admin");
  const canCreate = staff?.brokerage.role === "Admin" && !staff.brokerage.pilot;
  async function start() {
    if (canReset) {
      if (demo && !window.confirm("Reset the fictional scenario and replace its sample loans and links?")) return;
      await save({ type: "loadGuidedDemo", id: crypto.randomUUID(), previousId: demo?.id ?? null });
      return;
    }
    if (!canCreate || creating) return;
    setCreating(true);
    setSetupError("");
    attempt.current ??= crypto.randomUUID();
    try {
      const response = await fetch(`/api/brokerages?brokerage=${encodeURIComponent(staff.brokerage.id)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "create", id: attempt.current, name: "OrbitLOS Guided Demo", pilot: true }),
      });
      const result = await response.json() as { created?: string; error?: string };
      if (!response.ok || !result.created) throw new Error(result.error || "Could not open the guided demo.");
      router.push(`${brokerageUrl(result.created)}&guide=1`);
    } catch (error) {
      setSetupError(error instanceof Error ? error.message : "Could not open the guided demo.");
      setCreating(false);
    }
  }

  const lead = state.inboxLeads.find((item) => item.id === demo?.leadId);
  const loan = state.loans.find((item) => item.id === demo?.loanId);
  const application = state.applications.find((item) => item.loanId === loan?.id);
  const pricing = state.pricingRuns.some((item) => item.loanId === loan?.id && item.mode === "mock" && item.selectedId);
  const submission = state.submissions.find((item) => item.loanId === loan?.id && item.lender === "UWM" && item.syncedAt);
  const condition = submission?.conditions.find((item) => !item.satisfiedAt);
  const alert = state.uwmAlerts.find((item) => !item.reviewedAt && item.submissionId === submission?.id && item.conditionId === condition?.id);
  const partnerDraft = state.communicationDrafts.find((item) => item.loanId === loan?.id && item.audience === "Realtor" && item.milestone === "Lender review complete");
  const profile = state.pastClients.find((item) => item.loanId === demo?.rateLoanId);
  const rateTask = state.tasks.find((item) => item.id === `rate-watch:${demo?.rateLoanId}`);
  const portal = demo?.realtorToken && `/referrals#${demo.realtorToken}`;
  const closing = state.closingPlans.find((item) => item.loanId === loan?.id);
  const stagesTowardClose = loan && ["Clear to Close", "Funded", "Closed"].includes(loan.stage);
  const steps: GuideStep[] = [
    {
      title: "Turn a realtor referral into a 1003",
      description: "Prefill the 1003 and assign first contact.",
      done: Boolean(loan),
      action: lead && <>
        <Button size="sm" disabled={busy} onClick={() => lead.matches.length || lead.restrictedMatch ? openLead(lead.id) : convert(lead.id)}>Start 1003 from referral <ArrowRight /></Button>
        <Button size="sm" variant="outline" onClick={() => openLead(lead.id)}>Open Lead Inbox</Button>
      </>,
    },
    {
      title: "Submit and review the borrower’s 1003",
      description: "Open the borrower view, load sample answers and review, then confirm and submit. Back in Orbit, refresh the application and mark it reviewed.",
      done: Boolean(application?.reviewedAt),
      action: loan && <Button size="sm" onClick={() => open(loan.id, "loan-application")}>Open 1003</Button>,
    },
    {
      title: "Save a sample quote and submit to mock UWM",
      description: "Load the sample pricing scenario, run pricing, and save a quote. Then use the reviewed 1003 to submit to mock UWM.",
      done: Boolean(pricing && submission),
      action: loan && application?.reviewedAt && (pricing ?
        <Button size="sm" disabled={busy || Boolean(submission)} onClick={() => void save({ type: "sendApplication", loanId: loan.id })}>Send to UWM (mock)</Button> :
        <Button size="sm" onClick={() => openPricing(loan.id)}>Open mock pricing</Button>),
    },
    {
      title: "Work the UWM condition alert",
      description: "Open an outstanding condition. Request the suggested document, attach a sample in the borrower checklist, and refresh. Accept and send, then check mock clearance. Repeat for each open item.",
      done: Boolean(submission && !condition),
      action: loan && submission && condition && <>
        <Button size="sm" onClick={() => open(loan.id, conditionTarget(submission.id, condition.id))}>{alert ? "Open condition alert" : "Open outstanding condition"}</Button>
        <Button size="sm" variant="outline" onClick={showTasks}>View My Tasks</Button>
      </>,
    },
    {
      title: "Preview the realtor update",
      description: "Clearance prepares a realtor-safe milestone draft automatically. The realtor view shows pipeline milestones for this referral.",
      done: Boolean(partnerDraft && (previewedDraft === partnerDraft.id || savedPreview === partnerDraft.id)),
      action: loan && partnerDraft && <Button size="sm" onClick={() => {
        setPreviewedDraft(partnerDraft.id);
        try { window.localStorage.setItem(previewKey, partnerDraft.id); } catch { /* Keep the current view usable without storage. */ }
        previewRealtor(loan.id, partnerDraft.id);
      }}>Preview realtor draft</Button>,
    },
    {
      title: "Move toward closing",
      description: "Set the pipeline stage to Clear to Close and enter a target closing date. Refresh the realtor view to see the new milestone.",
      done: Boolean(stagesTowardClose && closing?.targetDate),
      action: loan && submission && !condition && <>
        <Button size="sm" disabled={busy || Boolean(stagesTowardClose)} onClick={() => void save({ type: "move", id: loan.id, stage: "Clear to Close" })}>Move to Clear to Close</Button>
        <Button size="sm" variant="outline" onClick={() => open(loan.id, "closing-workbench")}>Open closing checklist</Button>
      </>,
    },
    {
      title: "Turn a rate change into follow-up work",
      description: "Casey’s fictional loan has a 6.125% watch target. Record a sample 6.000% observation and see why a task appears for the assigned LO.",
      done: Boolean(rateTask),
      action: profile && (rateTargetReached(profile) ? <>
        <Button size="sm" onClick={() => open(profile.loanId, "loan-retention")}>Open rate-watch follow-up</Button>
        <Button size="sm" variant="outline" onClick={showTasks}>View My Tasks</Button>
      </> : <Button size="sm" disabled={busy} onClick={() => void save({
        type: "saveRetention", loanId: profile.loanId, revision: profile.revision, closingDate: profile.closingDate || "",
        currentRate: String(profile.currentRate ?? ""), targetRate: String(profile.targetRate ?? ""), observedRate: "6.000",
        watchEnabled: true, note: profile.note,
      })}>Record sample 6.000%</Button>),
    },
  ];
  const completed = steps.filter((step) => step.done).length;
  const next = steps.findIndex((step) => !step.done);

  return <section className="integration record-form manager-panel demo-guide" aria-label="Guided demo walkthrough">
    <div className="demo-guide-heading">
      <h2>Referral to closing in seven steps</h2>
      {demo?.rateLoanId ? <div className="demo-progress">
        <span role="status">{completed} / {steps.length} ready</span>
        <progress aria-label="Completed walkthrough steps" value={completed} max={steps.length} />
      </div> : <span className="pill">5–7 minutes</span>}
    </div>
    <p className="muted">Follow a fictional file as the LO, borrower, and realtor. Lender, pricing, credit, and AUS results are mocked.</p>
    <div className="loan-application-actions">
      {(canReset || canCreate) && <Button size="sm" variant={demo ? "outline" : "default"} disabled={busy || creating} onClick={() => void start()}>
        <Play /> {creating ? "Opening pilot…" : canCreate ? "Create guided pilot" : demo ? "Reset scenario" : "Load sample scenario"}
      </Button>}
      {demo && <Button size="sm" variant="outline" aria-label="Refresh walkthrough" disabled={busy} onClick={() => void save({ type: "refreshWorkspace" })}>Refresh</Button>}
      {portal && <Button size="sm" variant="outline" asChild><a href={portal} target="_blank" rel="noopener noreferrer">Open sample realtor view <ExternalLink /></a></Button>}
    </div>
    {setupError && <p className="application-error" role="alert">{setupError}</p>}
    {!demo?.rateLoanId ? <p className="empty-inline">{canCreate ? "Create an isolated pilot workspace, then load the sample scenario." : canReset ?
      "Load the scenario to add an assigned realtor referral and a funded client with a rate target." :
      "Ask a pilot admin to load the guided scenario and assign it to you."}</p> :
      <ol className="demo-steps" role="list">{steps.map(({ title, description, done, action }, index) =>
        <li key={title} aria-current={index === next ? "step" : undefined} data-done={done}>
          <span className="demo-step-number" aria-hidden="true">{done ? <CircleCheck size={17} /> : index + 1}</span>
          <div>
            {index === next && <p className="eyebrow">Up next</p>}
            <h3>{done && <span className="sr-only">Completed. </span>}{title}</h3>
            {!done && (index === next || action) && <p className="muted">{description}</p>}
            {action && <div className="loan-application-actions">{action}</div>}
          </div>
        </li>)}</ol>}
  </section>;
}
