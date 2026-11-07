"use client";

import { useRef, useState, type DragEvent } from "react";
import {
  ArrowDownUp, ArrowRight, CircleCheck, ClipboardCheck, Columns3, ContactRound, FileCheck2, LayoutDashboard,
  List, LogOut, MapPin, Orbit as OrbitIcon, Plus, RefreshCw, Search, SlidersHorizontal, Wallet, X, Zap,
} from "lucide-react";
import { mutate } from "@/app/actions";
import { stages, type Loan, type Stage, type Workspace } from "@/lib/model";
import { compactMoney, dateTime, initials, money, stageDays } from "@/lib/utils";
import { RecordDialog, type Modal } from "./record-dialog";
import { Button } from "./ui/button";
import { LoanTaskRow } from "./loan-task";
import type { StaffIdentity } from "@/lib/staff-store";

type Section = "Pipeline" | "Contacts" | "Tasks" | "Integrations";
const demoOfficer = "Alex Morgan";
const taskViews = ["Open", "Due in 24 hours", "Overdue", "Completed", "All"] as const;
type TaskView = (typeof taskViews)[number];
const navigation = [
  { label: "Pipeline", icon: LayoutDashboard },
  { label: "Contacts", icon: ContactRound },
  { label: "Tasks", icon: ClipboardCheck },
  { label: "Integrations", icon: Zap },
] as const;

const stageColors = ["lavender", "blue", "peach", "gold", "rose", "mint", "green", "slate"];
const emptyFilters = { stage: "", lender: "", officer: "", partner: "", days: "" };

function LoanCard({ loan, name, lenders, count, onOpen, onDrag, onDragEnd }: {
  loan: Loan; name: string; lenders: string[]; count: number; onOpen: () => void;
  onDrag: (event: DragEvent<HTMLButtonElement>) => void; onDragEnd: () => void;
}) {
  return (
    <button className="loan-card" onClick={onOpen} draggable onDragStart={onDrag} onDragEnd={onDragEnd}>
      <span className="loan-person"><span className={`avatar avatar-${stages.indexOf(loan.stage) % 4}`}>{initials(name)}</span><strong>{name}</strong></span>
      <span className="loan-address"><MapPin size={13} /> <span>{loan.address || "Property pending"}</span></span>
      <span className="loan-value">{money(loan.amount)} <small>{loan.purpose}</small></span>
      <span className="loan-card-footer">
        {lenders.length ? <span className="lender-chip">{lenders[0]}{lenders.length > 1 && ` +${lenders.length - 1}`}</span> : <span>{loan.officer.split(" ")[0] || "Unassigned"}</span>}
        {count > 0 ? <span className="open-chip">{count} open</span> : <span suppressHydrationWarning>{stageDays(loan.stageSince)}d</span>}
      </span>
    </button>
  );
}

export function Orbit({ initial, staff }: { initial: Workspace; staff: StaffIdentity | null }) {
  const [state, setState] = useState(initial);
  const [section, setSection] = useState<Section>("Pipeline");
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
  const pending = useRef(false);
  const dragged = useRef<string | null>(null);
  const board = useRef<HTMLDivElement>(null);

  const names = new Map(state.contacts.map((contact) => [contact.id, contact.name]));
  const borrowers = (loan: Loan) => names.get(loan.contactId) ?? "Unknown borrower";
  const loanSubmissions = (loan: Loan) => state.submissions.filter((item) => item.loanId === loan.id);
  const countOpen = (loan: Loan) => loanSubmissions(loan).reduce((total, item) => total + item.conditions.filter((condition) => !condition.satisfiedAt).length, 0);
  const active = state.loans.filter((loan) => loan.stage !== "Funded" && loan.stage !== "Closed");
  const openConditions = state.submissions.flatMap((item) => item.conditions).filter((condition) => !condition.satisfiedAt).length;
  const search = query.trim().toLowerCase();
  const visibleLoans = state.loans.filter((loan) => {
    const submissions = loanSubmissions(loan);
    return (!search || [borrowers(loan), loan.address, loan.officer, ...submissions.flatMap((item) => [item.lender, item.externalId])]
      .some((field) => field.toLowerCase().includes(search)))
      && (!filters.stage || loan.stage === filters.stage)
      && (!filters.lender || submissions.some((item) => item.lender === filters.lender))
      && (!filters.officer || loan.officer === filters.officer)
      && (!filters.partner || loan.partnerId === filters.partner)
      && (!filters.days || stageDays(loan.stageSince) >= Number(filters.days));
  });
  const visibleContacts = state.contacts.filter((contact) => [contact.name, contact.email, contact.role, contact.phone].some((field) => field.toLowerCase().includes(search)));
  const filterCount = Object.values(filters).filter(Boolean).length;
  const uwmCount = state.submissions.filter((item) => item.lender === "UWM").length;
  const openTasks = state.tasks.filter((task) => !task.completedAt).length;
  const taskLoans = new Map(state.loans.map((loan) => [loan.id, loan]));
  const officers = [...new Set(state.loans.map((loan) => loan.officer).filter(Boolean))].sort();
  const taskNow = Date.parse(new Date().toISOString());
  const visibleTasks = state.tasks.filter((task) => {
    const loan = taskLoans.get(task.loanId);
    if (!loan || (taskOfficer && loan.officer !== taskOfficer)) return false;
    if (taskView === "All") return true;
    if (taskView === "Completed") return !!task.completedAt;
    if (task.completedAt) return false;
    const due = Date.parse(task.dueAt);
    if (taskView === "Overdue") return due < taskNow;
    if (taskView === "Due in 24 hours") return due >= taskNow && due <= taskNow + 86_400_000;
    return true;
  });

  async function save(input: unknown, after?: () => void, announce = true) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await mutate(input);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setState(result.state);
      if (announce) setNotice(result.message);
      after?.();
    } catch {
      setError("Could not reach Orbit. Please try again.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
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
    setQuery("");
    setError("");
    if (next === "Tasks") void save({ type: "refreshWorkspace" }, undefined, false);
  }

  function show(next: Modal) {
    setError("");
    setModal(next);
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
    return <Button variant="outline" onClick={() => void sync()} disabled={busy}><RefreshCw className={syncing ? "animate-spin" : ""} /> {syncing ? "Syncing…" : "Sync UWM"}</Button>;
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-icon"><OrbitIcon size={22} /></span><span>orbit<small>CRM</small></span></div>
        <div className="workspace-label">WORKSPACE</div>
        <nav aria-label="Workspace navigation">
          {navigation.map(({ label, icon: Icon }) => (
            <button key={label} className={section === label ? "nav-item selected" : "nav-item"} aria-current={section === label ? "page" : undefined} onClick={() => navigate(label)}>
              <Icon size={18} /><span>{label}</span>{label === "Tasks" && openTasks > 0 && <small className="nav-count" aria-label={`${openTasks} open`}>{openTasks}</small>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="demo-label"><span /> Demo workspace</div>
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
          <div className="page-heading">
            <div><p className="eyebrow">ORBIT WORKSPACE</p>
              <h1>{section === "Pipeline" ? "Loan pipeline" : section}</h1>
              <p>{section === "Pipeline" ? "Manage your loans and keep up with lender updates." : section === "Contacts" ? "Manage borrowers, co-borrowers, and realtor partners." : section === "Tasks" ? "See which loans need a follow-up and who owns it." : "Manage your lender connections and refresh loan data."}</p>
            </div>
            <div className="heading-actions">
              {section === "Pipeline" && <>{syncButton()}<Button onClick={() => show({ kind: "loan" })}><Plus /> New loan</Button></>}
              {section === "Contacts" && <Button onClick={() => show({ kind: "contact" })}><Plus /> New contact</Button>}
              {section === "Tasks" && <Button variant="outline" disabled={busy} onClick={() => void save({ type: "refreshWorkspace" })}><RefreshCw /> Refresh tasks</Button>}
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
                      <div className="lane-title"><span className={`stage-dot ${color}`} /><h3>{stage}</h3><span className="lane-count">{items.length}</span><Button variant="ghost" size="icon" aria-label={`Add loan to ${stage}`} onClick={() => show({ kind: "loan", stage })}><Plus /></Button></div>
                      <p className="lane-volume">{compactMoney(items.reduce((total, loan) => total + loan.amount, 0))}</p>
                      {items.map((loan) => <LoanCard key={loan.id} loan={loan} name={borrowers(loan)} lenders={[...new Set(loanSubmissions(loan).map((item) => item.lender))]} count={countOpen(loan)}
                        onOpen={() => show({ kind: "details", loanId: loan.id })}
                        onDrag={(event) => { if (busy) { event.preventDefault(); return; } dragged.current = loan.id; event.dataTransfer.setData("text/plain", loan.id); event.dataTransfer.effectAllowed = "move"; }}
                        onDragEnd={() => { dragged.current = null; setDropStage(null); }} />)}
                      {items.length === 0 && <p className="lane-empty">No loans in this stage</p>}
                    </section>;
                  })}
                </div>
              ) : visibleLoans.length > 0 && <div className="table-scroll"><table className="data-table"><thead><tr><th>Borrower</th><th>Stage</th><th>Amount</th><th>Officer</th><th>Lender</th><th>Stage age</th></tr></thead><tbody>
                {visibleLoans.map((loan) => <tr key={loan.id}><td><button className="name-link" onClick={() => show({ kind: "details", loanId: loan.id })}>{borrowers(loan)}</button><small>{loan.address}</small></td>
                  <td><span className={`stage-dot ${stageColors[stages.indexOf(loan.stage)]}`} /> {loan.stage}</td><td>{money(loan.amount)}</td><td>{loan.officer || "Unassigned"}</td><td>{[...new Set(loanSubmissions(loan).map((item) => item.lender))].join(", ") || "—"}</td><td suppressHydrationWarning>{stageDays(loan.stageSince)} days</td></tr>)}
              </tbody></table></div>}
            </section>
          </>}

          {section === "Contacts" && <section className="pipeline">
            <div className="pipeline-heading"><div><h2>All contacts <span>{visibleContacts.length}</span></h2><p>Your borrowers and referral partners.</p></div></div>
            <div className="toolbar"><label className="search"><Search size={17} /><input aria-label="Search contacts" placeholder="Search contacts…" value={query} onChange={(event) => setQuery(event.target.value)} /></label></div>
            {visibleContacts.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Name</th><th>Contact type</th><th>Email</th><th>Phone</th></tr></thead><tbody>
              {visibleContacts.map((contact) => <tr key={contact.id}><td><button className="name-link" onClick={() => show({ kind: "contact", contactId: contact.id })}>{contact.name}</button></td><td>{contact.role}</td><td>{contact.email || "—"}</td><td>{contact.phone || "—"}</td></tr>)}
            </tbody></table></div> : <p className="empty-inline no-matches">No contacts match your search.</p>}
          </section>}

          {section === "Tasks" && <section className="pipeline" aria-label="Loan tasks">
            <div className="pipeline-heading"><div><h2>Follow-up queue <span>{visibleTasks.length} shown</span></h2><p>Review upcoming work and follow up on open loans.</p></div></div>
            <div className="filter-row">
              <Button size="sm" variant={taskOfficer === demoOfficer ? "default" : "outline"} aria-pressed={taskOfficer === demoOfficer}
                onClick={() => setTaskOfficer(taskOfficer === demoOfficer ? "" : demoOfficer)}>{staff ? "Alex Morgan’s tasks" : "My tasks"}</Button>
              <select aria-label="Task status" value={taskView} onChange={(event) => setTaskView(event.target.value as TaskView)}>{taskViews.map((item) => <option key={item}>{item}</option>)}</select>
              <select aria-label="Task owner" value={taskOfficer} onChange={(event) => setTaskOfficer(event.target.value)}>
                <option value="">All officers</option>{[...new Set([demoOfficer, ...officers])].map((officer) => <option key={officer}>{officer}</option>)}
              </select>
            </div>
            {visibleTasks.length ? <ul className="task-queue">
              {visibleTasks.map((task) => {
                const loan = taskLoans.get(task.loanId);
                if (!loan) return null;
                return <LoanTaskRow key={task.id} task={task} officer={loan.officer} borrower={borrowers(loan)} busy={busy}
                  openLoan={() => show({ kind: "details", loanId: loan.id })}
                  onChange={() => void save({ type: "completeTask", id: task.id, completed: !task.completedAt })} />;
              })}
            </ul> : <p className="empty-inline no-matches">{state.tasks.length ? "No tasks match this view." : "Add a task from a loan, or submit a 1003 to create a follow-up."}</p>}
          </section>}

          {section === "Integrations" && <section className="integration">
            <div className="integration-head"><span className="metric-icon lavender"><Zap size={20} /></span><div><h2>United Wholesale Mortgage</h2><p>Mock lender connection</p></div><span className="pill">Demo mode</span></div>
            <p className="integration-description">Import sample pipeline loans and refresh their lender status and underwriting conditions.</p>
            <div className="integration-stats"><span><CircleCheck size={17} /> {uwmCount} linked loans</span><span><ArrowDownUp size={17} /> {state.uwmSyncedAt ? `Last sync ${dateTime(state.uwmSyncedAt)} ET` : "Waiting for first sync"}</span></div>
            {syncButton()}
          </section>}
        </div>
      </main>
      {modal && <RecordDialog modal={modal} state={state} busy={busy} error={error} save={save} show={show} close={close} />}
    </div>
  );
}
