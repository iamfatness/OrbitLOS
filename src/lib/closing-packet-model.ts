import { z } from "zod";
import type { ClosingDisclosureReview, DisclosureDocument } from "./disclosure-model";
import type { ClosingItem } from "./model";
import type { ClosingServiceEvidence } from "./closing-service-evidence-model";

const loanId = z.string().min(1).max(100);
const version = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const closingPacketRequest = z.object({ loanId, version });
export const prepareClosingPacketInput = z.object({
  type: z.literal("prepareClosingPacket"), loanId, previousVersion: version.nullable(),
  disclosureVersion: version, disclosureRevision: version,
});
export const closingPacketUnavailable = "This sample closing packet is unavailable.";
export const closingPacketChecklistLimit = 80;

export type ClosingPacketSnapshot = {
  borrower: string; property: string; officer: string;
  targetDate: string | null; closingDate: string | null; fundingDate: string | null;
  disclosure: Omit<ClosingDisclosureReview, "current"> & {
    documents: DisclosureDocument[]; issuedAt: string | null; signBy: string;
    loanAmount: number; product: string; rate: number; cashToClose: number | null;
  };
  checklist: (Pick<ClosingItem, "title" | "owner" | "dueDate" | "completedAt"> & {
    serviceEvidence?: ClosingServiceEvidence[];
  })[];
};

export type ClosingPacket = { version: number; preparedAt: string; preparedBy: string; snapshot: ClosingPacketSnapshot };
export type ClosingPacketWork = {
  packets: (Omit<ClosingPacket, "snapshot"> & { current: boolean; disclosureVersion: number })[];
  canPrepare: boolean;
};
