import { demoBrokerageId } from "./brokerage-model";
import { defaultDisclosureCalendar, disclosureCalendarInput, disclosureCalendarRules, disclosureCalendarUnavailable, disclosureSigningDeadline,
  storedDisclosureCalendarBasis, type DisclosureCalendarBasis, type DisclosureCalendarInput, type DisclosureCalendarResult,
  type DisclosureCalendarRules, type DisclosureCalendarVersion } from "./disclosure-calendar-model";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";
import { accessEvent } from "./workspace-access";

const previewLimit = 40;
const defaultVersion: DisclosureCalendarVersion = {
  version: 0, rules: defaultDisclosureCalendar, publishedAt: null, publishedBy: null, note: "Orbit default.",
};
type StoredVersion = Omit<DisclosureCalendarVersion, "rules"> & { rules: string };
const columns = "version, rules, publishedAt, publishedBy, note";

function readVersion(row: StoredVersion) {
  return { ...row, rules: disclosureCalendarRules.parse(JSON.parse(row.rules)) };
}

export function currentDisclosureCalendar(db: Store): DisclosureCalendarVersion {
  const row = db.prepare(`SELECT ${columns} FROM disclosure_calendar_versions ORDER BY version DESC LIMIT 1`).get() as StoredVersion | undefined;
  return row ? readVersion(row) : defaultVersion;
}

function settings(db: Store): DisclosureCalendarResult {
  const history = db.prepare(`SELECT ${columns} FROM disclosure_calendar_versions ORDER BY version DESC LIMIT 8`).all() as unknown as StoredVersion[];
  const versions = history.map(readVersion);
  return { kind: "settings", current: versions[0] ?? defaultVersion, history: versions };
}

export function changedDisclosureTarget(basis: DisclosureCalendarBasis | null, signBy: string, current: DisclosureCalendarVersion) {
  if (!basis || basis.version === current.version) return null;
  const calculated = disclosureSigningDeadline(current.rules, { version: current.version, anchorOn: basis.anchorOn });
  return calculated.signBy === signBy ? null : { version: current.version, signBy: calculated.signBy };
}

function preview(db: Store, data: Extract<DisclosureCalendarInput, { type: "preview" }>, current: DisclosureCalendarVersion): DisclosureCalendarResult {
  const { rules, anchorOn, after } = data;
  const before = disclosureSigningDeadline(current.rules, { version: current.version, anchorOn });
  const proposed = disclosureSigningDeadline(rules, { version: current.version + 1, anchorOn });
  const rows = db.prepare(`SELECT package.loanId, borrower.name AS borrower, package.version, package.issuedAt, package.signBy, package.deadlineBasis
    FROM disclosure_packages package JOIN loans loan ON loan.id = package.loanId JOIN contacts borrower ON borrower.id = loan.contactId
    WHERE package.supersededAt IS NULL AND package.reviewReason IS NULL AND package.deadlineBasis IS NOT NULL
      AND loan.disposition = 'Active' AND loan.stage NOT IN ('Funded', 'Closed')
      AND (package.issuedAt IS NULL OR (
        EXISTS (SELECT 1 FROM json_each(package.signers) WHERE json_extract(value, '$.status') = 'Pending')
        AND NOT EXISTS (SELECT 1 FROM json_each(package.signers) WHERE json_extract(value, '$.status') = 'Declined')
      ))
      ${after ? "AND (package.signBy, package.loanId) > (?, ?)" : ""}
    ORDER BY package.signBy, package.loanId LIMIT ?`).all(...(after ? [after.signBy, after.loanId] : []), previewLimit + 1) as unknown as
    { loanId: string; borrower: string; version: number; issuedAt: string | null; signBy: string; deadlineBasis: string }[];
  const page = rows.slice(0, previewLimit);
  const affected = page.flatMap(({ loanId, borrower, version, issuedAt, signBy, deadlineBasis }) => {
    const basis = storedDisclosureCalendarBasis(deadlineBasis);
    const changed = changedDisclosureTarget(basis, signBy, { ...current, version: proposed.version, rules });
    if (!basis || !changed) return [];
    return [{ loanId, borrower, version, state: issuedAt ? "Issued" as const : "Draft" as const,
      from: signBy, to: changed.signBy, calendarVersion: basis.version }];
  });
  const last = page.at(-1);
  return { kind: "preview", before, after: proposed, affected, checked: page.length,
    next: last && rows.length > previewLimit ? { signBy: last.signBy, loanId: last.loanId } : null };
}

function normalized(rules: DisclosureCalendarRules): DisclosureCalendarRules {
  return { ...rules, holidays: rules.holidays.toSorted((a, b) => a.on.localeCompare(b.on)) };
}

export function disclosureCalendarWork(db: Store, input: unknown, staff: WorkspaceStaff | null, brokerageId: string,
  now = new Date().toISOString()): DisclosureCalendarResult {
  if (!staff || staff.brokerage.id !== brokerageId || staff.brokerage.role !== "Admin" ||
    (brokerageId !== demoBrokerageId && !staff.brokerage.pilot)) return { error: disclosureCalendarUnavailable };
  const parsed = disclosureCalendarInput.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the deadline calendar." };
  const data = parsed.data;
  if (data.type === "read") return settings(db);
  return db.transaction(() => {
    const current = currentDisclosureCalendar(db);
    const rules = JSON.stringify(normalized(data.rules));
    if (data.type === "publish" && JSON.stringify(current.rules) === rules &&
      (data.version === current.version || (data.version + 1 === current.version && data.note === current.note))) return settings(db);
    if (data.version !== current.version) return { error: "The deadline calendar changed. Reload the current version before continuing." };
    if (data.type === "preview") return preview(db, data, current);
    const next = current.version + 1;
    db.prepare("INSERT INTO disclosure_calendar_versions (version, rules, publishedAt, publishedBy, note) VALUES (?, ?, ?, ?, ?)")
      .run(next, rules, now, staff.name, data.note);
    accessEvent(db, staff, "Published disclosure deadline calendar", `Calendar v${next}`, now);
    return settings(db);
  });
}
