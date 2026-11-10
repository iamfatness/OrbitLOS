import { addApplicationActivity } from "./applications";
import { closingServiceEvidenceLimit, type closingServiceEvidenceInput, type ClosingServiceEvidence } from "./closing-service-evidence-model";
import { canUseServiceOrders } from "./service-orders";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { loanAccess } from "./workspace-access";
import type { z } from "zod";

export function closingServiceEvidence(db: Store, loanId: string) {
  return db.prepare(`SELECT evidence.*, service.kind, json_extract(receipt.value, '$.returnedAt') AS returnedAt,
    json_extract(receipt.value, '$.review.at') AS acceptedAt, json_extract(receipt.value, '$.review.actor') AS acceptedBy
    FROM closing_items item JOIN closing_service_evidence evidence ON evidence.itemId = item.id
    JOIN service_orders service ON service.id = evidence.orderId AND service.loanId = item.loanId
    JOIN json_each(service.returns) receipt ON json_extract(receipt.value, '$.reference') = evidence.reference
    WHERE item.loanId = ? AND service.status = 'Completed' AND json_extract(receipt.value, '$.review.decision') = 'Accepted'
    ORDER BY evidence.itemId, evidence.linkedAt, evidence.reference`).all(loanId) as unknown as ClosingServiceEvidence[];
}

export function setClosingServiceEvidence(db: Store, input: z.infer<typeof closingServiceEvidenceInput>, staff: WorkspaceStaff | null, at: string) {
  const { loanId, itemId, itemRevision, orderId, reference, linked } = input;
  if (!canUseServiceOrders(staff) || (staff && !loanAccess(db, staff, loanId))) {
    return { error: "Sample closing evidence is available on assigned loans in fictional workspaces." } as const;
  }
  const item = db.prepare(`SELECT item.title, item.revision FROM closing_items item JOIN loans loan ON loan.id = item.loanId
    WHERE item.id = ? AND loan.id = ? AND loan.disposition = 'Active' AND loan.stage NOT IN ('Funded', 'Closed')`).get(itemId, loanId);
  if (!item) return { error: "Open a closing checklist item on the active loan." } as const;
  const order = db.prepare(`SELECT service.kind FROM service_orders service JOIN json_each(service.returns) receipt
    WHERE service.id = ? AND service.loanId = ? AND service.status = 'Completed'
      AND json_extract(receipt.value, '$.reference') = ? AND json_extract(receipt.value, '$.review.decision') = 'Accepted'`)
    .get(orderId, loanId, reference);
  if (!order) return { error: "Choose an accepted sample return from this loan." } as const;
  const exists = Boolean(db.prepare("SELECT 1 FROM closing_service_evidence WHERE itemId = ? AND orderId = ? AND reference = ?")
    .get(itemId, orderId, reference));
  if (exists === linked) return { message: linked ? "Sample return is already linked." : "Sample return is already unlinked." } as const;
  if (item.revision !== itemRevision) return { error: "This closing item changed. Refresh the loan before updating its evidence." } as const;
  const actor = staff?.name ?? "Demo staff";
  if (linked) {
    if (Number(db.prepare("SELECT count(*) AS total FROM closing_service_evidence WHERE itemId = ?").get(itemId)?.total) >= closingServiceEvidenceLimit) {
      return { error: `Link up to ${closingServiceEvidenceLimit} sample returns per checklist item.` } as const;
    }
    db.prepare("INSERT INTO closing_service_evidence (itemId, orderId, reference, linkedAt, linkedBy) VALUES (?, ?, ?, ?, ?)")
      .run(itemId, orderId, reference, at, actor);
  } else {
    db.prepare("DELETE FROM closing_service_evidence WHERE itemId = ? AND orderId = ? AND reference = ?").run(itemId, orderId, reference);
  }
  db.prepare("UPDATE closing_items SET revision = revision + 1 WHERE id = ?").run(itemId);
  addApplicationActivity(db, loanId, `${linked ? "Linked" : "Unlinked"} mock ${String(order.kind).toLowerCase()} return for closing · ${item.title} · ${reference} · ${actor}`, at);
  return { message: linked ? "Sample return linked to the closing checklist." : "Sample return unlinked from the closing checklist." } as const;
}
