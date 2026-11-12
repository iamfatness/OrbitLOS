import { createHash, randomUUID } from "node:crypto";
import { learningDisclaimer, learningRequest, type LearningRequest } from "./compliance-learning-model";
import type { Store } from "./store";
import type { WorkspaceStaff } from "./staff-store";
import type { VersionedBrokerageMember } from "./brokerage-model";

const unavailable = { error: "This compliance learning work is unavailable." };
const changed = { error: "This learning work changed. Refresh before saving." };
type Version = { id: string; contentId: string; previousVersionId: string | null; kind: string; title: string; body: string;
  sourceReferences: string; questions: string; passPercent: number; digest: string; actor: string; createdAt: string };
type Assignment = { id: string; versionId: string; employeeEmail: string; accessRevision: number; dueAt: string; createdAt: string };
type Questions = Extract<LearningRequest, { operation: "createVersion" }>["questions"];
const versionColumns = "id,contentId,previousVersionId,kind,title,body,sourceReferences,questions,passPercent,digest,actor,createdAt";
const assignmentColumns = "id,versionId,employeeEmail,accessRevision,dueAt,createdAt";

export function initializeComplianceLearning(db: Store) {
  db.exec(`CREATE TABLE IF NOT EXISTS compliance_learning_versions (
    brokerageId TEXT NOT NULL,id TEXT NOT NULL,contentId TEXT NOT NULL,previousVersionId TEXT,
    kind TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,sourceReferences TEXT NOT NULL,
    questions TEXT NOT NULL,passPercent INTEGER NOT NULL,digest TEXT NOT NULL,actor TEXT NOT NULL,createdAt TEXT NOT NULL,
    PRIMARY KEY(brokerageId,id));
    CREATE INDEX IF NOT EXISTS compliance_learning_content ON compliance_learning_versions(brokerageId,contentId);
    CREATE TABLE IF NOT EXISTS compliance_learning_assignments (
    brokerageId TEXT NOT NULL,id TEXT NOT NULL,versionId TEXT NOT NULL,employeeEmail TEXT NOT NULL,
    accessRevision INTEGER NOT NULL,dueAt TEXT NOT NULL,createdAt TEXT NOT NULL,
    PRIMARY KEY(brokerageId,id),FOREIGN KEY(brokerageId,versionId) REFERENCES compliance_learning_versions(brokerageId,id));
    CREATE INDEX IF NOT EXISTS compliance_learning_employee ON compliance_learning_assignments(brokerageId,employeeEmail,accessRevision);
    CREATE TABLE IF NOT EXISTS compliance_learning_events (
    brokerageId TEXT NOT NULL,requestId TEXT NOT NULL,versionId TEXT NOT NULL,assignmentId TEXT,
    actor TEXT NOT NULL,actorRevision INTEGER NOT NULL,operation TEXT NOT NULL,at TEXT NOT NULL,request TEXT NOT NULL,response TEXT NOT NULL,
    PRIMARY KEY(brokerageId,requestId));
    CREATE INDEX IF NOT EXISTS compliance_learning_version_events ON compliance_learning_events(brokerageId,versionId,operation);
    CREATE INDEX IF NOT EXISTS compliance_learning_assignment_events ON compliance_learning_events(brokerageId,assignmentId,operation);`);
}

/** Caller supplies current tenant roster and authenticated staff and runs this inside its transaction.
 * No external effects, seed content, filing, CE credit, or launch approval. */
export function complianceLearningWork(db: Store, input: unknown, staff: WorkspaceStaff,
  roster: readonly VersionedBrokerageMember[], now: string) {
  const parsed = learningRequest.safeParse(input);
  const actor = roster.find(m => m.email === staff.email && m.status === "Active");
  if (!parsed.success || !actor || actor.role !== staff.brokerage.role ||
    (actor.accessRevision ?? 0) !== (staff.brokerage.accessRevision ?? 0)) return unavailable;
  const data = parsed.data, tenant = staff.brokerage.id, admin = actor.role === "Admin";
  const getVersion = (id: string) => db.prepare(`SELECT ${versionColumns} FROM compliance_learning_versions WHERE brokerageId=? AND id=?`)
    .get(tenant, id) as Version | undefined;
  const getAssignment = (id: string) => db.prepare(`SELECT ${assignmentColumns} FROM compliance_learning_assignments WHERE brokerageId=? AND id=?`)
    .get(tenant, id) as Assignment | undefined;
  const has = (versionId: string, operation: string, assignmentId: string | null = null) => Boolean(db.prepare(`SELECT 1 FROM compliance_learning_events
    WHERE brokerageId=? AND versionId=? AND operation=? AND assignmentId IS ? LIMIT 1`).get(tenant, versionId, operation, assignmentId));
  const active = (a: Assignment) => roster.some(m => m.email === a.employeeEmail && m.status === "Active" &&
    (m.accessRevision ?? 0) === a.accessRevision) && !has(a.versionId, "revokeAssignment", a.id);
  const mayRead = (a: Assignment) => admin || (a.employeeEmail === staff.email && active(a));
  const state = (v: Version) => has(v.id, "publish") ? "Internally published" : has(v.id, "review") ? "Owner reviewed" : "Draft";
  function project(v: Version) {
    const questions: Questions = JSON.parse(v.questions);
    return { ...v, questions: admin ? questions : questions.map(({ prompt, options }) => ({ prompt, options })),
      state: state(v), disclaimer: learningDisclaimer };
  }
  function detail(a: Assignment) {
    const v = getVersion(a.versionId)!;
    const history = db.prepare(`SELECT operation,actor,at,response FROM compliance_learning_events
      WHERE brokerageId=? AND assignmentId=? ORDER BY rowid DESC LIMIT 51`).all(tenant, a.id);
    const completed = db.prepare(`SELECT response FROM compliance_learning_events WHERE brokerageId=? AND assignmentId=?
      AND json_extract(response,'$.completed')=1 ORDER BY rowid LIMIT 1`).get(tenant, a.id);
    return { kind: "learningAssignment", assignment: { ...a, active: active(a) }, version: project(v),
      completion: completed ? JSON.parse(String(completed.response)) : null,
      history: history.slice(0, 50).map(e => ({ operation: e.operation, actor: e.actor, at: e.at, evidence: JSON.parse(String(e.response)) })),
      moreHistory: history.length > 50 };
  }
  if (data.operation === "list" || data.operation === "myAssignments") {
    if (admin && data.operation === "list") {
      const rows = db.prepare(`SELECT rowid AS sequence,${versionColumns} FROM compliance_learning_versions
        WHERE brokerageId=? AND rowid>? ORDER BY rowid LIMIT 26`).all(tenant, data.after ?? 0);
      return { kind: "learningLibrary", items: rows.slice(0, 25).map(r => ({ id: r.id, contentId: r.contentId,
        title: r.title, kind: r.kind, state: state(r as unknown as Version), createdAt: r.createdAt })),
        next: rows.length > 25 ? Number(rows[24].sequence) : null, disclaimer: learningDisclaimer };
    }
    const rows = db.prepare(`SELECT a.rowid AS sequence,a.* FROM compliance_learning_assignments a
      WHERE a.brokerageId=? AND a.employeeEmail=? AND a.accessRevision=? AND a.rowid>?
      AND NOT EXISTS(SELECT 1 FROM compliance_learning_events e WHERE e.brokerageId=a.brokerageId AND e.assignmentId=a.id AND e.operation='revokeAssignment')
      ORDER BY a.rowid LIMIT 26`).all(tenant, staff.email, actor.accessRevision ?? 0, data.after ?? 0);
    return { kind: "learningAssignments", items: rows.slice(0, 25).map(r => ({ id: r.id, versionId: r.versionId, dueAt: r.dueAt })),
      next: rows.length > 25 ? Number(rows[24].sequence) : null, disclaimer: learningDisclaimer };
  }
  if (data.operation === "readVersion") {
    const v = admin ? getVersion(data.versionId) : undefined;
    if (!v) return unavailable;
    const events = db.prepare(`SELECT operation,actor,at,json_extract(request,'$.note') AS note,
      json_extract(request,'$.lawyerReviewReference') AS lawyerReviewReference FROM compliance_learning_events
      WHERE brokerageId=? AND versionId=? AND assignmentId IS NULL ORDER BY rowid DESC LIMIT 51`).all(tenant, v.id);
    return { kind: "learningVersion", version: project(v), history: events.slice(0, 50), moreHistory: events.length > 50 };
  }
  if (data.operation === "listAssignments") {
    if (!admin || !getVersion(data.versionId)) return unavailable;
    const rows = db.prepare(`SELECT rowid AS sequence,${assignmentColumns} FROM compliance_learning_assignments
      WHERE brokerageId=? AND versionId=? AND rowid>? ORDER BY rowid LIMIT 26`).all(tenant, data.versionId, data.after ?? 0);
    return { kind: "learningAssignments", items: rows.slice(0, 25).map(r => ({ ...r, active: active(r as unknown as Assignment),
      completed: Boolean(db.prepare(`SELECT 1 FROM compliance_learning_events WHERE brokerageId=? AND assignmentId=?
        AND json_extract(response,'$.completed')=1 LIMIT 1`).get(tenant, String(r.id))) })),
      next: rows.length > 25 ? Number(rows[24].sequence) : null, disclaimer: learningDisclaimer };
  }
  const a = "assignmentId" in data ? getAssignment(data.assignmentId) : undefined;
  if ("assignmentId" in data && (!a || !mayRead(a))) return unavailable;
  if (data.operation === "readAssignment") return detail(a!);
  const employeeAction = data.operation === "acknowledge" || data.operation === "attempt";
  if (!admin && !employeeAction) return unavailable;
  if (employeeAction && (!a || a.employeeEmail !== staff.email || !active(a) || a.versionId !== data.versionId)) return unavailable;
  const requestId = data.requestId;
  const replay = db.prepare("SELECT actor,actorRevision,request,response FROM compliance_learning_events WHERE brokerageId=? AND requestId=?")
    .get(tenant, requestId);
  if (replay) return replay.actor === staff.email && replay.actorRevision === (actor.accessRevision ?? 0) && replay.request === JSON.stringify(data)
    ? JSON.parse(String(replay.response)) : changed;
  function save(versionId: string, assignmentId: string | null, response: Record<string, unknown>) {
    const result = { ...response, disclaimer: learningDisclaimer };
    db.prepare("INSERT INTO compliance_learning_events VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run(tenant, requestId, versionId, assignmentId, staff.email, actor!.accessRevision ?? 0, data.operation, now, JSON.stringify(data), JSON.stringify(result));
    return result;
  }
  if (data.operation === "createVersion") {
    if ((data.kind === "Policy" && data.questions.length !== 0) || (data.kind === "Course" && !data.questions.length))
      return { error: "Policies require no assessment; courses require at least one question." };
    const head = db.prepare("SELECT id,kind FROM compliance_learning_versions WHERE brokerageId=? AND contentId=? ORDER BY rowid DESC LIMIT 1")
      .get(tenant, data.contentId);
    if ((head?.id ?? null) !== data.previousVersionId || (head && head.kind !== data.kind)) return changed;
    const id = randomUUID(), digest = createHash("sha256").update(JSON.stringify({ kind: data.kind, title: data.title,
      body: data.body, sourceReferences: data.sourceReferences, questions: data.questions, passPercent: data.passPercent })).digest("hex");
    db.prepare("INSERT INTO compliance_learning_versions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").run(tenant, id, data.contentId,
      data.previousVersionId, data.kind, data.title, data.body, data.sourceReferences, JSON.stringify(data.questions), data.passPercent, digest, staff.email, now);
    return save(id, null, { kind: "learningMutation", versionId: id, state: "Draft" });
  }
  const v = getVersion("versionId" in data ? data.versionId : a!.versionId);
  if (!v) return unavailable;
  if (data.operation === "review") {
    if (state(v) !== "Draft") return changed;
    return save(v.id, null, { kind: "learningMutation", versionId: v.id, state: "Owner reviewed" });
  }
  if (data.operation === "publish") {
    if (state(v) !== "Owner reviewed") return changed;
    return save(v.id, null, { kind: "learningMutation", versionId: v.id, state: "Internally published" });
  }
  if (data.operation === "assign") {
    if (state(v) !== "Internally published") return changed;
    const employee = roster.find(m => m.email === data.employeeEmail && m.status === "Active");
    if (!employee) return unavailable;
    const existing = db.prepare(`SELECT a.id FROM compliance_learning_assignments a WHERE a.brokerageId=? AND a.versionId=? AND a.employeeEmail=? AND a.accessRevision=?
      AND NOT EXISTS(SELECT 1 FROM compliance_learning_events e WHERE e.brokerageId=a.brokerageId AND e.assignmentId=a.id AND e.operation='revokeAssignment') LIMIT 1`)
      .get(tenant, v.id, employee.email, employee.accessRevision ?? 0);
    if (existing) return { error: "This version is already assigned to this employee." };
    const id = randomUUID();
    db.prepare("INSERT INTO compliance_learning_assignments VALUES (?,?,?,?,?,?,?)")
      .run(tenant, id, v.id, employee.email, employee.accessRevision ?? 0, data.dueAt, now);
    return save(v.id, id, { kind: "learningMutation", versionId: v.id, assignmentId: id });
  }
  if (data.operation === "revokeAssignment") {
    if (has(v.id, "revokeAssignment", a!.id)) return changed;
    return save(v.id, a!.id, { kind: "learningMutation", assignmentId: a!.id, state: "Revoked" });
  }
  if (db.prepare(`SELECT 1 FROM compliance_learning_events WHERE brokerageId=? AND assignmentId=? AND json_extract(response,'$.completed')=1 LIMIT 1`).get(tenant, a!.id)) return changed;
  if (data.operation === "acknowledge") {
    if (v.kind !== "Policy") return unavailable;
    return save(v.id, a!.id, { kind: "learningEvidence", assignmentId: a!.id, versionId: v.id, digest: v.digest,
      completed: true, completionType: "Policy acknowledgment", actor: staff.email, at: now });
  }
  if (data.operation === "attempt") {
    if (v.kind !== "Course") return unavailable;
    const questions: Questions = JSON.parse(v.questions);
    if (questions.length !== data.answers.length || questions.some((q, i) => data.answers[i] >= q.options.length)) return unavailable;
    const count = Number(db.prepare("SELECT count(*) n FROM compliance_learning_events WHERE brokerageId=? AND assignmentId=? AND operation='attempt'").get(tenant, a!.id)!.n);
    if (count >= 20) return { error: "Assessment attempt limit reached. Contact the content owner for remediation." };
    const score = questions.reduce((n, q, i) => n + Number(q.correctIndex === data.answers[i]), 0);
    const completed = score * 100 >= v.passPercent * questions.length;
    return save(v.id, a!.id, { kind: "learningEvidence", assignmentId: a!.id, versionId: v.id, digest: v.digest,
      completed, completionType: completed ? "Internal course completion" : "Remediation required", actor: staff.email, at: now,
      correct: score, total: questions.length, attempt: count + 1 });
  }
  return unavailable;
}
