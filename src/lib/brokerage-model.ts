export const demoBrokerageId = "orbit-demo";
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
}

export interface BrokerageMember {
  email: string;
  name: string;
  role: BrokerageRole;
  status: MemberStatus;
}

export interface AccessEvent {
  id: string;
  actor: string;
  action: string;
  subject: string;
  createdAt: string;
}

export interface BrokerageSettings {
  brokerages: Brokerage[];
  members: BrokerageMember[];
  history: AccessEvent[];
  pilotScenario?: PilotScenario;
  pilotFeedback?: PilotFeedback[];
  pilotMetrics?: { label: string; count: number; minutes: number | null }[];
  pilotMeasurements?: PilotMeasurement[];
}

export const pilotSteps = ["Referral and intake", "New lead and 1003", "Pricing", "Documents", "UWM conditions", "Closing and funding", "CRM and follow-up", "Access and recovery", "Other"] as const;
export type PilotStep = (typeof pilotSteps)[number];
export const pilotPriorities = ["Low", "Normal", "High", "Blocker"] as const;
export const pilotFeedbackStatuses = ["Open", "In progress", "Ready to retest", "Closed"] as const;
export const pilotWalkthroughs = ["Direct lead", "Realtor referral", "Returning client", "Pause and resume"] as const;
export interface PilotMeasurement {
  id: string;
  walkthrough: (typeof pilotWalkthroughs)[number];
  workflow: "Orbit" | "Current brokerage workflow";
  seconds: number;
  repeatEntries: number;
  systemSwitches: number;
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

export function brokerageUrl(id: string) {
  return id === demoBrokerageId ? "/workspace" : `/workspace?brokerage=${id}`;
}

export function portalToken(brokerageId = demoBrokerageId) {
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return brokerageId === demoBrokerageId ? token : `${brokerageId}.${token}`;
}

export function portalBrokerage(token: unknown) {
  if (typeof token !== "string" || !portalTokenPattern.test(token)) return null;
  return token.includes(".") ? token.split(".", 1)[0] : demoBrokerageId;
}
