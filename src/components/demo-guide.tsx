"use client";

import { ArrowRight, CircleCheck, ExternalLink, Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useSyncExternalStore } from "react";
import { brokerageUrl } from "@/lib/brokerage-model";
import { loanReviewsTarget } from "@/lib/loan-review-model";
import { prospectingBlocked, type PastClientProfile, type Submission, type Workspace } from "@/lib/model";
import type { WorkspaceStaff } from "@/lib/staff-store";
import type { LoanProcessing } from "@/lib/processing-model";
import { rateTargetReached } from "@/lib/client-retention";
import { quoteMatchesApplication } from "@/lib/pricing-model";
import { campaignManualSubmission, campaignRehearsalCsv, type CampaignLenderPath, type CampaignRehearsal } from "@/lib/call-campaign-model";
import { fundingTaskId } from "@/lib/playbook-model";
import { dateTime } from "@/lib/utils";
import { conditionDocumentBatchLimit, needsBorrowerDocument, suggestedConditionDocument, type LoanDocumentRequest } from "@/lib/document-model";
import { downloadSampleFile } from "./sample-download";
import { Button } from "./ui/button";
import { useLeadOwners } from "./use-lead-owners";

function subscribeToPreviewStorage(notify: () => void) {
  window.addEventListener("storage", notify);
  return () => window.removeEventListener("storage", notify);
}

type GuideStep = { title: string; description: string; done: boolean; action?: React.ReactNode; detail?: React.ReactNode };
export type GuideTrack = "referral" | "campaign";

type DemoGuideProps = {
  track: GuideTrack;
  state: Workspace; staff: WorkspaceStaff | null; busy: boolean; save: (input: unknown) => Promise<void>;
  open: (id: string, target?: string, campaignLender?: CampaignLenderPath) => void;
  openConditions: (loanId: string, submissionId: string, conditionId?: string) => void;
  openPricing: (id: string, campaignLender?: CampaignLenderPath) => void; openLead: (id: string) => void;
  convert: (id: string) => void; previewRealtor: (id: string, draftId: string) => void; showTasks: (loanId?: string, callbackId?: string) => void;
  openCampaign: (id: string, leadId?: string) => void; openContact: (id: string) => void;
  openProcessorAssignment: (loanId: string) => void;
  recordCheckIn: (loanId: string) => void; startRepeat: (loanId: string) => void;
};

function recordSampleRate(save: DemoGuideProps["save"], profile: PastClientProfile) {
  return save({
    type: "saveRetention", loanId: profile.loanId, revision: profile.revision, closingDate: profile.closingDate || "",
    currentRate: String(profile.currentRate ?? ""), targetRate: String(profile.targetRate ?? ""), observedRate: "6.000",
    watchEnabled: true, note: profile.note,
  });
}

function GuideProgress({ steps }: { steps: GuideStep[] }) {
  const completed = steps.filter((step) => step.done).length;
  return <div className="demo-progress">
    <span role="status">{completed} / {steps.length} ready</span>
    <progress aria-label="Completed walkthrough steps" value={completed} max={steps.length} />
  </div>;
}

function GuideSteps({ steps }: { steps: GuideStep[] }) {
  const next = steps.findIndex((step) => !step.done);
  return <ol className="demo-steps" role="list">{steps.map(({ title, description, done, action, detail }, index) =>
    <li key={title} aria-current={index === next ? "step" : undefined} data-done={done}>
      <span className="demo-step-number" aria-hidden="true">{done ? <CircleCheck size={17} /> : index + 1}</span>
      <div>
        {index === next && <p className="eyebrow">Up next</p>}
        <h3>{done && <span className="sr-only">Completed. </span>}{title}</h3>
        {!done && (index === next || action) && <p className="muted">{description}</p>}
        {action && <div className="loan-application-actions">{action}</div>}
        {detail}
      </div>
    </li>)}</ol>;
}

export function DemoGuide(props: DemoGuideProps) {
  const { track, state, staff, busy, save, open, openConditions, openPricing, openLead, convert, previewRealtor, showTasks, openCampaign } = props;
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
  const campaign = state.callCampaigns.find((item) => item.id === demo?.id);
  const canReset = !staff || (staff.brokerage.pilot === true && staff.brokerage.role === "Admin");
  const canCreate = staff?.brokerage.role === "Admin" && !staff.brokerage.pilot;
  async function createPilot(path: GuideTrack) {
    if (staff?.brokerage.role !== "Admin" || creating) return;
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
      router.push(brokerageUrl(result.created, path === "campaign" ? "campaign" : "1"));
    } catch (error) {
      setSetupError(error instanceof Error ? error.message : "Could not open the guided demo.");
      setCreating(false);
    }
  }

  async function start() {
    if (!canReset) return createPilot("referral");
    if (demo && !window.confirm("Reset the fictional scenario and replace its sample loans and links?")) return;
    await save({ type: "loadGuidedDemo", id: crypto.randomUUID(), previousId: demo?.id ?? null });
  }

  if (track === "campaign") {
    return <CampaignGuide {...props} canSetup={canReset} creating={creating} setupError={setupError}
      createPilot={() => void createPilot("campaign")} />;
  }

  const lead = state.inboxLeads.find((item) => item.id === demo?.leadId);
  const loan = state.loans.find((item) => item.id === demo?.loanId);
  const application = state.applications.find((item) => item.loanId === loan?.id);
  const credit = state.mockCreditAusRuns.find((item) => item.loanId === loan?.id && item.service === "Credit");
  const pricing = state.pricingRuns.filter((item) => item.loanId === loan?.id && item.selectedId)
    .sort((a, b) => (b.selectedAt ?? "").localeCompare(a.selectedAt ?? ""))[0];
  const quote = pricing?.mode === "mock" && pricing.selectedId && quoteMatchesApplication(pricing.applicationRevision, application)
    ? { runId: pricing.id, offerId: pricing.selectedId } : undefined;
  const submission = state.submissions.find((item) => item.loanId === loan?.id && item.lender === "UWM" && item.syncedAt);
  const currentApplicationSent = application?.versions.some((version) => version.revision === application.revision && version.uwmReceipt);
  const condition = submission?.conditions.find((item) => !item.satisfiedAt);
  const alert = state.uwmAlerts.find((item) => !item.reviewedAt && item.submissionId === submission?.id && item.conditionId === condition?.id);
  const partnerDraft = state.communicationDrafts.find((item) => item.loanId === loan?.id && item.contactId === loan?.partnerId &&
    item.audience === "Realtor" && item.milestone === "Lender review complete" && !item.supersededAt);
  const profile = state.pastClients.find((item) => item.loanId === demo?.rateLoanId);
  const rateTask = state.tasks.find((item) => item.id === `rate-watch:${demo?.rateLoanId}`);
  const portal = demo?.realtorToken && `/referrals#${demo.realtorToken}`;
  const closing = state.closingPlans.find((item) => item.loanId === loan?.id);
  const actualClosing = state.pastClients.find((item) => item.loanId === loan?.id)?.closingDate;
  const funding = state.closingProgress.find((item) => item.loanId === loan?.id)?.fundingDate;
  const processing = state.loanProcessing.find((item) => item.loanId === loan?.id);
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
      title: "Price the reviewed 1003 and submit to mock UWM",
      description: "Run mock credit and choose Price with mock score. Pricing carries over the property ZIP and loan details from the 1003. Run pricing, save a quote, and send the file to mock UWM.",
      done: Boolean(quote && currentApplicationSent),
      action: loan && application?.reviewedAt && (quote ?
        !currentApplicationSent && state.playbook.requireSecondReview && !application.secondReviewApproved ?
          <Button size="sm" onClick={() => open(loan.id, loanReviewsTarget)}>Open required second review</Button> :
          <Button size="sm" disabled={busy || Boolean(currentApplicationSent)}
          onClick={() => void save({ type: "sendApplication", loanId: loan.id, revision: application.revision, quote })}>
          {application.uwmReference ? "Send to existing UWM file (mock)" : "Send to UWM (mock)"}</Button> :
        credit?.result.status === "Report ready" ? <Button size="sm" onClick={() => openPricing(loan.id)}>Open mock pricing</Button> :
          <Button size="sm" onClick={() => open(loan.id, "credit-aus")}>Open mock credit</Button>),
    },
    {
      title: "Work the UWM condition alert",
      description: "Open an outstanding condition and request the suggested document. Attach a sample in the borrower checklist, then open the condition to review the attachment. Accept and send it, then check mock clearance.",
      done: Boolean(submission && !condition),
      action: loan && submission && condition && <>
        <Button size="sm" disabled={busy} onClick={() => openConditions(loan.id, submission.id, condition.id)}>
          {alert ? "Open condition alert" : "Open outstanding condition"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => showTasks()}>View My Tasks</Button>
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
        <Button size="sm" variant="outline" onClick={() => showTasks()}>View My Tasks</Button>
      </> : <Button size="sm" disabled={busy} onClick={() => void recordSampleRate(save, profile)}>Record sample 6.000%</Button>),
    },
  ];
  return <section className="integration record-form manager-panel demo-guide" aria-label="Guided demo walkthrough">
    <div className="demo-guide-heading">
      <h2>Referral to closing in seven steps</h2>
      {demo?.rateLoanId ? <GuideProgress steps={steps} /> : <span className="pill">5–7 minutes</span>}
    </div>
    <p className="muted">Follow a fictional file as the LO, borrower, and realtor. Lender, pricing, credit, and AUS results are mocked.</p>
    <div className="loan-application-actions">
      {(canReset || canCreate) && <Button size="sm" variant={demo ? "outline" : "default"} disabled={busy || creating} onClick={() => void start()}>
        <Play /> {creating ? "Opening pilot…" : canCreate ? "Create guided pilot" : demo ? "Reset scenario" : "Load sample scenario"}
      </Button>}
      {demo && <Button size="sm" variant="outline" aria-label="Refresh walkthrough" disabled={busy} onClick={() => void save({ type: "refreshWorkspace" })}>Refresh</Button>}
      {portal && <Button size="sm" variant="outline" asChild><a href={portal} target="_blank" rel="noopener noreferrer">Open sample realtor view <ExternalLink /></a></Button>}
      {campaign && <Button size="sm" variant="outline" onClick={() => openCampaign(campaign.id)}>View sample call campaign</Button>}
    </div>
    {setupError && <p className="application-error" role="alert">{setupError}</p>}
    {!demo?.rateLoanId ? <p className="empty-inline">{canCreate ? "Create an isolated pilot workspace, then load the sample scenario." : canReset ?
      "Load the scenario to add an assigned realtor referral and a funded client with a rate target." :
      "Ask a pilot admin to load the guided scenario and assign it to you."}</p> :
      <GuideSteps steps={steps} />}
    {loan && submission && !condition && stagesTowardClose && <section className="work-queue" aria-label="Closing and funding rehearsal">
      <div className="section-heading"><h3>Finish the file</h3>
        <span className="pill">{funding ? "Funding recorded" : actualClosing ? "Closing recorded" : "Ready for closing"}</span>
      </div>
      <p className="muted">Record actual closing and funding separately. Funding creates milestone drafts and follow-up work for the loan owner.</p>
      <div className="loan-application-actions">
        {processing?.processorEmail && <Button size="sm" variant="outline" onClick={() => open(loan.id, "processing-handoff")}>Review processor handoff</Button>}
        <Button size="sm" variant="outline" onClick={() => open(loan.id, actualClosing ? "loan-funding" : "closing-workbench")}>
          {funding ? "Review recorded funding" : actualClosing ? "Open funding form" : "Open actual closing form"}
        </Button>
        {funding && <Button size="sm" variant="outline" onClick={() => showTasks(loan.id)}>View post-funding work</Button>}
      </div>
    </section>}
  </section>;
}

function CampaignBuyerSetup({ rehearsal, staff, busy, save }: Pick<DemoGuideProps, "staff" | "busy" | "save"> & {
  rehearsal: CampaignRehearsal | null;
}) {
  const [buyer, setBuyer] = useState(rehearsal?.buyerEmail ?? "");
  const { members, error } = useLeadOwners(staff?.brokerage.id ?? null);
  const officers = members?.filter((member) => member.role === "LO") ?? [];
  const buyerAvailable = !buyer || officers.some(({ email }) => email === buyer);
  return <form className="record-form" onSubmit={(event) => {
    event.preventDefault();
    void save({ type: "loadCampaignRehearsal", id: rehearsal?.campaignId ?? crypto.randomUUID(), buyerEmail: buyer || undefined });
  }}>
    {staff && <label className="field">Walkthrough buyer owner
      <select value={buyer} disabled={busy || !members} onChange={(event) => setBuyer(event.target.value)}>
        <option value="">Default campaign routing</option>
        {!buyerAvailable && <option value={buyer}>{buyer} · unavailable</option>}
        {officers.map(({ name, email }) => <option key={email} value={email}>{name} · {email}</option>)}
      </select>
    </label>}
    {error && <p className="muted" role="status">{error}</p>}
    <div><Button size="sm" type="submit" disabled={busy || !buyerAvailable || Boolean(rehearsal && (rehearsal.buyerEmail ?? "") === buyer)}>
      <Play /> {rehearsal ? "Save walkthrough buyer owner" : "Set up campaign rehearsal"}
    </Button></div>
  </form>;
}

const processorInstructions: Record<LoanProcessing["status"], string> = {
  Unassigned: "A pilot admin can share the reviewed file with an active processor. The LO keeps ownership.",
  Assigned: "The processor can open the shared file. The LO sends it to add the acceptance task to the processor’s queue.",
  "Ready for processing": "The processor can accept the handoff from My Tasks. The LO can follow its status.",
  "In processing": "The processor can work the file and return it to the LO with a note.",
  "Returned to LO": "The LO can read the return note, complete the handoff, or send the file back.",
  Complete: "The handoff is complete. Continue the loan from the guide.",
};

function CampaignProcessorHandoff({ assignment, staff, openHandoff, openAssignment }: {
  assignment?: LoanProcessing; staff: WorkspaceStaff; openHandoff: () => void; openAssignment: () => void;
}) {
  const status = assignment?.status ?? "Unassigned";
  const hasProcessor = !!assignment?.processorEmail;
  return <section aria-label="Campaign processor handoff">
    <details className="document-form" open={hasProcessor || undefined}>
      <summary>Optional processor handoff <span className="pill">{status}</span></summary>
      <p className="muted">{processorInstructions[status]}</p>
      {hasProcessor && <p className="muted">Shared processor {assignment?.processorName || assignment?.processorEmail}</p>}
      <div className="loan-application-actions">
        {staff.brokerage.role === "Admin" && <Button size="sm" variant="outline" onClick={openAssignment}>
          {hasProcessor ? "Manage campaign processor" : "Assign campaign processor"}
        </Button>}
        {hasProcessor && <Button size="sm" variant="outline" onClick={openHandoff}>Open campaign handoff</Button>}
        {hasProcessor && status !== "Complete" && status !== "Returned to LO" &&
          <a className="name-link" href={`${brokerageUrl(staff.brokerage.id)}&guide=campaign`}>Processor task link</a>}
      </div>
    </details>
  </section>;
}

function mockConditionInstructions(submission: Submission | undefined, requests: LoanDocumentRequest[]) {
  if (!submission) return "The condition checklist opens when mock UWM returns the file receipt.";
  const byCondition = new Map(requests.filter(({ submissionId }) => submissionId === submission.id).map((request) => [request.conditionId, request]));
  const open = submission.conditions.filter(({ satisfiedAt }) => !satisfiedAt);
  const missing = open.filter(({ id }) => !byCondition.has(id));
  const suggested = missing.flatMap((condition) => suggestedConditionDocument(condition)?.kind ?? []).slice(0, conditionDocumentBatchLimit);
  const linked = open.flatMap(({ id }) => byCondition.get(id) ?? []);
  if (suggested.length > 1) return `Choose Request ${suggested.length} suggested documents. Then open the borrower checklist.`;
  if (suggested.length === 1) return `Choose Request ${suggested[0].toLowerCase()}. Then open the borrower checklist.`;
  if (missing.length) return "Open the outstanding condition and choose Request borrower document.";
  const waiting = linked.filter(({ status }) => needsBorrowerDocument(status)).length;
  if (waiting) return "In the borrower tab, get and verify the on-screen demo code once. Submit the Clean sample PDF for each request, or choose Attach text sample for a shorter rehearsal.";
  if (linked.some(({ status }) => status === "Received")) return "Review each received sample and choose Accept & send to UWM (mock). Wait for the mock delivery receipt before moving to the next document.";
  if (linked.some(({ status, uwmReceipt }) => status === "Accepted" && !uwmReceipt)) return "Send each accepted sample to mock UWM. Retry any delivery marked failed.";
  const delivered = linked.filter(({ uwmReceipt }) => uwmReceipt).length;
  return delivered > 1 ? `Choose Check mock clearance for ${delivered} documents to clear the delivered samples together.` :
    "Choose Check UWM clearance (mock) for the delivered sample.";
}

function CampaignGuide({ state, staff, busy, save, open, openConditions, openPricing, openCampaign, openContact, openProcessorAssignment, previewRealtor, showTasks, recordCheckIn, startRepeat,
  canSetup, creating, setupError, createPilot }: DemoGuideProps & {
  canSetup: boolean; creating: boolean; setupError: string; createPilot: () => void;
}) {
  const rehearsal = state.campaignRehearsal;
  const [manualChoice, setManualChoice] = useState<string | null>(null);
  const member = state.callCampaignMembers.find((item) => item.campaignId === rehearsal?.campaignId && item.leadId === rehearsal?.leadId);
  const loan = state.loans.find((item) => item.id === member?.loanId);
  const buyerLead = state.inboxLeads.find((lead) => lead.id === rehearsal?.leadId);
  const assignedBuyer = loan?.officerEmail ?? buyerLead?.officerEmail;
  const application = state.applications.find((item) => item.loanId === loan?.id);
  const processing = state.loanProcessing.find((item) => item.loanId === loan?.id);
  const credit = state.mockCreditAusRuns.find((item) => item.loanId === loan?.id && item.service === "Credit");
  const savedQuote = state.pricingRuns.filter((item) => item.loanId === loan?.id && item.selectedId)
    .sort((a, b) => (b.selectedAt ?? "").localeCompare(a.selectedAt ?? ""))[0];
  const priced = savedQuote?.mode === "mock" && quoteMatchesApplication(savedQuote.applicationRevision, application);
  const uwmSubmission = state.submissions.find((item) => item.loanId === loan?.id && item.lender === "UWM" && item.syncedAt);
  const sent = application?.versions.some((version) => version.revision === application.revision && version.uwmReceipt);
  const mockStarted = application?.versions.some((version) => version.uwmReceipt);
  const manualSubmission = loan && campaignManualSubmission(state.submissions, loan.id);
  const handoff = application?.manualHandoff;
  const manual = !mockStarted && Boolean(manualSubmission || handoff?.exportPrepared || (loan && manualChoice === loan.id));
  const campaignLender = manual ? "manual" : "uwm";
  const manualReady = Boolean(priced && handoff?.exportPrepared && handoff.outcome === "Acknowledged" && manualSubmission);
  const submission = manual ? manualSubmission : uwmSubmission;
  const condition = submission?.conditions.find((item) => !item.satisfiedAt);
  const multipleUwmConditions = !manual && (submission?.conditions.filter((item) => !item.satisfiedAt).length ?? 0) > 1;
  const cleared = manual ? manualReady && Boolean(submission?.conditions.length) && !condition : Boolean(submission && !condition);
  const pricingAction = loan && (credit?.result.status === "Report ready" ?
    <Button size="sm" onClick={() => openPricing(loan.id, campaignLender)}>Price campaign loan</Button> :
    <Button size="sm" onClick={() => open(loan.id, "credit-aus", campaignLender)}>Open mock credit</Button>);
  const canClose = loan && ["Clear to Close", "Funded", "Closed"].includes(loan.stage);
  const actualClosing = state.pastClients.find((item) => item.loanId === loan?.id)?.closingDate;
  const funding = state.closingProgress.find((item) => item.loanId === loan?.id)?.fundingDate;
  const linkedRepeat = state.returningClientLoans.find((item) => item.fundedLoanId === loan?.id);
  const repeat = loan && funding && (state.loans.find((item) => item.id === linkedRepeat?.loanId) ??
    state.loans.find((item) => item.contactId === loan.contactId && item.id !== loan.id &&
      item.leadSource === "Returning client" && state.applications.some((app) => app.loanId === item.id)));
  const checkInOpen = loan && state.tasks.some((task) => task.id === fundingTaskId(loan.id, "borrower") && !task.completedAt);
  const checkInRecorded = rehearsal?.checkInActivityId;
  const callback = state.contactActivity.find((item) => item.id === checkInRecorded && item.outcome === "Requested callback" && item.dueAt);
  const borrower = state.contacts.find((item) => item.id === loan?.contactId);
  const companion = state.demoGuide;
  const watchLoan = state.loans.find((item) => item.id === companion?.rateLoanId);
  const sampleRealtor = watchLoan && state.contacts.find((item) => item.id === watchLoan.partnerId);
  const linkedSampleRealtor = sampleRealtor && loan?.partnerId === sampleRealtor.id;
  const watch = state.pastClients.find((item) => item.loanId === watchLoan?.id);
  const watchedTask = watch && state.tasks.find((item) => item.id === `rate-watch:${watch.loanId}` && !item.completedAt);
  const partnerDraft = loan && state.communicationDrafts.find((item) => item.loanId === loan.id && item.contactId === loan.partnerId &&
    item.audience === "Realtor" && item.milestone === "Lender review complete" && !item.supersededAt);
  const partnerPortal = linkedSampleRealtor && companion?.realtorToken ? `/referrals#${companion.realtorToken}` : null;
  const callbackBlocked = callback && prospectingBlocked(callback.purpose, borrower?.outreachSuppressed);
  const canWorkCallback = callback && !callback.completedAt && !callbackBlocked &&
    (staff?.brokerage.role !== "LO" || callback.followUpOwnerEmail === staff.email);
  const imported = rehearsal?.importedCount === 2;
  const steps: GuideStep[] = [
    {
      title: "Import the fictional campaign CSV",
      description: "Open the importer and upload the rehearsal CSV, or choose Load rehearsal leads. Choose Preview 2 leads, then Import into campaign. Routing assigns the buyer to the selected or first available officer. Leads over the active officers’ caps wait in the shared inbox.",
      done: imported,
      action: rehearsal && canSetup && !imported && <>
        <Button size="sm" onClick={() => openCampaign(rehearsal.campaignId)}>Open campaign import</Button>
        <Button size="sm" variant="outline" onClick={() => downloadSampleFile(campaignRehearsalCsv, "orbit-campaign-rehearsal.csv", "text/csv")}>Download rehearsal CSV</Button>
      </>,
      detail: imported && <p className="muted">2 leads imported · Buyer owner {loan?.officer || buyerLead?.officer || "Shared inbox"}</p>,
    },
    {
      title: "Log a call and start the 1003",
      description: "In Ready to call, open Jordan’s assigned lead, log a Connected outcome, and choose Start 1003. If that frees a routing slot, the next eligible lead can move from Shared queue to Ready to call.",
      done: Boolean(member?.reachedAt && loan),
      action: rehearsal && member && !loan && <Button size="sm" onClick={() => openCampaign(rehearsal.campaignId, member.leadId)}>Open campaign buyer <ArrowRight /></Button>,
    },
    {
      title: "Submit and review the 1003",
      description: "Open borrower view in a second tab. Choose Load sample and review, confirm the fictional answers, and submit. Return to the loan and choose Mark reviewed. Keep the borrower tab open for the document checklist.",
      done: Boolean(application?.reviewedAt),
      action: loan && !application?.reviewedAt && <Button size="sm" onClick={() => open(loan.id, "loan-application")}>Open campaign 1003</Button>,
      detail: <>{canSetup && loan && sampleRealtor && companion?.realtorToken && !loan.partnerId && !mockStarted && !manualSubmission &&
        (loan.disposition ?? "Active") === "Active" && !["Funded", "Closed"].includes(loan.stage) &&
        <div className="loan-application-actions">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void save({
            type: "linkCampaignSampleRealtor", loanId: loan.id, scenarioId: companion.id,
          })}>Link sample realtor</Button>
          <span className="muted">Link {sampleRealtor.name} before the lender handoff to show milestone updates.</span>
        </div>}
      {linkedSampleRealtor && <p className="muted">Sample realtor linked · {sampleRealtor.name}</p>}
      {staff?.brokerage.pilot && loan && (application?.reviewedAt || processing?.processorEmail) &&
        <CampaignProcessorHandoff assignment={processing} staff={staff} openHandoff={() => open(loan.id, "processing-handoff")}
          openAssignment={() => openProcessorAssignment(loan.id)} />}</>,
    },
    {
      title: manual ? "Price the file and rehearse a manual lender handoff" : "Price the file and send it to mock UWM",
      description: manual ?
        "Check Confirm mock credit authorization, run mock credit, and choose Price with mock score. Save a quote and open the MISMO export. Download the file, then record the simulated acknowledgment in the same panel." :
        "Check Confirm mock credit authorization, run mock credit, and choose Price with mock score. Run pricing, save a quote, and choose Send reviewed 1003 to mock UWM to open the lender checklist.",
      done: manual ? manualReady : Boolean(priced && sent),
      action: loan && application?.reviewedAt && (!priced ? pricingAction : manual ? !manualReady &&
        <Button size="sm" onClick={() => open(loan.id, "manual-lender-export", "manual")}>Open manual MISMO handoff</Button> :
        !sent && state.playbook.requireSecondReview && !application.secondReviewApproved ?
          <Button size="sm" onClick={() => open(loan.id, loanReviewsTarget)}>Open required second review</Button> :
        !sent && <Button size="sm" disabled={busy} onClick={() => void save({
        type: "sendApplication", loanId: loan.id, revision: application.revision,
        quote: { runId: savedQuote.id, offerId: savedQuote.selectedId },
      })}>Send campaign file to mock UWM</Button>),
      detail: loan && application?.reviewedAt && !mockStarted && !manualSubmission && !handoff?.exportPrepared &&
        <div className="loan-application-actions" role="group" aria-label="Lender handoff path">
          <Button size="sm" variant="outline" aria-pressed={!manual} onClick={() => setManualChoice(null)}>Mock UWM path</Button>
          <Button size="sm" variant="outline" aria-pressed={manual} onClick={() => setManualChoice(loan.id)}>Manual MISMO path</Button>
        </div>,
    },
    {
      title: manual ? "Clear the manual lender condition" : "Clear the lender conditions",
      description: manual ?
        "Add a fictional Income condition for a pay stub. Use the suggested request, attach a sample from the borrower checklist, then accept it. Record a fictional delivery reference and the lender’s clearance." :
        mockConditionInstructions(uwmSubmission, state.documentRequests),
      done: cleared,
      action: loan && submission && (condition && (!manual || manualReady) ?
        <Button size="sm" disabled={busy} onClick={() => openConditions(loan.id, submission.id, multipleUwmConditions ? undefined : condition.id)}>
          {manual ? "Work manual lender condition" : multipleUwmConditions ? "Open UWM condition checklist" : "Work outstanding condition"}
        </Button> :
        manualReady && !submission.conditions.length &&
          <Button size="sm" disabled={busy} onClick={() => openConditions(loan.id, submission.id)}>Open fictional lender conditions</Button>),
      detail: loan && cleared && (partnerDraft || partnerPortal) && <div className="loan-application-actions">
        {partnerDraft && <Button size="sm" variant="outline" onClick={() => previewRealtor(loan.id, partnerDraft.id)}>Preview realtor milestone</Button>}
        {partnerPortal && <Button size="sm" variant="outline" asChild><a href={partnerPortal} target="_blank" rel="noopener noreferrer">Open sample realtor view <ExternalLink /></a></Button>}
      </div>,
    },
    {
      title: "Close and fund the original loan",
      description: !canClose ? "Move the cleared file to Clear to Close. Open the sample realtor view to show the milestone." :
        !actualClosing ? "Open the closing form, choose Use today for closing, and select Record closing. The funding form opens next." :
          "Choose Use today for funding, then Record funding. Funding adds the borrower check-in to My Tasks.",
      done: Boolean(actualClosing && funding),
      action: loan && cleared && (canClose ? <>
        <Button size="sm" onClick={() => open(loan.id, actualClosing ? "loan-funding" : "loan-closing-date", campaignLender)}>
          {funding ? "Review campaign funding" : actualClosing ? "Open campaign funding form" : "Open campaign closing form"}
        </Button>
        {funding && <Button size="sm" variant="outline" onClick={() => showTasks(loan.id)}>View post-funding work</Button>}
      </> : <Button size="sm" disabled={busy} onClick={() => void save({ type: "move", id: loan.id, stage: "Clear to Close" })}>Move campaign loan to Clear to Close</Button>),
    },
    {
      title: "Start a repeat application",
      description: checkInOpen ? "Start a returning-client 1003 from the borrower check-in in My Tasks. Choose the new loan purpose, then use your browser’s Back button to return to the guide and review campaign conversion." :
        "Start a separate 1003 for this borrower. Use your browser’s Back button to return to the guide and review campaign conversion.",
      done: Boolean(repeat),
      action: loan && funding && (repeat && rehearsal ? <>
        <Button size="sm" onClick={() => openCampaign(rehearsal.campaignId)}>Review campaign conversion</Button>
        <Button size="sm" variant="outline" onClick={() => open(repeat.id, "loan-application")}>Open repeat 1003</Button>
      </> : checkInOpen ? <Button size="sm" onClick={() => showTasks(loan.id)}>Open borrower check-in task</Button> :
        checkInRecorded ? <Button size="sm" onClick={() => startRepeat(loan.id)}>Start returning-client 1003</Button> :
          <Button size="sm" onClick={() => openContact(loan.contactId)}>Open campaign borrower history</Button>),
    },
  ];

  return <section className="integration record-form manager-panel demo-guide" aria-label="Campaign demo walkthrough">
    <div className="demo-guide-heading"><h2>CSV to repeat loan</h2>{rehearsal && <GuideProgress steps={steps} />}</div>
    <p className="muted">Work a fictional purchase lead from CSV through funding and a separate returning-client 1003. Credit, pricing, and lender results are mocked.</p>
    {canSetup && !rehearsal?.leadId && <CampaignBuyerSetup key={`${rehearsal?.campaignId}:${rehearsal?.buyerEmail}`} rehearsal={rehearsal} staff={staff} busy={busy} save={save} />}
    {canSetup && staff && assignedBuyer && assignedBuyer !== staff.email && <p className="muted">
      Walkthrough buyer assigned to {assignedBuyer}. Use the <a className="name-link" href={`${brokerageUrl(staff.brokerage.id)}&guide=campaign`}>LO walkthrough link</a> in that officer’s signed-in session.
    </p>}
    <div className="loan-application-actions">
      {staff?.brokerage.role === "Admin" && (!canSetup || repeat) && <Button size="sm" variant={repeat ? "outline" : "default"} disabled={busy || creating} onClick={createPilot}>
        {creating ? "Opening pilot…" : repeat ? "Start in a fresh pilot" : "Create guided pilot"}
      </Button>}
      {(rehearsal || (staff?.brokerage.pilot && staff.brokerage.role === "LO")) &&
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void save({ type: "refreshWorkspace" })}>Refresh campaign walkthrough</Button>}
    </div>
    {setupError && <p className="application-error" role="alert">{setupError}</p>}
    {canSetup && !companion && <div className="loan-application-actions">
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void save({ type: "loadGuidedDemo", id: crypto.randomUUID(), previousId: null })}>Load realtor and rate-watch examples</Button>
      <span className="muted">Adds the fictional realtor and past client for the relationship steps.</span>
    </div>}
    {rehearsal ? <GuideSteps steps={steps} /> : <p className="empty-inline">{canSetup ? "Set up the empty campaign and routing, then import the two fictional leads." :
      staff?.brokerage.role === "Admin" ? "Create an isolated fictional workspace to run the campaign walkthrough." :
        "Ask a pilot admin to set up the rehearsal and assign the campaign buyer to you."}</p>}
    {loan && funding && <section className="work-queue" aria-label="Borrower callback rehearsal">
      <div className="section-heading"><h3>Turn a funded loan into follow-up work</h3>
        <span className="pill">{callback?.completedAt ? "Callback completed" : callbackBlocked ? "Outreach opt-out" : callback ? "Callback scheduled" :
          checkInOpen ? "Check-in ready" : checkInRecorded ? "Check-in recorded" : "Check-in closed"}</span></div>
      {checkInOpen ? <p className="muted">Record a check-in with <strong>Requested callback</strong> and choose a future date. Orbit adds it to the loan officer’s queue.</p> :
        callback?.completedAt ? <p className="muted">The callback outcome is in the borrower’s contact history.</p> :
        callbackBlocked ? <p className="muted">The borrower’s outreach preference blocks this callback.</p> :
        callback?.dueAt ? <p className="muted">{callback.followUpOwner || "Unassigned"} · Due {dateTime(callback.dueAt)} ET. Open the task to reschedule or record an outcome.</p> :
        <p className="muted">Open the borrower’s history to review recorded outreach.</p>}
      <div className="loan-application-actions">
        {checkInOpen && <Button size="sm" disabled={busy} onClick={() => recordCheckIn(loan.id)}>Record borrower check-in</Button>}
        {canWorkCallback && <Button size="sm" onClick={() => showTasks(loan.id, callback.id)}>Open callback task</Button>}
        {!checkInOpen && <Button size="sm" variant="outline" onClick={() => openContact(loan.contactId)}>View borrower history</Button>}
      </div>
    </section>}
    {watch && <section className="work-queue" aria-label="Past-client rate watch rehearsal">
      <div className="section-heading"><h3>Show the next rate-watch opportunity</h3>{watchedTask && <span className="pill">Follow-up ready</span>}</div>
      <p className="muted">Casey’s fictional watch target is {watch.targetRate?.toFixed(3) ?? "—"}%. Record a sample 6.000% observation to see the resulting follow-up.</p>
      <div className="loan-application-actions">
        {watchedTask ? <Button size="sm" onClick={() => showTasks(watch.loanId)}>Open rate-watch follow-up queue</Button> :
          <Button size="sm" disabled={busy} onClick={() => void recordSampleRate(save, watch)}>Record sample 6.000%</Button>}
        <Button size="sm" variant="outline" onClick={() => open(watch.loanId, "loan-retention")}>View past-client record</Button>
      </div>
    </section>}
  </section>;
}
