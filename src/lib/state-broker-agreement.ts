import { brokerAgreementEvents, reviewBrokerAgreement, type BrokerAgreementFacts, type BrokerAgreementRequest } from "./state-broker-agreement-model";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { loanAccess } from "./workspace-access";

export function initializeStateBrokerAgreement(db: Store) {
  db.exec(`CREATE TABLE IF NOT EXISTS compliance_broker_agreement_versions (
    brokerageId TEXT NOT NULL, loanId TEXT NOT NULL, state TEXT NOT NULL, revision INTEGER NOT NULL,
    facts TEXT NOT NULL, correction TEXT, actor TEXT NOT NULL, actorRevision INTEGER NOT NULL, at TEXT NOT NULL,
    requestId TEXT NOT NULL, request TEXT NOT NULL,
    PRIMARY KEY (brokerageId,loanId,state,revision), UNIQUE (brokerageId,requestId)
  );`);
}

const unavailable = { error: "Brokerage agreement evidence is available on accessible Indiana, Illinois and Wisconsin pilot applications." };
const conflict = { error: "Agreement evidence changed. Refresh and review before saving." };

export function stateBrokerAgreementWork(db: Store, input: BrokerAgreementRequest, staff: WorkspaceStaff, now: string) {
  const { loanId } = input;
  const tenant = staff.brokerage.id;
  const state = input.operation === "read" ? input.state : input.facts.state;
  const access = loanAccess(db, staff, loanId);
  if (!access || !db.prepare(`SELECT 1 FROM applications WHERE loanId=?
    AND upper(trim(json_extract(draft,'$.propertyLocation.state')))=?`).get(loanId, state)) return unavailable;
  const read = () => {
    const rows = db.prepare(`SELECT revision,facts,correction,actor,at FROM compliance_broker_agreement_versions
      WHERE brokerageId=? AND loanId=? AND state=? ORDER BY revision DESC LIMIT 21`).all(tenant, loanId, state);
    const history = rows.slice(0, 20).map(row => ({
      revision: Number(row.revision), facts: JSON.parse(String(row.facts)) as BrokerAgreementFacts,
      correction: row.correction as string | null, actor: String(row.actor), at: String(row.at),
    }));
    const latest = history[0];
    return { kind: "stateBrokerAgreement" as const, state, revision: latest?.revision ?? 0, history,
      moreHistory: rows.length > 20, review: latest ? reviewBrokerAgreement(latest.facts) : null };
  };
  if (input.operation === "read") return read();
  if (access === "processor") return { error: "Only the assigned loan officer or an admin can record agreement evidence." };
  if (db.prepare("SELECT disposition FROM loans WHERE id=?").get(loanId)?.disposition !== "Active")
    return { error: "This loan is paused. Resume it before recording evidence." };
  const request = JSON.stringify(input);
  const actorRevision = staff.brokerage.accessRevision ?? 0;
  const replay = db.prepare("SELECT actor,actorRevision,request FROM compliance_broker_agreement_versions WHERE brokerageId=? AND requestId=?")
    .get(tenant, input.requestId);
  if (replay) return replay.actor === staff.email && replay.actorRevision === actorRevision && replay.request === request ? read() : conflict;
  const latest = db.prepare(`SELECT revision FROM compliance_broker_agreement_versions
    WHERE brokerageId=? AND loanId=? AND state=? ORDER BY revision DESC LIMIT 1`).get(tenant, loanId, state);
  const revision = Number(latest?.revision ?? 0);
  if (input.expectedRevision !== revision) return conflict;
  if (revision && !input.correction) return { error: "Enter a correction reference for the previous evidence version." };
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: input.facts.zone, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(now));
  if (brokerAgreementEvents(input.facts).some(event => event && event.on > today))
    return { error: "Agreement evidence cannot be dated in the future." };
  db.prepare(`INSERT INTO compliance_broker_agreement_versions
    (brokerageId,loanId,state,revision,facts,correction,actor,actorRevision,at,requestId,request) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(tenant, loanId, state, revision + 1, JSON.stringify(input.facts), input.correction ?? null, staff.email, actorRevision, now, input.requestId, request);
  return read();
}
