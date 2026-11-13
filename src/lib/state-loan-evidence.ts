import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { loanAccess } from "./workspace-access";

type EvidenceTable = "compliance_broker_agreement_versions" | "compliance_refinance_benefit_versions" |
  "compliance_kansas_notice_versions" | "compliance_michigan_loan_practices_versions";
type EvidenceFacts = { state: string };
type EvidenceRequest<Facts extends EvidenceFacts> = { operation: "read"; loanId: string; state: Facts["state"] } |
  { operation: "save"; loanId: string; expectedRevision: number; requestId: string; facts: Facts; correction?: string };

export function initializeStateLoanEvidence(db: Store, table: EvidenceTable) {
  db.exec(`CREATE TABLE IF NOT EXISTS ${table} (
    brokerageId TEXT NOT NULL, loanId TEXT NOT NULL, state TEXT NOT NULL, revision INTEGER NOT NULL,
    facts TEXT NOT NULL, correction TEXT, actor TEXT NOT NULL, actorRevision INTEGER NOT NULL, at TEXT NOT NULL,
    requestId TEXT NOT NULL, request TEXT NOT NULL,
    PRIMARY KEY (brokerageId,loanId,state,revision), UNIQUE (brokerageId,requestId)
  );`);
}

export function stateLoanEvidenceWork<Facts extends EvidenceFacts, Kind extends string, Review>(db: Store, input: EvidenceRequest<Facts>,
  staff: WorkspaceStaff, now: string, options: {
    table: EvidenceTable; kind: Kind; name: string; unavailable: string; purpose?: "Refinance";
    dates: (facts: Facts) => readonly (string | undefined)[]; zone: (facts: Facts) => string; review: (facts: Facts) => Review;
  }) {
  const { loanId } = input;
  const tenant = staff.brokerage.id;
  const state = input.operation === "read" ? input.state : input.facts.state;
  const access = loanAccess(db, staff, loanId);
  const loan = access && db.prepare(`SELECT loan.purpose,loan.disposition FROM applications app JOIN loans loan ON loan.id=app.loanId
    WHERE app.loanId=? AND upper(trim(json_extract(app.draft,'$.propertyLocation.state')))=?`).get(loanId, state);
  if (!access || !loan || (options.purpose && loan.purpose !== options.purpose)) return { error: options.unavailable };
  const read = () => {
    const rows = db.prepare(`SELECT revision,facts,correction,actor,at FROM ${options.table}
      WHERE brokerageId=? AND loanId=? AND state=? ORDER BY revision DESC LIMIT 21`).all(tenant, loanId, state);
    const history = rows.slice(0, 20).map(row => ({
      revision: Number(row.revision), facts: JSON.parse(String(row.facts)) as Facts,
      correction: row.correction as string | null, actor: String(row.actor), at: String(row.at),
    }));
    const latest = history[0];
    return { kind: options.kind, state, revision: latest?.revision ?? 0, history,
      moreHistory: rows.length > 20, review: latest ? options.review(latest.facts) : null };
  };
  if (input.operation === "read") return read();
  const label = options.name.toLowerCase();
  if (access === "processor") return { error: `Only the assigned loan officer or an admin can record ${label} evidence.` };
  if (loan.disposition !== "Active") return { error: "This loan is paused. Resume it before recording evidence." };
  const conflict = { error: `${options.name} evidence changed. Refresh and review before saving.` };
  const request = JSON.stringify(input);
  const actorRevision = staff.brokerage.accessRevision ?? 0;
  const replay = db.prepare(`SELECT actor,actorRevision,request FROM ${options.table} WHERE brokerageId=? AND requestId=?`)
    .get(tenant, input.requestId);
  if (replay) return replay.actor === staff.email && replay.actorRevision === actorRevision && replay.request === request ? read() : conflict;
  const latest = db.prepare(`SELECT revision FROM ${options.table}
    WHERE brokerageId=? AND loanId=? AND state=? ORDER BY revision DESC LIMIT 1`).get(tenant, loanId, state);
  const revision = Number(latest?.revision ?? 0);
  if (input.expectedRevision !== revision) return conflict;
  if (revision && !input.correction) return { error: "Enter a correction reference for the previous evidence version." };
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: options.zone(input.facts), year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(now));
  if (options.dates(input.facts).some(on => on && on > today)) return { error: `${options.name} evidence cannot be dated in the future.` };
  db.prepare(`INSERT INTO ${options.table}
    (brokerageId,loanId,state,revision,facts,correction,actor,actorRevision,at,requestId,request) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(tenant, loanId, state, revision + 1, JSON.stringify(input.facts), input.correction ?? null, staff.email, actorRevision, now, input.requestId, request);
  return read();
}
