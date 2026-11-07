export const demoBrokerageId = "orbit-demo";
export const brokerageRoles = ["Admin", "LO"] as const;
export type BrokerageRole = (typeof brokerageRoles)[number];
export type MemberStatus = "Invited" | "Active" | "Revoked";
export const brokerageIdPattern = /^(?:orbit-demo|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/;
export const portalTokenPattern = /^(?:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.)?[a-f0-9]{64}$/;

export interface Brokerage {
  id: string;
  name: string;
  role: BrokerageRole;
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
