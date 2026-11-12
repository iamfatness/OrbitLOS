import { complianceProgramWork } from "./compliance-program";
import { complianceStateScopeWork } from "./compliance-state-scope";
import type { ScopeReviewRequest } from "./compliance-scope-review-model";
import type { ResearchSource } from "./compliance-research-model";
import type { ProgramItem, ProgramReviewTarget } from "./compliance-program-model";
import type { VersionedBrokerageMember } from "./brokerage-model";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";

export function initializeScopeReviews(db: Store) {
  db.exec(`CREATE TABLE IF NOT EXISTS compliance_scope_reviews (
    brokerageId TEXT NOT NULL, entityId TEXT NOT NULL, jurisdiction TEXT NOT NULL, scopeRevision INTEGER NOT NULL,
    workId TEXT NOT NULL, source TEXT NOT NULL, requestId TEXT NOT NULL, request TEXT NOT NULL,
    actor TEXT NOT NULL, actorRevision INTEGER NOT NULL,
    PRIMARY KEY(brokerageId,workId), UNIQUE(brokerageId,requestId),
    FOREIGN KEY(brokerageId,workId) REFERENCES compliance_program_items(brokerageId,id),
    FOREIGN KEY(brokerageId,entityId,jurisdiction,scopeRevision)
      REFERENCES compliance_state_scope_versions(brokerageId,entityId,jurisdiction,revision)
  );
  CREATE INDEX IF NOT EXISTS compliance_scope_review_version
    ON compliance_scope_reviews(brokerageId,entityId,jurisdiction,scopeRevision,workId);
  CREATE INDEX IF NOT EXISTS compliance_scope_review_work_history
    ON compliance_program_events(brokerageId,id,at DESC);`);
}

const unavailable = { error: "Choose a saved brokerage state record." };
const changed = { error: "This review request changed. Refresh and check the saved work." };
const pageSize = 10;

export function complianceScopeReviewWork(db: Store, data: ScopeReviewRequest, staff: WorkspaceStaff,
  roster: readonly VersionedBrokerageMember[], now: string) {
  if (staff.brokerage.role !== "Admin") return unavailable;
  const tenant = staff.brokerage.id;
  const { entityId, jurisdiction, scopeRevision } = data;
  const args = [tenant, entityId, jurisdiction, scopeRevision] as const;
  const reviewers = roster.filter(member => member.role === "Admin" && member.status === "Active");
  const request = JSON.stringify(data);
  const actorRevision = staff.brokerage.accessRevision ?? 0;
  if (data.operation === "assign") {
    const replay = db.prepare(`SELECT r.request,r.actor,r.actorRevision,i.id,i.month FROM compliance_scope_reviews r
      JOIN compliance_program_items i ON i.brokerageId=r.brokerageId AND i.id=r.workId
      WHERE r.brokerageId=? AND r.requestId=?`).get(tenant, data.requestId);
    if (replay) return replay.request === request && replay.actor === staff.email && replay.actorRevision === actorRevision
      ? { kind: "scopeReviewAssigned" as const, target: { entityId, month: String(replay.month), itemId: String(replay.id) } } : changed;
  }
  const scope = complianceStateScopeWork(db, { operation: "read", entityId, jurisdiction, revision: scopeRevision }, staff, roster, now);
  if ("error" in scope || !scope.savedBasis) return unavailable;
  const canAssign = scope.latestRevision === scopeRevision && !scope.entityChanged && !scope.sourceChanged &&
    !scope.licensesChanged && scope.savedBasis.licenses !== null;
  const sources = (JSON.parse(scope.savedBasis.sources) as string[]).map(value => {
    const { key, title, sourceUrl } = JSON.parse(value) as ResearchSource;
    return { key, title, sourceUrl };
  });
  if (data.operation === "read") {
    const offset = data.offset ?? 0;
    const rows = db.prepare(`SELECT i.id,i.month,i.instructions,i.ownerEmail,i.ownerRevision,i.status,i.internalTarget,i.evidence,r.source,
      (SELECT e.note FROM compliance_program_events e WHERE e.brokerageId=i.brokerageId AND e.id=i.id
        AND e.action IN ('Updated internal work','Reviewed internal work') ORDER BY e.at DESC,e.rowid DESC LIMIT 1) AS latestNote
      FROM compliance_scope_reviews r JOIN compliance_program_items i ON i.brokerageId=r.brokerageId AND i.id=r.workId
      WHERE r.brokerageId=? AND r.entityId=? AND r.jurisdiction=? AND r.scopeRevision=?
      ORDER BY i.updatedAt DESC,i.id DESC LIMIT ? OFFSET ?`).all(...args, pageSize + 1, offset);
    return { kind: "scopeReviews" as const, canAssign, sources,
      reviewers: reviewers.map(({ email, name, accessRevision }) => ({ email, name, revision: accessRevision ?? 0 })),
      next: rows.length > pageSize ? offset + pageSize : null,
      items: rows.slice(0, pageSize).map(row => ({
        target: { entityId, month: String(row.month), itemId: String(row.id) } satisfies ProgramReviewTarget,
        question: String(row.instructions), status: row.status as ProgramItem["status"], internalTarget: String(row.internalTarget),
        reviewer: reviewers.find(member => member.email === row.ownerEmail && (member.accessRevision ?? 0) === row.ownerRevision)?.name ?? null,
        source: JSON.parse(String(row.source)) as typeof sources[number], evidence: String(row.evidence),
        latestNote: typeof row.latestNote === "string" ? row.latestNote : null,
      })) };
  }
  if (!canAssign) return { error: "Save the current state details before assigning this question." };
  const source = sources.find(entry => entry.key === data.sourceKey);
  if (!source) return { error: "Choose a reference saved with this state record." };
  if (!reviewers.some(member => member.email === data.reviewerEmail && (member.accessRevision ?? 0) === data.reviewerRevision)) {
    return { error: "The reviewer’s access changed. Refresh and choose a current brokerage admin." };
  }
  // Use a separate event key so the state-review command has its own replay identity.
  const eventId = crypto.randomUUID();
  const month = data.internalTarget.slice(0, 7);
  const result = complianceProgramWork(db, { operation: "schedule", entityId, month, requestId: eventId,
    title: `${jurisdiction} state review: ${source.title}`.slice(0, 160), category: "Management review", ownerEmail: data.reviewerEmail,
    internalTarget: data.internalTarget, instructions: data.question }, staff, roster, now);
  if ("error" in result) return result;
  const itemId = String(db.prepare("SELECT id FROM compliance_program_events WHERE brokerageId=? AND requestId=?").get(tenant, eventId)!.id);
  db.prepare("INSERT INTO compliance_scope_reviews VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(...args, itemId, JSON.stringify(source), data.requestId, request, staff.email, actorRevision);
  return { kind: "scopeReviewAssigned" as const, target: { entityId, month, itemId } };
}
