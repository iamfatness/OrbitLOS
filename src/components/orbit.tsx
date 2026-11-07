"use client";

import { useRef, useState, type DragEvent } from "react";
import {
  ArrowDownUp, ArrowRight, CircleCheck, ClipboardCheck, Columns3, ContactRound, FileCheck2, LayoutDashboard,
  HeartHandshake, List, LogOut, Mail, MapPin, Menu, Orbit as OrbitIcon, Plus, RefreshCw, Search, SlidersHorizontal, UsersRound, Wallet, X, Zap,
} from "lucide-react";
import { mutate } from "@/app/actions";
import { stages, type Loan, type Stage, type Workspace } from "@/lib/model";
import { compactMoney, dateTime, initials, money, stageDays } from "@/lib/utils";
import { RecordDialog, type Modal } from "./record-dialog";
import { Button } from "./ui/button";
import { LoanTaskRow } from "./loan-task";
import { ContactImport } from "./contact-crm";
import { loanNextAction, loanTaskTarget, matchesWorkFilter, pausedLoan, workFilters, type WorkFilter } from "@/lib/loan-workflow";
import { LoanWorkQueue } from "./loan-work-queue";
import type { WorkspaceStaff } from "@/lib/staff-store";
import { demoBrokerageId } from "@/lib/brokerage-model";
import { BrokerageTeam } from "./brokerage-team";
import { BrokerageTemplates, CommunicationQueue } from "./loan-communications";
import { RealtorCrm } from "./realtor-crm";
import { PastClients } from "./past-client-crm";
import { ReferralQueue } from "./referral-queue";
import { LeadInbox, firstContactOverdue } from "./lead-inbox";
import { UwmAlertQueue } from "./uwm-alert-queue";
import type { WorkspaceMutationSuccess } from "@/lib/commands";
import { conditionTarget, submissionTarget, type UwmAlert } from "@/lib/uwm-alert-model";

type Section = "Pipeline" | "Lead Inbox" | "Contacts" | "Realtors" | "Past Clients" | "Tasks" | "Communications" | "Integrations" | "Team";
const demoOfficer = "Alex Morgan";
const taskViews = ["Open", "Due in 24 hours", "Overdue", "Completed", "All"] as const;
type TaskView = (typeof taskViews)[number];
const navigation = [
  { label: "Pipeline", icon: LayoutDashboard },
  { label: "Lead Inbox", icon: ContactRound },
  { label: "Contacts", icon: ContactRound },
  { label: "Realtors", icon: UsersRound },
  { label: "Past Clients", icon: HeartHandshake },
  { label: "Tasks", icon: ClipboardCheck },
  { label: "Communications", icon: Mail },
  { label: "Integrations", icon: Zap },
  { label: "Team", icon: UsersRound },
] as const;

const stageColors = ["lavender", "blue", "peach", "gold", "rose", "mint", "green", "slate"];
const emptyFilters = { stage: "", lender: "", officer: "", partner: "", days: "", work: "" as WorkFilter | "" };
const taskOwner = (item: Pick<Loan, "officer" | "officerEmail">) => item.officerEmail ? `account:${item.officerEmail}` : `name:${item.officer}`;
const descriptions: Record<Section, string> = {
  Pipeline: "Manage your loans and keep up with lender updates.",
  "Lead Inbox": "Route quote requests and referrals, follow up, and start a 1003.",
  Contacts: "Manage borrowers, co-borrowers, and realtor partners.",
  Realtors: "Track referred loans and share milestone updates with realtor partners.",
  "Past Clients": "Keep in touch after closing with anniversary reminders and rate targets.",
  Tasks: "See which loans need a follow-up and who owns it.",
  Communications: "Preview and copy milestone drafts for borrowers and realtors.",
  Integrations: "Manage your lender connections and refresh loan data.",
  Team: "Switch brokerages and manage access to your loans.",
};

function LoanCard({ loan, name, lenders, count, action, onOpen, onDrag, onDragEnd }: {
  loan: Loan; name: string; lenders: string[]; count: number; action: ReturnType<typeof loanNextAction>; onOpen: () => void;
  onDrag: (event: DragEvent<HTMLButtonElement>) => void; onDragEnd: () => void;
}) {
  return (
    <button className="loan-card" onClick={onOpen} draggable={!pausedLoan(loan)} onDragStart={onDrag} onDragEnd={onDragEnd}>
      <span className="loan-person"><span className={`avatar avatar-${stages.indexOf(loan.stage) % 4}`}>{initials(name)}</span><strong>{name}</strong></span>
      <span className="loan-address"><MapPin size={13} /> <span>{loan.address || "Property pending"}</span></span>
      <span className="loan-value">{money(loan.amount)} <small>{loan.purpose}</small></span>
      <span className="loan-address"><span>{action.title} · {loan.officer || "Unassigned"}</span></span>
      {(action.dueAt || action.blocker) && <span className="loan-address"><span>{action.blocker}{action.blocker && action.dueAt ? " · " : ""}{action.dueAt && dateTime(action.dueAt)}</span></span>}
      <span className="loan-card-footer">
        {lenders.length ? <span className="lender-chip">{lenders[0]}{lenders.length > 1 && ` +${lenders.length - 1}`}</span> : <span>{loan.officer.split(" ")[0] || "Unassigned"}</span>}
        {count > 0 ? <span className="open-chip">{count} open</span> : <span suppressHydrationWarning>{stageDays(loan.stageSince)}d</span>}
      </span>
    </button>
  );
}

export function Orbit({ initial, staff }: { initial: Workspace; staff: WorkspaceStaff | null }) {
  const [state, setState] = useState(initial);
  const [section, setSection] = useState<Section>("Pipeline");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [view, setView] = useState<"Board" | "List">("Board");
  const [query, setQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState(emptyFilters);
  const [modal, setModal] = useState<Modal | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dropStage, setDropStage] = useState<Stage | null>(null);
  const [taskView, setTaskView] = useState<TaskView>("Open");
  const [taskOfficer, setTaskOfficer] = useState("");
  const [focusLeadId, setFocusLeadId] = useState<string>();
  const [taskFocus, setTaskFocus] = useState<WorkFilter | "">("");
  const pending = useRef(false);
  const dragged = useRef<string | null>(null);
  const board = useRef<HTMLDivElement>(null);
  const mobileMenu = useRef<HTMLButtonElement>(null);
  const admin = !staff || staff.brokerage.role === "Admin";
  const processor = staff?.brokerage.role === "Processor";

  const names = new Map(state.contacts.map((contact) => [contact.id, contact.name]));
  const borrowers = (loan: Loan) => names.get(loan.contactId) ?? "Unknown borrower";
  const loanSubmissions = (loan: Loan) => state.submissions.filter((item) => item.loanId === loan.id);
  const countOpen = (loan: Loan) => loanSubmissions(loan).reduce((total, item) => total + item.conditions.filter((condition) => !condition.satisfiedAt).length, 0);
  const active = state.loans.filter((loan) => !pausedLoan(loan) && loan.stage !== "Funded" && loan.stage !== "Closed");
  const openConditions = state.submissions.flatMap((item) => item.conditions).filter((condition) => !condition.satisfiedAt).length;
  const search = query.trim().toLowerCase();
  const taskNow = new Date().getTime();
  const nextActions = new Map(state.loans.map((loan) => [loan.id, loanNextAction(loan, state)] as const));
  const workMatches = (loan: Loan, filter: WorkFilter | "") => matchesWorkFilter(loan, nextActions.get(loan.id)?.dueAt ?? null, filter, taskNow, Boolean(staff)) ||
    (filter === "Overdue" && !pausedLoan(loan) && state.tasks.some((task) => task.loanId === loan.id && !task.completedAt && Date.parse(task.dueAt) < taskNow));
  const visibleLoans = state.loans.filter((loan) => {
    const submissions = loanSubmissions(loan);
    return (!search || [borrowers(loan), loan.address, loan.officer, ...submissions.flatMap((item) => [item.lender, item.externalId])]
      .some((field) => field.toLowerCase().includes(search)))
      && (!filters.stage || loan.stage === filters.stage)
      && (!filters.lender || submissions.some((item) => item.lender === filters.lender))
      && (!filters.officer || loan.officer === filters.officer)
      && (!filters.partner || loan.partnerId === filters.partner)
      && (!filters.days || stageDays(loan.stageSince) >= Number(filters.days))
      && workMatches(loan, filters.work);
  });
  const visibleContacts = state.contacts.filter((contact) => [contact.name, contact.email, contact.role, contact.phone].some((field) => field.toLowerCase().includes(search)));
  const filterCount = Object.values(filters).filter(Boolean).length;
  const uwmCount = state.submissions.filter((item) => item.lender === "UWM").length;
  const taskLoans = new Map(state.loans.map((loan) => [loan.id, loan]));
  const pendingContact = state.inboxLeads.filter((lead) => !lead.followUp.firstContactAt);
  const assignedProcessing = new Set(state.loanProcessing.filter((item) => item.processorEmail === staff?.email).map((item) => item.loanId));
  const actionableProcessing = state.loanProcessing.filter((item) => admin
    ? item.status === "Ready for processing" || item.status === "In processing" || item.status === "Returned to LO"
    : processor ? assignedProcessing.has(item.loanId) && (item.status === "Ready for processing" || item.status === "In processing") : item.status === "Returned to LO");
  const openTasks = state.tasks.filter((task) => !task.completedAt && taskLoans.has(task.loanId) && !pausedLoan(taskLoans.get(task.loanId)!)).length + pendingContact.length
    + state.uwmAlerts.filter((alert) => !alert.reviewedAt).length + actionableProcessing.length;
  const officers = new Map([...state.loans, ...state.inboxLeads].filter((loan) => loan.officer).map((loan) => [
    taskOwner(loan), loan.officerEmail ? `${loan.officer} (${loan.officerEmail})` : loan.officer,
  ]));
  const mine = staff ? `account:${staff.email}` : `name:${demoOfficer}`;
  const taskScope = (item: Pick<Loan, "id" | "officer" | "officerEmail">) => !taskOfficer ||
    (taskOfficer === "mine" && processor && assignedProcessing.has(item.id)) || taskOwner(item) === (taskOfficer === "mine" ? mine : taskOfficer);
  const visibleProcessing = taskView === "Open" || taskView === "All" ? actionableProcessing.flatMap((item) => {
    const loan = taskLoans.get(item.loanId);
    return loan && !pausedLoan(loan) && taskScope(loan) ? [{ item, loan }] : [];
  }) : [];
  const focusedLoans = state.loans.filter((loan) => taskScope(loan) && (taskFocus ? workMatches(loan, taskFocus)
    : !!loan.revisitDate && workMatches(loan, "Overdue")));
  function dueInView(dueAt: string) {
    const due = Date.parse(dueAt);
    if (taskView === "Overdue") return due < taskNow;
    if (taskView === "Due in 24 hours") return due >= taskNow && due <= taskNow + 86_400_000;
    return true;
  }
  const visibleReferrals = state.referralLeads.filter((lead) => {
    const brokerageQueue = !lead.officerEmail && (!staff || staff.brokerage.role === "Admin");
    return taskView !== "Completed" && pendingContact.some((item) => item.id === lead.id) &&
      (taskScope(lead) || (taskOfficer === "mine" && brokerageQueue)) && dueInView(lead.dueAt);
  });
  const incomingLeadTasks = taskView === "Completed" ? [] : state.inboxLeads.flatMap((lead) => {
    const shared = !lead.officerEmail && admin && taskOfficer === "mine";
    if (!taskScope(lead) && !shared) return [];
    const due = firstContactOverdue(lead, taskNow);
    if (!lead.followUp.firstContactAt && (due || !lead.realtorId) && dueInView(lead.dueAt)) {
      return [{ lead, title: due ? "First contact overdue" : "Contact new quote request", dueAt: lead.dueAt }];
    }
    const nextAt = lead.followUp.nextAt;
    return lead.followUp.status === "Active" && nextAt && Date.parse(nextAt) <= taskNow && dueInView(nextAt)
      ? [{ lead, title: "Mock follow-up step due", dueAt: nextAt }] : [];
  });
  const showUwmAlerts = taskView === "Open" || taskView === "Completed" || taskView === "All";
  const visibleUwmAlerts = showUwmAlerts ? state.uwmAlerts.flatMap((alert) => {
    const loan = taskLoans.get(alert.loanId);
    const matchesView = taskView === "All" || (taskView === "Completed" ? !!alert.reviewedAt : !alert.reviewedAt);
    return loan && taskScope(loan) && matchesView ? [{ loan, alert }] : [];
  }) : [];
  const visibleTasks = state.tasks.filter((task) => {
    const loan = taskLoans.get(task.loanId);
    if (!loan || !taskScope(loan) || (taskFocus && !workMatches(loan, taskFocus))) return false;
    if (taskView === "All") return true;
    if (taskView === "Completed") return !!task.completedAt;
    if (task.completedAt || pausedLoan(loan)) return false;
    return dueInView(task.dueAt);
  });

  async function save(input: unknown, after?: (result: WorkspaceMutationSuccess) => void, announce = true) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await mutate(input, staff?.brokerage.id ?? demoBrokerageId);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setState(result.state);
      if (announce) setNotice(result.message);
      after?.(result);
    } catch {
      setError("Could not reach Orbit. Please try again.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  function convertLead(id: string, contactId: string | null, allowDuplicate: boolean) {
    void save({ type: "convertReferral", referralId: id, contactId, allowDuplicate }, ({ referralLoanId }) => {
      if (referralLoanId) setModal({ kind: "details", loanId: referralLoanId, target: "loan-application" });
    });
  }

  async function sync() {
    if (pending.current) return;
    setSyncing(true);
    try {
      await save({ type: "sync" });
    } finally {
      setSyncing(false);
    }
  }

  function navigate(next: Section) {
    setSection(next);
    if (mobileNavOpen) {
      setMobileNavOpen(false);
      mobileMenu.current?.focus();
    }
    setFocusLeadId(undefined);
    setQuery("");
    setError("");
    if (next === "Lead Inbox" || next === "Tasks" || next === "Communications" || next === "Realtors" || next === "Past Clients") {
      void save({ type: "refreshWorkspace" }, undefined, false);
    }
  }

  function show(next: Modal) {
    setError("");
    setModal(next);
  }

  function openUwmAlert(alert: UwmAlert) {
    const submission = state.submissions.find((item) => item.id === alert.submissionId);
    const condition = submission?.conditions.find((item) => item.id === alert.conditionId);
    let target = "lender-submissions";
    if (submission) target = condition ? conditionTarget(submission.id, condition.id) : submissionTarget(submission.id);
    show({ kind: "details", loanId: alert.loanId, target });
  }

  function close() {
    setError("");
    setModal(null);
  }

  function drop(event: DragEvent, stage: Stage) {
    if (!dragged.current) return;
    event.preventDefault();
    const id = dragged.current;
    dragged.current = null;
    setDropStage(null);
    if (state.loans.find((loan) => loan.id === id)?.stage !== stage) void save({ type: "move", id, stage });
  }

  function syncButton() {
    if (!admin) return null;
    return <Button variant="outline" onClick={() => void sync()} disabled={busy}><RefreshCw className={syncing ? "animate-spin" : ""} /> {syncing ? "Syncing…" : "Sync UWM"}</Button>;
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-icon"><OrbitIcon size={22} aria-hidden="true" /></span><span>OrbitLOS</span></div>
        <Button className="mobile-nav-toggle" ref={mobileMenu} variant="outline" size="sm" type="button"
          aria-expanded={mobileNavOpen} aria-controls="workspace-navigation" onClick={() => setMobileNavOpen(!mobileNavOpen)}>
          {mobileNavOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />} Menu
        </Button>
        <div className="workspace-label">WORKSPACE</div>
        <nav id="workspace-navigation" aria-label="Workspace navigation" data-expanded={mobileNavOpen} onKeyDown={(event) => {
          if (event.key === "Escape" && mobileNavOpen) {
            event.preventDefault();
            setMobileNavOpen(false);
            mobileMenu.current?.focus();
          }
        }}>
          {navigation.filter(({ label }) => (label !== "Team" || staff) && (admin || label !== "Realtors") && (!processor || label !== "Lead Inbox")).map(({ label, icon: Icon }) => (
            <button key={label} className={section === label ? "nav-item selected" : "nav-item"} aria-current={section === label ? "page" : undefined} onClick={() => navigate(label)}>
              <Icon size={18} /><span>{label}</span>{label === "Tasks" && openTasks > 0 && <small className="nav-count" aria-label={`${openTasks} open`}>{openTasks}</small>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="demo-label"><span /> {staff?.brokerage.name ?? "Demo workspace"}</div>
          <div className="profile"><span className="avatar">{staff ? initials(staff.name) : "AM"}</span><div>
            <strong>{staff?.name || demoOfficer}</strong><small>{staff?.email || "Loan officer"}</small>
          </div></div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <span><span className="muted">Workspace</span><span className="slash">/</span><strong>{section}</strong></span>
          <div className="topbar-actions">
            <button className="connection-chip" onClick={() => navigate("Integrations")}><span /> UWM mock</button>
            {staff && <form method="post" action="/auth/logout"><Button type="submit" size="sm" variant="ghost"><LogOut /> Sign out</Button></form>}
          </div>
        </header>
        <div className="content">
          {staff?.brokerage.pilot && <p className="application-message">Pilot workspace · Use fictional borrowers and built-in documents.</p>}
          <div className="page-heading">
            <div><p className="eyebrow">ORBIT WORKSPACE</p>
              <h1>{section === "Pipeline" ? "Loan pipeline" : section}</h1>
              <p>{descriptions[section]}</p>
            </div>
            <div className="heading-actions">
              {section === "Pipeline" && <>{syncButton()}{!processor && <Button onClick={() => show({ kind: "loan" })}><Plus /> New Lead</Button>}</>}
              {section === "Contacts" && admin && <Button onClick={() => show({ kind: "contact" })}><Plus /> New contact</Button>}
              {section === "Tasks" && <Button variant="outline" disabled={busy} onClick={() => void save({ type: "refreshWorkspace" })}><RefreshCw /> Refresh tasks</Button>}
              {section === "Communications" && <Button variant="outline" disabled={busy} onClick={() => void save({ type: "refreshWorkspace" })}><RefreshCw /> Refresh drafts</Button>}
            </div>
          </div>

          {(notice || (error && !modal)) && (
            <div className={error && !modal ? "banner banner-error" : "banner"} role={error && !modal ? "alert" : "status"}>
              <span>{error && !modal ? error : notice}</span>
              <Button variant="ghost" size="icon" aria-label="Dismiss notification" onClick={() => { setError(""); setNotice(""); }}><X /></Button>
            </div>
          )}

          {section === "Pipeline" && <>
            <div className="metrics">
              <article><div className="metric-icon lavender"><LayoutDashboard size={19} /></div><div><p>Active loans</p><strong>{active.length}</strong><small>{state.loans.length} total in pipeline</small></div></article>
              <article><div className="metric-icon mint"><Wallet size={19} /></div><div><p>Active loan volume</p><strong>{compactMoney(active.reduce((total, loan) => total + loan.amount, 0))}</strong><small>Across active stages</small></div></article>
              <article><div className="metric-icon gold"><FileCheck2 size={19} /></div><div><p>Open UWM conditions</p><strong>{openConditions}</strong><small>{state.uwmSyncedAt ? "Across synced loan files" : "Available after the first sync"}</small></div></article>
            </div>
            <section className="pipeline" aria-label="Pipeline views">
              <div className="pipeline-heading"><div><h2>Pipeline overview <span>{visibleLoans.length}</span></h2><p>Track each loan from lead to close.</p></div>
                {view === "Board" && <Button variant="ghost" size="sm" className="board-next" onClick={() => board.current?.scrollBy({ left: 490, behavior: "smooth" })}>More stages <ArrowRight /></Button>}
              </div>
              <div className="toolbar">
                <label className="search"><Search size={17} /><input aria-label="Search loans" placeholder="Search loans…" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
                <Button variant="outline" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}><SlidersHorizontal /> Filters{filterCount ? ` (${filterCount})` : ""}</Button>
                <div className="spacer" />
                <div className="view-toggle" aria-label="Pipeline view">
                  <button aria-pressed={view === "Board"} onClick={() => setView("Board")}><Columns3 size={16} /> Board</button>
                  <button aria-pressed={view === "List"} onClick={() => setView("List")}><List size={16} /> List</button>
                </div>
              </div>
              {filtersOpen && <div className="filter-row">
                <select aria-label="Filter by stage" value={filters.stage} onChange={(event) => setFilters({ ...filters, stage: event.target.value })}><option value="">All stages</option>{stages.map((stage) => <option key={stage}>{stage}</option>)}</select>
                <select aria-label="Filter by lender" value={filters.lender} onChange={(event) => setFilters({ ...filters, lender: event.target.value })}><option value="">All lenders</option>{[...new Set(state.submissions.map((item) => item.lender))].sort().map((lender) => <option key={lender}>{lender}</option>)}</select>
                <select aria-label="Filter by officer" value={filters.officer} onChange={(event) => setFilters({ ...filters, officer: event.target.value })}><option value="">All officers</option>{[...new Set(state.loans.map((loan) => loan.officer).filter(Boolean))].sort().map((officer) => <option key={officer}>{officer}</option>)}</select>
                <select aria-label="Filter by realtor" value={filters.partner} onChange={(event) => setFilters({ ...filters, partner: event.target.value })}><option value="">All realtors</option>{state.contacts.filter((contact) => contact.role === "Realtor").map((contact) => <option key={contact.id} value={contact.id}>{contact.name}</option>)}</select>
                <select aria-label="Filter by days in stage" value={filters.days} onChange={(event) => setFilters({ ...filters, days: event.target.value })}><option value="">Any stage age</option><option value="3">3+ days</option><option value="7">7+ days</option><option value="14">14+ days</option></select>
                <select aria-label="Filter by work status" value={filters.work} onChange={(event) => setFilters({ ...filters, work: event.target.value as WorkFilter | "" })}><option value="">Any work status</option>{workFilters.map((item) => <option key={item}>{item}</option>)}</select>
                <Button variant="ghost" size="sm" onClick={() => setFilters(emptyFilters)}>Clear filters</Button>
              </div>}
              {visibleLoans.length === 0 && <p className="empty-inline no-matches">No loans match this view.</p>}
              {view === "Board" ? (
                <div className="board" ref={board} tabIndex={0} aria-label="Loan stages. Scroll horizontally for more stages.">
                  {stages.filter((stage) => !filters.stage || filters.stage === stage).map((stage) => {
                    const items = visibleLoans.filter((loan) => loan.stage === stage);
                    const color = stageColors[stages.indexOf(stage)];
                    return <section key={stage} className={dropStage === stage ? "lane drag-over" : "lane"}
                      onDragOver={(event) => { if (dragged.current && !busy) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDropStage(stage); } }}
                      onDrop={(event) => drop(event, stage)}>
                      <div className="lane-title"><span className={`stage-dot ${color}`} /><h3>{stage}</h3><span className="lane-count">{items.length}</span>{!processor && <Button variant="ghost" size="icon" aria-label={`Add lead to ${stage}`} onClick={() => show({ kind: "loan", stage })}><Plus /></Button>}</div>
                      <p className="lane-volume">{compactMoney(items.reduce((total, loan) => total + loan.amount, 0))}</p>
                      {items.map((loan) => <LoanCard key={loan.id} loan={loan} name={borrowers(loan)} lenders={[...new Set(loanSubmissions(loan).map((item) => item.lender))]} count={countOpen(loan)} action={nextActions.get(loan.id)!}
                        onOpen={() => show({ kind: "details", loanId: loan.id })}
                        onDrag={(event) => { if (busy || processor) { event.preventDefault(); return; } dragged.current = loan.id; event.dataTransfer.setData("text/plain", loan.id); event.dataTransfer.effectAllowed = "move"; }}
                        onDragEnd={() => { dragged.current = null; setDropStage(null); }} />)}
                      {items.length === 0 && <p className="lane-empty">No loans in this stage</p>}
                    </section>;
                  })}
                </div>
              ) : visibleLoans.length > 0 && <div className="table-scroll"><table className="data-table"><thead><tr><th>Borrower</th><th>Stage</th><th>Amount</th><th>Officer</th><th>Lender</th><th>Stage age</th><th>Next action</th></tr></thead><tbody>
                {visibleLoans.map((loan) => <tr key={loan.id}><td><button className="name-link" onClick={() => show({ kind: "details", loanId: loan.id })}>{borrowers(loan)}</button><small>{loan.address}</small></td>
                  <td><span className={`stage-dot ${stageColors[stages.indexOf(loan.stage)]}`} /> {loan.stage}{pausedLoan(loan) && <small>{loan.disposition}</small>}</td><td>{money(loan.amount)}</td><td>{loan.officer || "Unassigned"}</td><td>{[...new Set(loanSubmissions(loan).map((item) => item.lender))].join(", ") || "—"}</td><td suppressHydrationWarning>{stageDays(loan.stageSince)} days</td>
                  <td><button className="name-link" onClick={() => show({ kind: "details", loanId: loan.id, target: nextActions.get(loan.id)?.target })}>{nextActions.get(loan.id)?.title}</button>
                    <small>{nextActions.get(loan.id)?.blocker}</small>
                    {!!nextActions.get(loan.id)?.dueAt && <small>Due {dateTime(nextActions.get(loan.id)!.dueAt!)} ET</small>}</td></tr>)}
              </tbody></table></div>}
            </section>
          </>}

          {section === "Lead Inbox" && <LeadInbox leads={state.inboxLeads} routing={state.leadRouting} staff={staff} now={taskNow} busy={busy}
            focusLeadId={focusLeadId} save={save} convert={convertLead} />}

          {section === "Contacts" && <section className="pipeline">
            <div className="pipeline-heading"><div><h2>All contacts <span>{visibleContacts.length}</span></h2><p>Your borrowers and referral partners.</p></div></div>
            <div className="toolbar"><label className="search"><Search size={17} /><input aria-label="Search contacts" placeholder="Search contacts…" value={query} onChange={(event) => setQuery(event.target.value)} /></label></div>
            {!processor && <ContactImport contacts={state.contacts} busy={busy} save={save} />}
            {visibleContacts.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Name</th><th>Contact type</th><th>Email</th><th>Phone</th></tr></thead><tbody>
              {visibleContacts.map((contact) => <tr key={contact.id}><td><button className="name-link" onClick={() => show({ kind: "contactHistory", contactId: contact.id })}>{contact.name}</button>
                {admin && <small><button className="name-link" onClick={() => show({ kind: "contact", contactId: contact.id })}>Edit contact</button></small>}</td><td>{contact.role}</td><td>{contact.email || "—"}</td><td>{contact.phone || "—"}</td></tr>)}
            </tbody></table></div> : <p className="empty-inline no-matches">No contacts match your search.</p>}
          </section>}

          {section === "Tasks" && <section className="pipeline" aria-label="Loan tasks">
            <div className="pipeline-heading"><div><h2>Follow-up queue <span>{visibleTasks.length + visibleReferrals.length + visibleUwmAlerts.length + incomingLeadTasks.length + visibleProcessing.length} shown</span></h2><p>Review leads, lender updates, and loan follow-ups.</p></div></div>
            <div className="filter-row">
              <Button size="sm" variant={taskOfficer === "mine" ? "default" : "outline"} aria-pressed={taskOfficer === "mine"}
                onClick={() => setTaskOfficer(taskOfficer === "mine" ? "" : "mine")}>My Tasks</Button>
              <select aria-label="Task status" value={taskView} onChange={(event) => setTaskView(event.target.value as TaskView)}>{taskViews.map((item) => <option key={item}>{item}</option>)}</select>
              <select aria-label="Loan work status" value={taskFocus} onChange={(event) => setTaskFocus(event.target.value as WorkFilter | "")}><option value="">Any loan work status</option>{workFilters.map((item) => <option key={item}>{item}</option>)}</select>
              <select aria-label="Task owner" value={taskOfficer} onChange={(event) => setTaskOfficer(event.target.value)}>
                <option value="">All officers</option><option value="mine">My Tasks</option>
                {[...officers].sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </div>
            {showUwmAlerts && <UwmAlertQueue items={visibleUwmAlerts} borrower={borrowers} open={openUwmAlert} busy={busy}
              review={(alert) => void save({ type: "reviewUwmAlert", loanId: alert.loanId, alertId: alert.id })} />}
            {visibleProcessing.length > 0 && <section className="work-queue" aria-label="Processing handoffs">
              <div className="section-heading"><h3>Processing handoffs</h3><span className="pill">{visibleProcessing.length} open</span></div>
              <ul className="loan-task-list">{visibleProcessing.map(({ item, loan }) => <li className="loan-task" key={loan.id}>
                <div className="loan-task-copy"><strong>{item.status}</strong><span>{borrowers(loan)} · {item.processorName}</span></div>
                <Button size="sm" variant="outline" onClick={() => show({ kind: "details", loanId: loan.id, target: "processing-handoff" })}>Open handoff</Button>
              </li>)}</ul>
            </section>}
            {incomingLeadTasks.length > 0 && <div className="work-queue" aria-label="Lead follow-ups">
              <div className="section-heading"><h3>Lead follow-ups</h3><span className="pill">{incomingLeadTasks.length} open</span></div>
              <ul className="loan-task-list">{incomingLeadTasks.map(({ lead, title, dueAt }) => <li className="loan-task" key={lead.id}>
                <div className="loan-task-copy"><strong>{title}</strong><span>{lead.name} · {lead.officer || "Shared inbox"}</span><span>{dateTime(dueAt)} ET</span></div>
                <Button size="sm" variant="outline" onClick={() => { navigate("Lead Inbox"); setFocusLeadId(lead.id); }}>Open lead</Button>
              </li>)}</ul>
            </div>}
            {taskView !== "Completed" && <ReferralQueue leads={visibleReferrals} now={taskNow} busy={busy}
              refresh={() => void save({ type: "refreshWorkspace" }, undefined, false)}
              convert={(lead, contactId, allowDuplicate) => convertLead(lead.id, contactId, allowDuplicate)}
              dismiss={(lead) => void save({ type: "dismissReferral", referralId: lead.id })} />}
            {taskView !== "Completed" && (focusedLoans.length > 0 || taskFocus) && <div className="work-queue">
              <div className="section-heading"><h3>{taskFocus || "Holds to revisit"}</h3><span className="pill">{focusedLoans.length} loans</span></div>
              {focusedLoans.length ? <ul className="loan-task-list">{focusedLoans.map((loan) => {
                const action = nextActions.get(loan.id)!;
                return <li className="loan-task" key={loan.id}><div className="loan-task-copy"><strong>{action.title}</strong>
                  <span>{borrowers(loan)} · {loan.officer || "Unassigned"} · {loan.disposition || loan.stage}</span>
                  <span>{action.blocker}{action.dueAt && ` · Due ${dateTime(action.dueAt)} ET`}</span></div>
                  <Button size="sm" variant="outline" onClick={() => show({ kind: "details", loanId: loan.id, target: action.target })}>Open next action</Button></li>;
              })}</ul> : <p className="empty-inline">No loans match this work status.</p>}
            </div>}
            {(taskView === "Open" || taskView === "All") && <LoanWorkQueue loans={state.loans.filter((loan) => taskScope(loan) && workMatches(loan, taskFocus))} state={state} borrower={borrowers}
              open={(loanId, target) => show({ kind: target === "uwm-rate-lock" ? "pricing" : "details", loanId, target })} />}
            {visibleTasks.length ? <ul className="task-queue">
              {visibleTasks.map((task) => {
                const loan = taskLoans.get(task.loanId);
                if (!loan) return null;
                return <LoanTaskRow key={task.id} task={task} officer={loan.officer} borrower={borrowers(loan)} busy={busy}
                  openLoan={() => show({ kind: "details", loanId: loan.id, target: loanTaskTarget(task.id) })}
                  onChange={() => void save({ type: "completeTask", id: task.id, completed: !task.completedAt })} />;
              })}
            </ul> : <p className="empty-inline no-matches">{visibleReferrals.length || visibleUwmAlerts.length || incomingLeadTasks.length || visibleProcessing.length ? "No other loan tasks match this view." : taskOfficer === "mine" && staff && !state.loans.some((loan) => loan.officerEmail === staff.email || assignedProcessing.has(loan.id))
              ? "No loans are assigned to your account. Open a loan and use Assign to my account under Edit loan."
              : state.tasks.length ? "No tasks match this view." : "Add a task from a loan, or submit a 1003 to create a follow-up."}</p>}
          </section>}

          {section === "Communications" && <><CommunicationQueue state={state}
            preview={(loanId, audience, draftId) => show({ kind: "communication", loanId, audience, draftId })} />
            {admin && <BrokerageTemplates state={state} busy={busy} save={save} />}</>}

          {section === "Realtors" && <RealtorCrm state={state} staff={staff} busy={busy} save={save}
            openLoan={(loanId) => show({ kind: "details", loanId })} editRealtor={(contactId) => show({ kind: "contact", contactId })} />}

          {section === "Past Clients" && <PastClients state={state} openLoan={(loanId) => show({ kind: "details", loanId })}
            editRetention={(loanId) => show({ kind: "retention", loanId })} />}

          {section === "Team" && staff && <BrokerageTeam staff={staff} state={state} refresh={() => save({ type: "refreshWorkspace" }, undefined, false)}
            openLoan={(loanId) => show({ kind: "details", loanId })} />}

          {section === "Integrations" && <section className="integration">
            <div className="integration-head"><span className="metric-icon lavender"><Zap size={20} /></span><div><h2>United Wholesale Mortgage</h2><p>Mock lender connection</p></div><span className="pill">Demo mode</span></div>
            <p className="integration-description">Import sample pipeline loans and refresh their lender status and underwriting conditions.</p>
            <div className="integration-stats"><span><CircleCheck size={17} /> {uwmCount} linked loans</span><span><ArrowDownUp size={17} /> {state.uwmSyncedAt ? `Last sync ${dateTime(state.uwmSyncedAt)} ET` : "Waiting for first sync"}</span></div>
            <div className="loan-application-actions">{syncButton()}
              {admin && <Button variant="outline" disabled={busy || !state.uwmSyncedAt || state.mockUwmChangesApplied}
                onClick={() => void save({ type: "simulateUwmChanges" })}>Simulate UWM changes</Button>}
            </div>
            {admin && <p className="muted">{state.mockUwmChangesApplied
              ? "Sample lender changes applied. Review Charlotte Kim’s alerts under Tasks. My Tasks shows alerts for your assigned loans."
              : "After the first sync, simulate three lender changes on Charlotte Kim’s loan. Assign her loan to yourself to see the alerts in My Tasks."}</p>}
          </section>}
        </div>
      </main>
      {modal && <RecordDialog modal={modal} state={state} staff={staff} busy={busy} error={error} save={save} show={show} close={close} />}
    </div>
  );
}
