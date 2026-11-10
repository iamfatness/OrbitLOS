import { z } from "zod";
import { cutoverDeliveryReceipt, cutoverHistoryLimit, type CutoverConditionEvidence, type CutoverDocumentEvidence,
  type CutoverEvidenceDifference } from "./cutover-file-model";
import type { Store } from "./store";

const evidenceGroups = ["revision", "acceptances", "receipts", "clearance"] as const;
type Fact = { key: string; label: string; value: string };
export type RevisionEvidence = Partial<Record<(typeof evidenceGroups)[number], Fact[]>>;

export function documentRevisionEvidence({ revision, acceptedRevisions }: CutoverDocumentEvidence): RevisionEvidence {
  return {
    revision: [{ key: "revision", label: "Checklist revision", value: `Revision ${revision}` }],
    acceptances: acceptedRevisions?.toSorted((a, b) => a - b).map((value) => ({ key: String(value), label: `Accepted revision ${value}`, value: "Recorded" })),
  };
}

export function conditionDeliveryEvidence({ receipts, clearance }: CutoverConditionEvidence): RevisionEvidence {
  return {
    receipts: receipts?.map(({ reference, documentRevision, state }) => ({ key: JSON.stringify([reference, documentRevision]),
      label: `Receipt ${reference}`, value: `${state} · ${documentRevision === null ? "Revision unrecorded" : `Revision ${documentRevision}`}` }))
      .sort((a, b) => a.key.localeCompare(b.key) || a.value.localeCompare(b.value)),
    clearance: clearance === undefined ? undefined : clearance ? [{ key: "clearance", label: "Clearance",
      value: [new Date(clearance.at).toISOString(), clearance.reference].filter(Boolean).join(" · ") }] : [],
  };
}

export function compareRevisionEvidence(source: RevisionEvidence, destination?: RevisionEvidence) {
  return evidenceGroups.flatMap((group) => {
    const original = source[group];
    if (!original) return [];
    const current = new Map((destination?.[group] ?? []).map((fact) => [fact.key, fact]));
    const differences: CutoverEvidenceDifference[] = original.map(({ key, label, value }) => {
      const match = current.get(key);
      current.delete(key);
      return { label, source: value, destination: match?.value ?? null, status: !match ? "Missing" : match.value === value ? "Matched" : "Changed" };
    });
    for (const { label, value } of current.values()) differences.push({ label, source: null, destination: value, status: "Added" });
    return differences;
  });
}

export function readAcceptanceHistory(db: Store, loanId: string) {
  const raw = db.prepare(`SELECT acceptance.requestId, acceptance.revision FROM document_requests request
    JOIN document_acceptances acceptance ON acceptance.requestId = request.id WHERE request.loanId = ?
    ORDER BY acceptance.requestId, acceptance.revision LIMIT ?`).all(loanId, cutoverHistoryLimit + 1);
  const parsed = z.array(z.object({ requestId: z.string(), revision: z.int().nonnegative() })).max(cutoverHistoryLimit).safeParse(raw);
  if (!parsed.success) return null;
  const history = new Map<string, number[]>();
  for (const { requestId, revision } of parsed.data) {
    const entries = history.get(requestId) ?? [];
    entries.push(revision);
    history.set(requestId, entries);
  }
  return history;
}

const storedReceipt = cutoverDeliveryReceipt.omit({ state: true }).extend({ requestId: z.string(), state: z.enum(["Current", "Prior"]) });

export function readMockDeliveryHistory(db: Store, loanId: string) {
  const raw = db.prepare(`SELECT request.id AS requestId, delivery.receipt AS reference, delivery.documentRevision,
      CASE WHEN request.status = 'Accepted' AND (delivery.documentRevision IS NULL OR delivery.documentRevision = request.revision)
        THEN 'Current' ELSE 'Prior' END AS state
    FROM document_requests request JOIN submissions file ON file.id = request.submissionId AND file.loanId = request.loanId
    JOIN uwm_document_deliveries delivery ON delivery.requestId = request.id
    WHERE request.loanId = ? AND file.lender = 'UWM' AND file.syncedAt IS NOT NULL
    UNION ALL
    SELECT request.id, delivery.receipt, delivery.documentRevision, 'Prior'
    FROM document_requests request JOIN submissions file ON file.id = request.submissionId AND file.loanId = request.loanId
    JOIN uwm_document_delivery_history delivery ON delivery.requestId = request.id
    WHERE request.loanId = ? AND file.lender = 'UWM' AND file.syncedAt IS NOT NULL LIMIT ?`).all(loanId, loanId, cutoverHistoryLimit + 1);
  const parsed = z.array(storedReceipt).max(cutoverHistoryLimit).safeParse(raw);
  if (!parsed.success) return null;
  const history = new Map<string, NonNullable<CutoverConditionEvidence["receipts"]>>();
  for (const { requestId, ...receipt } of parsed.data) {
    const entries = history.get(requestId) ?? [];
    entries.push(receipt);
    history.set(requestId, entries);
  }
  return history;
}
