import {
  ArrowDownUp, CalendarClock, CalendarDays, ChartNoAxesCombined, CircleAlert, Clock3, Columns3, Compass, ContactRound,
  Files, Handshake, HeartHandshake, Inbox, LayoutDashboard, ListTodo, MessagesSquare, Phone, Plug, ShieldCheck, ShieldQuestionMark, UsersRound, Workflow,
} from "lucide-react";

export const workspaceIcons = {
  brokerage: LayoutDashboard,
  today: Clock3,
  calendar: CalendarDays,
  coverage: CalendarClock,
  pipeline: Columns3,
  processing: Files,
  exceptions: CircleAlert,
  reviews: ShieldCheck,
  intake: Inbox,
  calls: Phone,
  tasks: ListTodo,
  contacts: ContactRound,
  realtors: Handshake,
  pastClients: HeartHandshake,
  communications: MessagesSquare,
  demo: Compass,
  reports: ChartNoAxesCombined,
  playbooks: Workflow,
  compliance: ShieldQuestionMark,
  integrations: Plug,
  migration: ArrowDownUp,
  team: UsersRound,
} as const;
