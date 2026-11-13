import { createHash } from "node:crypto";
import { advertisingRuleRevision, advertisingZones, evaluateAdvertising, type AdvertisingFacts, type AdvertisingReviewRequest } from "./advertising-review-model";
import type { ProgramEntity } from "./compliance-program-model";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";

const unavailable = { error: "Advertising evidence is available to pilot owners for a recorded legal entity." };
const changed = { error: "This advertising record changed. Reload its latest evidence before saving." };
const pageSize = 20;
type Review = ReturnType<typeof evaluateAdvertising>;
type Stored = { revision: number; facts: string; review: string; entitySnapshot: string; creativeDigest: string;
  savedAt: string; actorName: string; correction: string | null };

export function initializeAdvertisingReview(db: Store) {
  db.exec(`CREATE TABLE IF NOT EXISTS compliance_advertising_versions (
    brokerageId TEXT NOT NULL, entityId TEXT NOT NULL, jurisdiction TEXT NOT NULL, adId TEXT NOT NULL,
    revision INTEGER NOT NULL, title TEXT NOT NULL, channel TEXT NOT NULL, facts TEXT NOT NULL, review TEXT NOT NULL,
    entitySnapshot TEXT NOT NULL, creativeDigest TEXT NOT NULL, savedAt TEXT NOT NULL, actorName TEXT NOT NULL,
    actorEmail TEXT NOT NULL, actorRevision INTEGER NOT NULL, correction TEXT, requestId TEXT NOT NULL, request TEXT NOT NULL,
    PRIMARY KEY(brokerageId,entityId,jurisdiction,adId,revision), UNIQUE(brokerageId,requestId),
    FOREIGN KEY(brokerageId,entityId) REFERENCES compliance_program_entities(brokerageId,id)
  );
  CREATE INDEX IF NOT EXISTS advertising_review_list ON compliance_advertising_versions
    (brokerageId,entityId,jurisdiction,savedAt DESC,adId);`);
}

function digestCreative(creative: AdvertisingFacts["creative"]) {
  return creative.kind === "Text" ? createHash("sha256").update(creative.copy, "utf8").digest("hex") : creative.sha256;
}

// Runs inside the current-roster and workspace-checked compliance transaction.
export function advertisingReviewWork(db: Store, input: AdvertisingReviewRequest, staff: WorkspaceStaff, now: string) {
  if (staff.brokerage.role !== "Admin") return unavailable;
  const args = [staff.brokerage.id, input.entityId, input.jurisdiction] as const;
  const entity = db.prepare("SELECT id,name,nmls,scopeNote,createdAt FROM compliance_program_entities WHERE brokerageId=? AND id=?")
    .get(args[0], args[1]) as ProgramEntity | undefined;
  if (!entity) return unavailable;
  if (input.operation === "list") {
    const rows = db.prepare(`SELECT v.adId,v.revision,v.title,v.channel,v.savedAt,
      (SELECT count(*) FROM json_each(json_extract(v.review,'$.findings')) WHERE json_extract(value,'$.status')='Evidence gap') AS gaps,
      (SELECT count(*) FROM json_each(json_extract(v.review,'$.findings')) WHERE json_extract(value,'$.status')='Review concern') AS concerns
      FROM compliance_advertising_versions v
      WHERE v.brokerageId=? AND v.entityId=? AND v.jurisdiction=?
        AND v.revision=(SELECT max(w.revision) FROM compliance_advertising_versions w WHERE w.brokerageId=v.brokerageId
          AND w.entityId=v.entityId AND w.jurisdiction=v.jurisdiction AND w.adId=v.adId)
      ORDER BY v.savedAt DESC,v.adId LIMIT ? OFFSET ?`).all(...args, pageSize + 1, input.offset);
    return { kind: "advertisingList" as const, entity, jurisdiction: input.jurisdiction,
      items: rows.slice(0, pageSize).map(row => ({
        id: String(row.adId), revision: Number(row.revision), title: String(row.title),
        channel: String(row.channel), savedAt: String(row.savedAt), gaps: Number(row.gaps), concerns: Number(row.concerns),
      })), next: rows.length > pageSize ? input.offset + pageSize : null };
  }

  const adId = input.adId;
  const ad = [...args, adId];
  const latest = () => db.prepare(`SELECT revision,facts,review,entitySnapshot,creativeDigest,savedAt,actorName,correction
    FROM compliance_advertising_versions WHERE brokerageId=? AND entityId=? AND jurisdiction=? AND adId=?
    ORDER BY revision DESC LIMIT 1`).get(...ad) as Stored | undefined;
  function detail(revision?: number, before?: number) {
    const head = latest();
    const row = revision === undefined ? head : db.prepare(`SELECT revision,facts,review,entitySnapshot,creativeDigest,savedAt,actorName,correction
      FROM compliance_advertising_versions WHERE brokerageId=? AND entityId=? AND jurisdiction=? AND adId=? AND revision=?`)
      .get(...ad, revision) as Stored | undefined;
    if (!row) return unavailable;
    const history = db.prepare(`SELECT revision,savedAt,actorName,correction FROM compliance_advertising_versions
      WHERE brokerageId=? AND entityId=? AND jurisdiction=? AND adId=? AND (? IS NULL OR revision<?)
      ORDER BY revision DESC LIMIT ?`).all(...ad, before ?? null, before ?? null, pageSize + 1);
    const review = JSON.parse(row.review) as Review;
    return { kind: "advertisingReview" as const, adId, jurisdiction: input.jurisdiction, entity,
      latestRevision: head?.revision ?? row.revision, revision: row.revision,
      facts: JSON.parse(row.facts) as AdvertisingFacts, review, entitySnapshot: JSON.parse(row.entitySnapshot) as ProgramEntity,
      creativeDigest: row.creativeDigest, savedAt: row.savedAt, reviewer: row.actorName, correction: row.correction,
      rulesChanged: review.ruleRevision !== advertisingRuleRevision, entityChanged: row.entitySnapshot !== JSON.stringify(entity),
      history: history.slice(0, pageSize).map(item => ({
        revision: Number(item.revision), savedAt: String(item.savedAt), reviewer: String(item.actorName),
        correction: item.correction === null ? null : String(item.correction),
      })), next: history.length > pageSize ? Number(history[pageSize - 1].revision) : null };
  }
  if (input.operation === "read") return detail(input.revision, input.before);

  const request = JSON.stringify(input);
  const actorRevision = staff.brokerage.accessRevision ?? 0;
  const replay = db.prepare("SELECT actorEmail,actorRevision,request FROM compliance_advertising_versions WHERE brokerageId=? AND requestId=?")
    .get(args[0], input.requestId);
  if (replay) return replay.actorEmail === staff.email && replay.actorRevision === actorRevision && replay.request === request ? detail() : changed;
  const head = latest();
  if ((head?.revision ?? 0) !== input.expectedRevision) return changed;
  if (head && !input.correction) return { error: "Record the reason for this evidence correction." };
  const facts = input.facts;
  const zones: readonly AdvertisingFacts["zone"][] = advertisingZones[input.jurisdiction];
  if (!zones.includes(facts.zone)) return { error: "Choose a review time zone for the selected state." };
  if (facts.stateEvidence && facts.stateEvidence.jurisdiction !== input.jurisdiction)
    return { error: "The state evidence must match the selected jurisdiction." };
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: facts.zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
  const website = facts.stateEvidence?.jurisdiction === "OH" ? facts.stateEvidence.website : undefined;
  if (website?.updatedOn && (!website.outdatedOn || website.updatedOn < website.outdatedOn))
    return { error: "Record the outdated date on or before the website update date." };
  if ([facts.reviewedOn, facts.distribution?.firstOn, facts.distribution?.finalOn, website?.outdatedOn, website?.updatedOn].some(value => value && value > today))
    return { error: "Record only review and distribution events that have occurred." };
  const digest = digestCreative(facts.creative);
  if (head && (digest !== head.creativeDigest || facts.creative.kind !== (JSON.parse(head.facts) as AdvertisingFacts).creative.kind))
    return { error: "Save changed creative as a new advertising record. Corrections preserve the original creative and its evidence." };
  const review = evaluateAdvertising(input.jurisdiction, facts, entity.nmls, today);
  db.prepare(`INSERT INTO compliance_advertising_versions
    (brokerageId,entityId,jurisdiction,adId,revision,title,channel,facts,review,entitySnapshot,creativeDigest,
     savedAt,actorName,actorEmail,actorRevision,correction,requestId,request) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(...ad, input.expectedRevision + 1, facts.title, facts.channel, JSON.stringify(facts), JSON.stringify(review), JSON.stringify(entity),
      digest, now, staff.name, staff.email, actorRevision, input.correction ?? null, input.requestId, request);
  return detail();
}

export type AdvertisingReviewResult = ReturnType<typeof advertisingReviewWork>;
