export const demoBrokerageId = "orbit-demo";
export const staffSignInRequired = "Sign in to Orbit to continue.";
export const brokerageRoles = ["Admin", "LO", "Processor"] as const;
export type BrokerageRole = (typeof brokerageRoles)[number];
export type MemberStatus = "Invited" | "Active" | "Revoked";
export const brokerageIdPattern = /^(?:orbit-demo|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/;
export const portalTokenPattern = /^(?:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.)?[a-f0-9]{64}$/;

export interface Brokerage {
  id: string;
  name: string;
  role: BrokerageRole;
  pilot?: boolean;
  financeAccess?: boolean;
  accessRevision?: number;
}

export interface BrokerageMember {
  email: string;
  name: string;
  role: BrokerageRole;
  status: MemberStatus;
}

export type VersionedBrokerageMember = BrokerageMember & { accessRevision?: number };

export interface AccessEvent {
  id: string;
  actor: string;
  action: string;
  subject: string;
  loanName?: string;
  createdAt: string;
}

export interface BrokerageSettings {
  brokerages: Brokerage[];
  members: VersionedBrokerageMember[];
  history: AccessEvent[];
  pilotScenario?: PilotScenario;
  pilotFeedback?: PilotFeedback[];
  pilotMetrics?: { label: string; count: number; minutes: number | null }[];
  pilotMeasurements?: PilotMeasurement[];
  pilotBenchmarks?: PilotBenchmark[];
}

export const pilotSteps = ["Referral and intake", "New lead and 1003", "Pricing", "Documents", "UWM conditions", "Closing and funding", "CRM and follow-up", "Access and recovery", "Other"] as const;
export type PilotStep = (typeof pilotSteps)[number];
export const pilotPriorities = ["Low", "Normal", "High", "Blocker"] as const;
export const pilotFeedbackStatuses = ["Open", "In progress", "Ready to retest", "Closed"] as const;
export const pilotWalkthroughs = ["Direct lead", "Realtor referral", "Returning client", "Pause and resume", "Campaign lead to repeat loan"] as const;
export type PilotWalkthrough = (typeof pilotWalkthroughs)[number];
export const pilotBenchmarkBoundaries: Record<PilotWalkthrough, { start: string; finish: string }> = {
  "Direct lead": { start: "Open the received fictional inquiry.", finish: "The first application is submitted and ready for staff review." },
  "Realtor referral": { start: "Open the received fictional referral.", finish: "The first application is reviewed and the partner status is ready to share." },
  "Returning client": { start: "Open the fictional funded borrower's contact.", finish: "The repeat application is ready for the borrower." },
  "Pause and resume": { start: "Open an in-progress fictional application.", finish: "Reopen the saved draft and confirm the previously entered answers are present." },
  "Campaign lead to repeat loan": { start: "Open a newly assigned fictional campaign lead.", finish: "The first loan is funded and the repeat application is ready for the same borrower." },
};
export interface PilotRunMetrics {
  seconds: number;
  repeatEntries: number;
  systemSwitches: number;
}
export interface PilotHandling {
  ownerSeconds?: number;
  officerSeconds?: number;
  processorSeconds?: number;
  waitingSeconds?: number;
  staffHandoffs?: number;
}
export interface PilotBenchmarkRun extends PilotRunMetrics {
  handling?: PilotHandling;
}
export interface PilotMeasurement extends PilotRunMetrics {
  id: string;
  walkthrough: PilotWalkthrough;
  workflow: "Orbit" | "Current brokerage workflow";
  createdAt: string;
}
export interface PilotBenchmark {
  id: string;
  walkthrough: PilotWalkthrough;
  caseLabel: string;
  orbit: PilotBenchmarkRun;
  baseline: PilotBenchmarkRun;
  createdAt: string;
}

export interface DemoGuideState {
  id: string;
  officerEmail: string;
  leadId: string | null;
  loanId: string | null;
  realtorToken: string | null;
  rateLoanId: string | null;
}

export interface PilotScenario {
  id: string;
  loadedAt: string;
  officerEmail: string;
  presenter: boolean;
}

export interface PilotFeedback {
  id: string;
  author: string;
  step: PilotStep;
  message: string;
  createdAt: string;
  owner: string | null;
  priority: (typeof pilotPriorities)[number];
  status: (typeof pilotFeedbackStatuses)[number];
  retest: string;
  revision: number;
}

export function workspaceGuide(value: unknown) {
  return value === "1" || value === "campaign" ? value : null;
}

export function brokerageUrl(id: string, guide?: ReturnType<typeof workspaceGuide>) {
  const search = new URLSearchParams();
  if (id !== demoBrokerageId) search.set("brokerage", id);
  if (guide) search.set("guide", guide);
  return search.size ? `/workspace?${search}` : "/workspace";
}

export function portalToken(brokerageId = demoBrokerageId) {
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return brokerageId === demoBrokerageId ? token : `${brokerageId}.${token}`;
}

export function portalBrokerage(token: unknown) {
  if (typeof token !== "string" || !portalTokenPattern.test(token)) return null;
  return token.includes(".") ? token.split(".", 1)[0] : demoBrokerageId;
}
