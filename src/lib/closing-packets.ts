import { closingPacketChecklistLimit, closingPacketRequest, closingPacketUnavailable, prepareClosingPacketInput,
  type ClosingPacket, type ClosingPacketSnapshot, type ClosingPacketWork } from "./closing-packet-model";
import { canUseSampleDisclosures, readDisclosureWork } from "./disclosures";
import { addApplicationActivity } from "./applications";
import { closingPacketPdf } from "./closing-packet-pdf";
import { closingServiceEvidence } from "./closing-service-evidence";
import type { DisclosureWork } from "./disclosure-model";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { loanAccess } from "./workspace-access";
import type { z } from "zod";

type PacketRow = Omit<ClosingPacket, "snapshot"> & { snapshot: string };

function packetSnapshot(db: Store, loanId: string, work: DisclosureWork): ClosingPacketSnapshot | undefined {
  const review = work.closingReviews.find(({ current }) => current);
  const packageRow = work.packages[0];
  if (!review || !packageRow || packageRow.version !== review.version) return;
  const loan = db.prepare(`SELECT contact.name AS borrower, loan.address AS property, loan.officer, plan.targetDate,
      past.closingDate, progress.fundingDate
    FROM loans loan JOIN contacts contact ON contact.id = loan.contactId
    LEFT JOIN closing_plans plan ON plan.loanId = loan.id
    LEFT JOIN past_client_profiles past ON past.loanId = loan.id
    LEFT JOIN closing_progress progress ON progress.loanId = loan.id
    WHERE loan.id = ?`).get(loanId) as Omit<ClosingPacketSnapshot, "disclosure" | "checklist"> | undefined;
  if (!loan) return;
  const items = db.prepare(`SELECT id, title, owner, dueDate, completedAt FROM closing_items
    WHERE loanId = ? ORDER BY dueDate, id LIMIT ?`).all(loanId, closingPacketChecklistLimit + 1) as unknown as
    (ClosingPacketSnapshot["checklist"][number] & { id: string })[];
  if (items.length > closingPacketChecklistLimit) return;
  const links = closingServiceEvidence(db, loanId);
  const checklist = items.map(({ id, ...item }) => {
    const serviceEvidence = links.filter(({ itemId }) => itemId === id);
    return serviceEvidence.length ? { ...item, serviceEvidence } : item;
  });
  const { version, revision, at, actor, applicationRevision, feeRevision, signers, changeReview, feeAllocations } = review;
  const { documents, issuedAt, signBy, quote, deadlineBasis } = packageRow;
  return { ...loan, disclosure: { version, revision, at, actor, applicationRevision, feeRevision, signers, changeReview,
    documents, issuedAt, signBy, ...(deadlineBasis ? { calendarVersion: deadlineBasis.version } : {}),
    loanAmount: quote.loanAmount, product: quote.product, rate: quote.rate,
    cashToClose: quote.estimate?.cashToClose ?? null, ...(feeAllocations?.length ? { feeAllocations } : {}) }, checklist };
}

function packetRows(db: Store, loanId: string, limit: number) {
  return db.prepare("SELECT version, preparedAt, preparedBy, snapshot FROM closing_packets WHERE loanId = ? ORDER BY version DESC LIMIT ?")
    .all(loanId, limit) as unknown as PacketRow[];
}

export function readClosingPackets(db: Store, loanId: string, work: DisclosureWork): ClosingPacketWork {
  const rows = packetRows(db, loanId, 4);
  const current = rows.length ? JSON.stringify(packetSnapshot(db, loanId, work)) : undefined;
  return { canPrepare: work.closingReviews.some((review) => review.current),
    packets: rows.map(({ snapshot, ...packet }, index) => ({
      ...packet, current: index === 0 && snapshot === current,
      disclosureVersion: (JSON.parse(snapshot) as ClosingPacketSnapshot).disclosure.version,
    })) };
}

export function prepareClosingPacket(db: Store, staff: WorkspaceStaff | null, data: z.infer<typeof prepareClosingPacketInput>, now: string) {
  if (!canUseSampleDisclosures(staff)) return { error: closingPacketUnavailable } as const;
  const work = readDisclosureWork(db, data.loanId);
  const confirmation = work.closingReviews.find(({ current }) => current);
  if (!confirmation || confirmation.version !== data.disclosureVersion || confirmation.revision !== data.disclosureRevision) {
    return { error: "Confirm the current signed sample disclosure package before preparing a closing packet." } as const;
  }
  const snapshot = packetSnapshot(db, data.loanId, work);
  if (!snapshot) return { error: `Use a fictional closing checklist of up to ${closingPacketChecklistLimit} items.` } as const;
  const encoded = JSON.stringify(snapshot);
  const [prior] = packetRows(db, data.loanId, 1);
  if (prior?.snapshot === encoded) return { message: `Sample closing packet v${prior.version} is already prepared.` } as const;
  if ((prior?.version ?? null) !== data.previousVersion) return { error: "The closing packet changed. Refresh the loan before preparing another version." } as const;
  const version = (prior?.version ?? 0) + 1;
  const preparedBy = staff?.name ?? "Demo staff";
  const pdf = closingPacketPdf({ version, preparedAt: now, preparedBy, snapshot });
  db.prepare("INSERT INTO closing_packets (loanId, version, preparedAt, preparedBy, snapshot, pdf) VALUES (?, ?, ?, ?, ?, ?)")
    .run(data.loanId, version, now, preparedBy, encoded, pdf);
  addApplicationActivity(db, data.loanId, `Prepared sample closing packet v${version} using confirmed disclosure v${confirmation.version}.`, now);
  return { version, message: `Sample closing packet v${version} prepared.` } as const;
}

export function readClosingPacket(db: Store, input: unknown, staff: WorkspaceStaff | null, brokerageId: string): (ClosingPacket & { pdf: string }) | null {
  const parsed = closingPacketRequest.safeParse(input);
  if (!parsed.success || !staff || staff.brokerage.id !== brokerageId || !canUseSampleDisclosures(staff) ||
    !loanAccess(db, staff, parsed.data.loanId)) return null;
  const row = db.prepare("SELECT version, preparedAt, preparedBy, snapshot, pdf FROM closing_packets WHERE loanId = ? AND version = ?")
    .get(parsed.data.loanId, parsed.data.version) as (PacketRow & { pdf: string | null }) | undefined;
  if (!row) return null;
  const { pdf, snapshot, ...fields } = row;
  const packet = { ...fields, snapshot: JSON.parse(snapshot) as ClosingPacketSnapshot };
  return { ...packet, pdf: pdf ?? closingPacketPdf(packet) };
}
