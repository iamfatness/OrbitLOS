import { z } from "zod";
import { easternDate } from "./client-retention";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { accessEvent } from "./workspace-access";

const reference = z.string().trim().min(4).max(240);
const date = z.iso.date().refine(value => value >= "1900-01-01" && value <= "9990-12-31");
const key = z.string().trim().min(1).max(200);
const scope = {
  authority: z.enum(["First mortgage", "Secondary mortgage"]),
  reference,
};
const transfer = z.discriminatedUnion("status", [
  z.object({ status: z.literal("No transfer") }),
  z.object({ status: z.literal("Unknown") }),
  z.object({ status: z.literal("Transferred"), date }),
]);
const evidence = z.discriminatedUnion("category", [
  z.object({ ...scope, category: z.literal("Closed loan file"),
    role: z.enum(["Broker only", "Lender", "Unresolved"]), closedOn: date, transfer }),
  z.object({ ...scope, category: z.literal("Transferred copies"), closedOn: date, transferredOn: date }),
  z.object({ ...scope, category: z.literal("Unsuccessful application"),
    outcome: z.enum(["Denied", "Withdrawn"]), retainThrough: date.nullable(), counselReference: reference.nullable() }),
  z.object({ ...scope, category: z.literal("Other business records"), createdOn: date, fiscalYearEnd: date }),
]).superRefine((record, ctx) => {
  const reject = (field: string) => ctx.addIssue({ code: "custom", path: [field], message: "Check the retention dates and supporting evidence." });
  if (record.category === "Closed loan file" && record.transfer.status === "Transferred" &&
    (record.role === "Broker only" || record.transfer.date < record.closedOn)) reject("transfer");
  if (record.category === "Transferred copies" && record.transferredOn < record.closedOn) reject("transferredOn");
  if (record.category === "Unsuccessful application" && !!record.retainThrough !== !!record.counselReference) reject("counselReference");
  if (record.category === "Other business records" && record.fiscalYearEnd < record.createdOn) reject("fiscalYearEnd");
});
type Evidence = z.infer<typeof evidence>;

const target = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("loan"), id: key }),
  z.object({ kind: z.literal("business"), id: key }),
]);
const category = z.enum(["Closed loan file", "Transferred copies", "Unsuccessful application", "Other business records"]);
export const michiganRetentionRequest = z.discriminatedUnion("type", [
  z.object({ type: z.literal("michiganBusinessRecords"), offset: z.number().int().min(0).max(10000) }),
  z.object({ type: z.literal("michiganRetentionHistory"), target, category, before: z.number().int().positive().optional() }),
  z.object({ type: z.literal("saveMichiganRetentionReview"), target, id: z.uuid(),
    expected: z.number().int().nonnegative(), evidence }),
]);
type Command = z.infer<typeof michiganRetentionRequest>;
type Finding = { date: string | null; basis: string; authority: string };
type Review = {
  version: number; evidence: Evidence; finding: Finding; at: string; actor: string;
};
export type MichiganRetentionResult = {
  kind: "michiganRetention"; versions: Review[]; next: number | null; held: boolean; message?: string;
};
export type MichiganBusinessRecords = { kind: "michiganBusinessRecords"; records: string[]; next: number | null };

export function michiganLoanState(draft: string) {
  return `upper(trim(json_extract(CASE WHEN json_valid(${draft}) THEN ${draft} END, '$.propertyLocation.state')))`;
}

function anniversary(trigger: string, years: number) {
  const result = String(Number(trigger.slice(0, 4)) + years).padStart(4, "0") + trigger.slice(4);
  return z.iso.date().safeParse(result).success ? result : null;
}

function stateFinding(record: Evidence): Finding {
  const years = record.authority === "First mortgage" ? 3 : 2;
  const authority = years === 3 ? "MCL 445.1671(2)" : "MCL 493.68";
  function after(trigger: string, basis: string): Finding {
    const result = anniversary(trigger, years);
    return { date: result, basis: result ? basis : "Counsel review needed for the February 29 anniversary.", authority };
  }
  switch (record.category) {
    case "Closed loan file": {
      if (record.role === "Unresolved" || (record.role === "Lender" && record.transfer.status === "Unknown")) {
        return { date: null, basis: "Confirm the brokerage role and whether the lender transferred or assigned the loan.", authority };
      }
      const closing = after(record.closedOn, `${years} years from closing`);
      if (record.transfer.status === "Transferred" && closing.date && record.transfer.date < closing.date) {
        return { date: record.transfer.date, basis: "Earlier transfer or assignment for the general loan file. Review the retained copies separately.", authority };
      }
      return closing;
    }
    case "Transferred copies":
      return after(record.transferredOn, `${years} years from transfer or assignment for the specified copies`);
    case "Unsuccessful application":
      return { date: record.retainThrough, basis: record.retainThrough ?
        "Date entered from the documented counsel review" : "Identify the applicable state and federal period and its triggering event.", authority };
    case "Other business records":
      return after(record.fiscalYearEnd, `${years} years from the end of the fiscal year of creation`);
  }
}

export function initializeMichiganRetention(db: Store) {
  db.exec(`CREATE TABLE IF NOT EXISTS michigan_retention_reviews (
    id TEXT PRIMARY KEY, targetKind TEXT NOT NULL, targetId TEXT NOT NULL, category TEXT NOT NULL,
    version INTEGER NOT NULL, evidence TEXT NOT NULL, finding TEXT NOT NULL, at TEXT NOT NULL,
    actor TEXT NOT NULL, actorEmail TEXT NOT NULL,
    UNIQUE(targetKind,targetId,category,version)
  )`);
}

// The enclosing owner-scoped retention transaction protects version checks and history.
export function michiganRetentionWork(db: Store, command: Command, staff: WorkspaceStaff, now: string):
  MichiganRetentionResult | MichiganBusinessRecords | { error: string } {
  if (command.type === "michiganBusinessRecords") {
    const records = db.prepare(`SELECT DISTINCT targetId FROM michigan_retention_reviews
      WHERE targetKind='business' ORDER BY targetId COLLATE NOCASE,targetId LIMIT 16 OFFSET ?`).all(command.offset);
    return { kind: "michiganBusinessRecords", records: records.slice(0, 15).map(row => String(row.targetId)),
      next: records.length > 15 ? command.offset + 15 : null };
  }
  const { kind, id: targetId } = command.target;
  const category = command.type === "saveMichiganRetentionReview" ? command.evidence.category : command.category;
  if ((kind === "business") !== (category === "Other business records")) {
    return { error: "Choose a retention category for this record." };
  }
  const args = [kind, targetId, category];
  function history(before: number | null, message?: string): MichiganRetentionResult {
    const rows = db.prepare(`SELECT version,evidence,finding,at,actor FROM michigan_retention_reviews
      WHERE targetKind=? AND targetId=? AND category=? AND (? IS NULL OR version<?) ORDER BY version DESC LIMIT 21`)
      .all(...args, before, before);
    return { kind: "michiganRetention", versions: rows.slice(0, 20).map(row => ({
      version: Number(row.version), evidence: JSON.parse(String(row.evidence)), finding: JSON.parse(String(row.finding)),
      at: String(row.at), actor: String(row.actor),
    })), next: rows.length > 20 ? Number(rows[19].version) : null, held: kind === "loan" && !!db.prepare(
      "SELECT 1 FROM loan_retention_holds WHERE loanId=? AND releasedAt IS NULL").get(targetId), message };
  }
  if (command.type === "michiganRetentionHistory") {
    const result = history(command.before ?? null);
    if (kind === "loan" && !result.versions.length && !db.prepare("SELECT 1 FROM loans WHERE id=?").get(targetId)) {
      const recorded = db.prepare(`SELECT 1 FROM michigan_retention_reviews WHERE targetKind=? AND targetId=? AND category=? LIMIT 1`).get(...args);
      if (!recorded) return { error: "This loan is unavailable." };
    }
    return result;
  }

  const review = command.evidence;
  const evidenceJson = JSON.stringify(review);
  const prior = db.prepare("SELECT * FROM michigan_retention_reviews WHERE id=?").get(command.id);
  if (prior) {
    if (prior.targetKind !== kind || prior.targetId !== targetId || prior.category !== category ||
      prior.version !== command.expected + 1 || prior.evidence !== evidenceJson || prior.actorEmail !== staff.email) {
      return { error: "This request belongs to a different Michigan retention review." };
    }
    return history(null, "Michigan retention evidence recorded.");
  }
  if (kind === "loan") {
    const loan = db.prepare(`SELECT ${michiganLoanState("a.draft")} AS state
      FROM loans l LEFT JOIN applications a ON a.loanId=l.id WHERE l.id=?`).get(targetId);
    if (!loan) return { error: "This loan is unavailable." };
    if (loan.state && loan.state !== "MI") {
      return { error: "The saved property state is outside Michigan. Review the loan before recording Michigan evidence." };
    }
  }
  const today = easternDate(new Date(now));
  const recordedDates = review.category === "Closed loan file" ?
    [review.closedOn, review.transfer.status === "Transferred" ? review.transfer.date : null] :
    review.category === "Transferred copies" ? [review.closedOn, review.transferredOn] :
    review.category === "Other business records" ? [review.createdOn] : [];
  if (recordedDates.some(value => value && value > today)) return { error: "Record only events that have occurred." };
  const current = db.prepare(`SELECT max(version) AS version FROM michigan_retention_reviews
    WHERE targetKind=? AND targetId=? AND category=?`).get(...args);
  if (Number(current?.version ?? 0) !== command.expected) return { error: "The review changed. Reload the saved evidence before saving." };
  db.prepare(`INSERT INTO michigan_retention_reviews
    (id,targetKind,targetId,category,version,evidence,finding,at,actor,actorEmail) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(command.id, ...args, command.expected + 1, evidenceJson, JSON.stringify(stateFinding(review)), now, staff.name, staff.email);
  accessEvent(db, staff, "Recorded Michigan retention review", `${targetId} · ${category}`, now);
  return history(null, "Michigan retention evidence recorded.");
}
