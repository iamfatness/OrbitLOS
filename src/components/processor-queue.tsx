"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { readProcessingWork, saveProcessingView } from "@/app/actions";
import type { BrokerageMember } from "@/lib/brokerage-model";
import type { IncomingLoanWorkItem } from "@/lib/incoming-loan-work-model";
import { dateLabel, easternDate } from "@/lib/client-retention";
import { processorFeeTarget } from "@/lib/processor-fee-model";
import { serviceOrderTarget, serviceOrderViews } from "@/lib/service-order-model";
import { closingWorkloadWindows, conditionAgingDays, processingExceptions, processingViewFilters,
  type ProcessingViewChange, type ProcessorQueueFile, type ProcessorQueuePage, type ProcessorQueueQuery } from "@/lib/processor-queue-model";
import { dateTime } from "@/lib/utils";
import { observeTabReturn, observeVisibleChecks } from "@/lib/tab-return";
import { ConversationReplies } from "./conversation-replies";
import { IncomingLoanWorkQueue } from "./incoming-loan-work-queue";
import { ProcessorAssignmentRecovery, useProcessorAssignmentShortcut } from "./processor-assignment-recovery";
import { Button } from "./ui/button";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

const descriptions = {
  Unassigned: "Reviewed 1003s and active processing-stage loans that need a shared processor.",
  "Stalled handoffs": "Files past your playbook deadline to send, resend, or accept a handoff.",
  "Aging conditions": "Oldest recorded openings first. Reopening restarts the clock. Conditions without a recorded opening are available on the loan.",
} satisfies Record<(typeof processingExceptions)[number], string>;
const empty = {
  Unassigned: "No active files are waiting for a processor.",
  "Stalled handoffs": "No handoffs are past your playbook deadline.",
  "Aging conditions": "No active conditions with a recorded opening.",
} satisfies Record<(typeof processingExceptions)[number], string>;

type AssignmentResult = { brokerageId: string } & (
  { name: string; loanId: string; processorName: string } | { error: string }
);

function QueueProcessorForm({ endpoint, file, busy, save, cancel }: {
  endpoint: string; file: ProcessorQueueFile; busy: boolean; save: (email: string) => void; cancel: () => void;
}) {
  const [roster, setRoster] = useState<{ members: BrokerageMember[] } | { error: string }>();
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${endpoint}&view=processors`, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error();
      const data = await response.json() as { members: BrokerageMember[] };
      if (!controller.signal.aborted) setRoster(data);
    }).catch(() => {
      if (!controller.signal.aborted) setRoster({ error: "Could not load active processors. Close and reopen the assignment to retry." });
    });
    return () => controller.abort();
  }, [endpoint]);
  const members = roster && "members" in roster ? roster.members : undefined;
  return <form className="brokerage-form" onSubmit={(event) => {
    event.preventDefault();
    const email = new FormData(event.currentTarget).get("processor");
    if (typeof email === "string" && email) save(email);
  }}>
    {!roster && <p role="status">Loading active processors…</p>}
    {roster && "error" in roster && <p role="alert">{roster.error}</p>}
    {members && (members.length ? <label className="field">Shared processor
      <select name="processor" aria-label={`Processor for ${file.name}`} required disabled={busy} defaultValue="">
        <option value="" disabled>Choose an active processor</option>
        {members.map((member) => <option key={member.email} value={member.email}>{member.name} · {member.email}</option>)}
      </select></label> : <p className="muted">No active processors. Invite or update a staff member in Team.</p>)}
    <div className="loan-application-actions">
      {Boolean(members?.length) && <Button size="sm" type="submit" disabled={busy}>Assign processor</Button>}
      <Button size="sm" type="button" variant="outline" disabled={busy} onClick={cancel}>Cancel</Button>
    </div>
  </form>;
}

export function ProcessorQueue({ brokerageId, version, team, reviewingLoan, mockServices, openIncomingLoanWork, openLoan, openReply, openTasks, openAssignment, onAssignment, complianceWork, initialReadyOnly = false }: {
  brokerageId: string; version: object; team: boolean; openLoan: (id: string, target: string) => void; openTasks: () => void;
  mockServices: boolean;
  reviewingLoan: boolean; openIncomingLoanWork: (item: IncomingLoanWorkItem) => void;
  openReply: (id: string) => void;
  openAssignment?: (id: string) => void;
  onAssignment?: () => void;
  complianceWork?: ReactNode;
  initialReadyOnly?: boolean;
}) {
  const [query, setQuery] = useState<ProcessorQueueQuery>({ readyOnly: initialReadyOnly });
  const [data, setData] = useState<{ version: object; query: ProcessorQueueQuery; result: ProcessorQueuePage | { error: string } }>();
  const [assignmentLoanId, setAssignmentLoanId] = useState<string>();
  const recovery = useProcessorAssignmentShortcut(brokerageId, Boolean(onAssignment));
  const assigning = Boolean(recovery.activity);
  const [assignmentResult, setAssignmentResult] = useState<AssignmentResult>();
  const assignmentAction = useRef<HTMLButtonElement>(null);
  const [selectedView, setSelectedView] = useState("");
  const [savingView, setSavingView] = useState(false);
  const [viewResult, setViewResult] = useState<{ message: string } | { error: string }>();
  const viewAttempt = useRef<{ key: string; id: string } | null>(null);
  const endpoint = `/api/brokerages?brokerage=${encodeURIComponent(brokerageId)}`;
  const feeFilter = useRef<HTMLButtonElement>(null);
  const feeOpened = useRef<{ loanId: string; version: number; from: ProcessorQueuePage["feeOffers"] }>(null);
  const pauseLiveQueue = reviewingLoan && (query.readyOnly || Boolean(query.feeOffers));
  useEffect(() => {
    if (pauseLiveQueue) return;
    let active = true;
    let reading = false;
    async function refreshQueue(isCurrent: () => boolean, initial = false) {
      if (reading) return;
      reading = true;
      try {
        const result = await readProcessingWork(query, brokerageId);
        if (active && isCurrent()) setData({ version, query, result });
      } catch {
        if (initial && active) setData({ version, query, result: { error: "Could not load processing work. Try refreshing." } });
      } finally { reading = false; }
    }
    void refreshQueue(() => true, true);
    const watch = (query.readyOnly && !query.after) || Boolean(query.feeOffers && !query.feeOffers.after);
    const stopReturn = watch ? observeTabReturn(document, window, (isCurrent) => void refreshQueue(isCurrent)) : undefined;
    const stopChecks = watch ? observeVisibleChecks(document, window, refreshQueue, 5_000) : undefined;
    return () => { active = false; stopReturn?.(); stopChecks?.(); };
  }, [brokerageId, pauseLiveQueue, query, version]);
  const assignment = onAssignment && assignmentResult?.brokerageId === brokerageId ? assignmentResult : undefined;
  useEffect(() => {
    if (!assignment || "error" in assignment) return;
    assignmentAction.current?.focus({ preventScroll: true });
    assignmentAction.current?.scrollIntoView({ block: "center" });
  }, [assignment]);

  const current = data?.version === version && data.query === query ? data.result : undefined;
  const page = current && !("error" in current) ? current : undefined;
  const views = data && !("error" in data.result) ? data.result.views : undefined;
  const today = page ? easternDate(new Date(page.checkedAt)) : "";
  const { exception, readyOnly, workload, serviceOrders, feeOffers } = query;
  const feePage = page?.feeOffers;
  const workloadPage = page?.workload;
  const orderPage = page?.serviceOrders;
  const unassignedFiles = workloadPage?.processors.find(({ email }) => email === "unassigned")?.files ?? 0;
  const select = (next: ProcessorQueueQuery) => { setAssignmentLoanId(undefined); setAssignmentResult(undefined); setQuery(next); };
  const refresh = () => select(feeOffers ? { readyOnly: false, feeOffers: {} } : serviceOrders ? { readyOnly: false, serviceOrders: { view: serviceOrders.view } } : processingViewFilters.parse(query));
  const controlsBusy = assigning || savingView;

  useEffect(() => {
    if (reviewingLoan || !feePage || !feeOpened.current || feePage === feeOpened.current.from) return;
    const opened = feeOpened.current;
    feeOpened.current = null;
    if (!feePage.rows.some(row => row.loanId === opened.loanId && row.version === opened.version)) feeFilter.current?.focus();
  }, [reviewingLoan, feePage]);

  function switchFilter(next: ProcessorQueueQuery, viewId = "") {
    feeOpened.current = null;
    setSelectedView(viewId);
    setViewResult(undefined);
    select(next);
  }

  async function changeView(input: ProcessingViewChange, after: () => void) {
    if (controlsBusy) return;
    setSavingView(true);
    setViewResult(undefined);
    try {
      const result = await saveProcessingView(input, brokerageId);
      if (!("message" in result)) {
        setViewResult({ error: "error" in result ? result.error : "Could not save the processing view." });
        return;
      }
      after();
      setViewResult({ message: result.message });
      refresh();
    } catch {
      setViewResult({ error: "Could not confirm the change. Try again." });
    } finally { setSavingView(false); }
  }
  async function assign(file: ProcessorQueueFile, email: string) {
    if (assigning || recovery.pending || file.assignmentRevision === undefined || !onAssignment) return;
    setAssignmentResult(undefined);
    const result = await recovery.save({ loanId: file.id, email, revision: file.assignmentRevision, requireUnassigned: true }, file.name);
    if (result.kind === "unconfirmed") return;
    if (page?.files.length === 1) refresh();
    else select({ ...query });
    if (result.kind === "saved" && result.processing) {
      onAssignment();
      setAssignmentResult({ brokerageId, name: file.name, loanId: result.processing.loanId, processorName: result.processing.processorName });
    } else if (result.kind === "rejected") setAssignmentResult({ brokerageId, error: result.error });
  }
  return <section className="integration record-form manager-panel processing-panel" aria-label="Processing queue">
    <div className="section-heading"><h2>{team ? "Team processing queue" : "My processing queue"}</h2>
      {page && <span className="pill">Checked {dateTime(page.checkedAt)} ET</span>}</div>
    <p className="muted">{feeOffers ? "Oldest fee offers waiting for the assigned processor appear first." : serviceOrders ? "Review mock property services and employment, income, and asset verifications. Earliest due dates appear first." :
      workload ? "Compare active processing files by target closing date. Closing recorded shows active files with an actual closing date." : exception ? descriptions[exception] :
      "Oldest handoff updates appear first."}
      {page?.handoffHours && ` Current deadline: ${page.handoffHours} hours.`}</p>
    {!readyOnly && !exception && !workload && !serviceOrders && !feeOffers && <>
      <IncomingLoanWorkQueue brokerageId={brokerageId} view="processing"
        paused={reviewingLoan || controlsBusy || Boolean(assignmentLoanId)} version={version} open={openIncomingLoanWork} />
      {complianceWork}
    </>}
    <div className="loan-application-actions" role="group" aria-label="Processing queue filter">
      <Button size="sm" variant={!readyOnly && !exception && !workload && !serviceOrders && !feeOffers ? "default" : "outline"} disabled={controlsBusy} aria-pressed={!readyOnly && !exception && !workload && !serviceOrders && !feeOffers} onClick={() => switchFilter({ readyOnly: false })}>Assigned files</Button>
      <Button size="sm" variant={readyOnly ? "default" : "outline"} disabled={controlsBusy} aria-pressed={readyOnly} onClick={() => switchFilter({ readyOnly: true })}>Ready to accept</Button>
      <Button size="sm" variant={workload ? "default" : "outline"} disabled={controlsBusy} aria-pressed={Boolean(workload)}
        onClick={() => switchFilter({ readyOnly: false, workload: { processor: "" } })}>Closing workload</Button>
      <Button ref={feeFilter} size="sm" variant={feeOffers ? "default" : "outline"} disabled={controlsBusy}
        aria-label="Pending fee offers" aria-pressed={Boolean(feeOffers)}
        onClick={() => switchFilter({ readyOnly: false, feeOffers: {} })}>Pending fee offers
        {page?.feeOfferCount !== undefined && ` · ${page.feeOfferCount}`}</Button>
      {mockServices && <Button size="sm" variant={serviceOrders ? "default" : "outline"} disabled={controlsBusy}
        aria-pressed={Boolean(serviceOrders)} onClick={() => switchFilter({ readyOnly: false, serviceOrders: { view: "Open" } })}>Service orders</Button>}
      {team && processingExceptions.map((item) => <Button key={item} size="sm" variant={exception === item ? "default" : "outline"}
        disabled={controlsBusy} aria-pressed={exception === item} onClick={() => switchFilter({ readyOnly: false, exception: item })}>{item}</Button>)}
      <Button size="sm" variant="outline" disabled={controlsBusy} onClick={refresh}>Refresh processing</Button>
      <Button size="sm" variant="ghost" onClick={openTasks}>Open full task queue</Button>
    </div>
    {!serviceOrders && !feeOffers && views && <section className="record-form" aria-label="Saved processing views">
      <div className="form-grid">
        <label className="field">Saved processing view<select value={selectedView} disabled={controlsBusy} onChange={(event) => {
          const view = views.find(({ id }) => id === event.target.value);
          if (view) switchFilter(view.filters, view.id);
          else { setSelectedView(""); setAssignmentResult(undefined); }
        }}><option value="">{views.length ? "Choose a saved view" : "No saved views yet"}</option>
          {views.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
        </select></label>
        <form className="task-form" onSubmit={(event) => {
          event.preventDefault();
          if (!page) return;
          const form = event.currentTarget;
          const name = String(new FormData(form).get("name") ?? "").trim();
          const filters = processingViewFilters.parse(query);
          const key = JSON.stringify({ name, filters });
          if (viewAttempt.current?.key !== key) viewAttempt.current = { key, id: crypto.randomUUID() };
          const { id } = viewAttempt.current;
          void changeView({ type: "saveView", id, name, filters }, () => { setSelectedView(id); form.reset(); viewAttempt.current = null; });
        }}><label className="field">New processing view name<input name="name" required maxLength={80} /></label>
          <Button size="sm" type="submit" disabled={!page || controlsBusy}>Save processing view</Button>
        </form>
      </div>
      {views.some(({ id }) => id === selectedView) && <div><Button size="sm" variant="outline" disabled={controlsBusy}
        onClick={() => void changeView({ type: "removeView", id: selectedView }, () => setSelectedView(""))}>Remove saved processing view</Button></div>}
    </section>}
    {viewResult && ("error" in viewResult ? <p role="alert">{viewResult.error}</p> : <p role="status">{viewResult.message}</p>)}
    {workload && <>
      {team && <div className="calendar-filters"><label className="field workload-owner">Processing assignee
        <select disabled={controlsBusy} value={workload.processor} onChange={(event) => switchFilter({ ...query,
          workload: { ...workload, processor: event.target.value, after: undefined },
        })}>
          <option value="">All processors and unassigned</option>
          <option value="unassigned">Unassigned{workloadPage && ` · ${unassignedFiles} ${unassignedFiles === 1 ? "file" : "files"}`}</option>
          {workload.processor && workload.processor !== "unassigned" && !workloadPage?.processors.some(({ email }) => email === workload.processor) &&
            <option value={workload.processor}>{workload.processor}</option>}
          {workloadPage?.processors.filter(({ email }) => email !== "unassigned").map(({ email, name, files }) =>
            <option key={email} value={email}>{name} · {files} {files === 1 ? "file" : "files"}{name !== email ? ` (${email})` : ""}</option>)}
        </select>
      </label></div>}
      {workloadPage && <p className="muted">The seven-day window runs through {dateLabel(workloadPage.through)} ET.</p>}
      <div className="campaign-metrics" role="group" aria-label="Closing windows" aria-busy={!current}>{closingWorkloadWindows.map((window) => {
        const count = workloadPage?.windows.find((item) => item.window === window)?.files;
        return <button key={window} type="button" disabled={controlsBusy} aria-pressed={workload.window === window} onClick={() => switchFilter({ ...query,
          workload: { ...workload, window: workload.window === window ? undefined : window, after: undefined },
        })}><span>{window}</span><strong>{count ?? "—"}</strong><span>{count === 1 ? "file" : "files"}</span></button>;
      })}</div>
    </>}
    <ProcessorAssignmentRecovery recovery={recovery} open={openAssignment} refresh={() => {
      setAssignmentLoanId(undefined);
      onAssignment?.();
    }} />
    {assignment && !recovery.pending && ("error" in assignment ? <p role="alert">{assignment.error}</p> :
      <div className="document-item" role="group" aria-label="Processor assignment confirmation">
        <div role="status"><strong>Processor assigned</strong>
          <p id="processing-assignment-file" className="muted">{assignment.name} · {assignment.processorName}</p></div>
        <div><Button ref={assignmentAction} size="sm" aria-describedby="processing-assignment-file"
          onClick={() => openLoan(assignment.loanId, "processing-handoff")}>Open handoff</Button></div>
      </div>)}
    {!current && <p className="muted" role="status">Loading processing work…</p>}
    {current && "error" in current && <p role="alert">{current.error}</p>}
    {serviceOrders && <section className="record-form" aria-label="Mock service order queue">
      <div className="loan-application-actions" role="group" aria-label="Service order status">
        {serviceOrderViews.map((view) => <Button key={view} size="sm" variant={serviceOrders.view === view ? "default" : "outline"}
          aria-pressed={serviceOrders.view === view} onClick={() => select({ readyOnly: false, serviceOrders: { view } })}>{view}</Button>)}
      </div>
      {page && !orderPage && <p className="muted">The service order queue is temporarily unavailable. Refresh processing to try again.</p>}
      {orderPage && (orderPage.rows.length ? <ul className="loan-task-list">{orderPage.rows.map((order) =>
        <li className="document-item" key={order.id}>
          <div className="document-item-head"><strong>{order.kind} · {order.name}{order.recipient && ` · ${order.recipient}`}</strong><span className="pill">{order.status}</span></div>
          <p className="muted">{order.owner} · {order.dueOn < orderPage.today ? "Overdue since" : "Due"} {dateLabel(order.dueOn)} ET</p>
          <div><Button size="sm" variant="outline" onClick={() => openLoan(order.loanId, serviceOrderTarget(order.id))}>
            Open {order.kind.toLowerCase()} order{order.recipient && ` · ${order.recipient}`}
          </Button></div>
        </li>)}</ul> : <p className="empty-inline">No mock service orders match this view.</p>)}
      {(serviceOrders.after || orderPage?.next) && <div className="loan-application-actions">
        {serviceOrders.after && <Button size="sm" variant="outline" onClick={refresh}>First page</Button>}
        {orderPage?.next && <Button size="sm" variant="outline" onClick={() => select({
          readyOnly: false, serviceOrders: { view: serviceOrders.view, after: orderPage.next ?? undefined },
        })}>Next page</Button>}
      </div>}
    </section>}
    {feePage && <section className="record-form" aria-label="Pending processing fee offers">
      {feePage.count > 0 && <h3>{feePage.count} {feePage.count === 1 ? "offer" : "offers"} waiting for a response</h3>}
      {feePage.rows.length ? <ul className="loan-task-list">{feePage.rows.map(row => <li className="document-item" key={row.loanId}>
        <div className="document-item-head"><strong>{row.name}</strong><span className="pill">Version {row.version}</span></div>
        <p>{usd.format(row.amountCents / 100)}
          {team && ` · ${row.processorName}`} · Offered {dateTime(row.offeredAt)} ET</p>
        <div><Button size="sm" variant="outline" onClick={() => {
          feeOpened.current = { loanId: row.loanId, version: row.version, from: feePage };
          openLoan(row.loanId, processorFeeTarget(row.version));
        }}>Open fee terms</Button></div>
      </li>)}</ul> : <p className="empty-inline">{feeOffers?.after && feePage.count ? "No offers remain on this page." :
        "No processing fee offers are waiting for a response."}</p>}
      {(feeOffers?.after || feePage.next) && <div className="loan-application-actions">
        {feeOffers?.after && <Button size="sm" variant="outline" onClick={refresh}>First page</Button>}
        {feePage.next && <Button size="sm" variant="outline" onClick={() => select({
          readyOnly: false, feeOffers: { after: feePage.next ?? undefined },
        })}>Next page</Button>}
      </div>}
    </section>}
    {page && !serviceOrders && !feeOffers && <>
      {page.replies && <ConversationReplies page={page.replies} today={today} after={query.replyAfter} open={openReply} showOwner={team}
        onPage={(replyAfter) => select({ ...query, replyAfter })} />}
      {page.files.length ? <ul className="loan-task-list">{page.files.map((file) => {
        const condition = file.condition;
        const canAssign = !!onAssignment && file.assignmentRevision !== undefined;
        const assignmentOpen = canAssign && assignmentLoanId === file.id;
        const age = condition?.openedAt ? Math.max(0, Math.floor((Date.parse(page.checkedAt) - Date.parse(condition.openedAt)) / 86_400_000)) : null;
        return <li className="document-item record-form" key={condition?.openedAt ? condition.target : file.id}>
        <div className="document-item-head"><strong>{file.name}</strong><span className="pill">{file.status}</span></div>
        <p className="muted">{file.officer || "Unassigned LO"}{team && ` · ${file.processorName || "No processor"}`}
          {!exception && !workload && ` · Handoff updated ${dateTime(file.updatedAt)} ET`}
          {file.handoffDueAt && ` · Overdue since ${dateTime(file.handoffDueAt)} ET`}</p>
        {condition?.openedAt ? <p>
          {age !== null && age >= conditionAgingDays && <span className="pill">Aging</span>} {condition.lender} · {condition.title} · {condition.action} · Open {age === 0 ? "less than a day" : `${age} ${age === 1 ? "day" : "days"}`}
        </p> : condition ? <p>{condition.count} open {condition.count === 1 ? "condition" : "conditions"} · {condition.title} · {condition.action}</p> :
          <p className="muted">No open lender conditions.</p>}
        {(file.closing || file.targetDate || file.closingDate) && <p>
          {file.closing && `${file.closing.count} open closing ${file.closing.count === 1 ? "item" : "items"} · ${file.closing.dueDate < today ? "Overdue" : "Next due"} ${dateLabel(file.closing.dueDate)}`}
          {file.closing && (file.targetDate || file.closingDate) && " · "}
          {file.closingDate ? `Closing recorded ${dateLabel(file.closingDate)}` : file.targetDate && `Target closing ${dateLabel(file.targetDate)}`}
        </p>}
        <div className="loan-application-actions">
          {canAssign && !assignmentOpen && <Button size="sm" disabled={assigning || recovery.pending} onClick={() => {
            setAssignmentResult(undefined);
            setAssignmentLoanId(file.id);
          }}>Assign processor</Button>}
          {!canAssign && openAssignment && file.status === "Unassigned" && <Button size="sm" disabled={assigning} onClick={() => openAssignment(file.id)}>Assign processor</Button>}
          {openAssignment && file.status !== "Unassigned" && <Button size="sm" variant="outline" disabled={assigning}
            onClick={() => openAssignment(file.id)}>Manage assignment</Button>}
          <Button size="sm" variant={file.status === "Ready for processing" && !condition?.openedAt ? "default" : "outline"} onClick={() => openLoan(file.id, "processing-handoff")}>Open handoff</Button>
          {condition && <Button size="sm" variant={condition.openedAt ? "default" : "outline"} onClick={() => openLoan(file.id, condition.target)}>Open condition</Button>}
          {(file.closing || file.targetDate || file.closingDate) && <Button size="sm" variant="outline" onClick={() => openLoan(file.id, file.closing?.target ?? "closing-workbench")}>
            {file.closing?.target ? "Open next closing item" : "Open closing"}</Button>}
        </div>
        {assignmentOpen && <QueueProcessorForm endpoint={endpoint} file={file} busy={assigning || recovery.pending}
          save={(email) => void assign(file, email)} cancel={() => setAssignmentLoanId(undefined)} />}
      </li>;})}</ul> : <p className="empty-inline">{workload ? "No active processing files match this closing window and assignee." :
        exception ? empty[exception] : readyOnly ? "No assigned handoffs are waiting for acceptance." : "No active assigned processing files."}</p>}
      <div className="loan-application-actions">
        {query.after && <Button size="sm" variant="outline" disabled={assigning} onClick={() => select({ ...query, after: undefined })}>First page</Button>}
        {page.next && <Button size="sm" variant="outline" disabled={assigning} onClick={() => select({ ...query, after: page.next ?? undefined })}>Next page</Button>}
        {workload?.after && <Button size="sm" variant="outline" disabled={assigning} onClick={refresh}>First page</Button>}
        {workload && workloadPage?.next && <Button size="sm" variant="outline" disabled={assigning} onClick={() => select({ ...query,
          workload: { ...workload, after: workloadPage.next ?? undefined },
        })}>Next page</Button>}
      </div>
    </>}
  </section>;
}
