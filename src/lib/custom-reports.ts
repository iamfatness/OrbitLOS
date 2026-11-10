import { easternDayStart } from "./client-retention";
import { callReportCsvCell } from "./call-report-model";
import { canSeeCrmField, crmFieldValueTable, resolveCrmFieldFilter } from "./crm-fields";
import { customReportDefinition, customReportExportLimit, customReportInput, customReportLimit, customReportMetricLabels, customReportRange, customReportUnavailable,
  type CustomReport, type CustomReportCounts, type CustomReportInput, type CustomReportMetric, type CustomReportRecord,
  type CustomReportResult } from "./custom-report-model";
import { shiftReportDate, type ReportDateRange } from "./report-date-range";
import type { WorkspaceStaff } from "./staff-store";
import type { SqlValue, Store } from "./store";
import { accessEvent } from "./workspace-access";

type SavedRow = { id: string; revision: number; definition: string; archivedAt: string | null };
type ReportRow = Record<string, SqlValue>;
type RunRequest = Extract<CustomReportInput, { type: "run" }>;
type RecordsRequest = Extract<CustomReportInput, { type: "records" }>;
type ExportRequest = Extract<CustomReportInput, { type: "export" }>;
const pageSize = 20;

function definition(row: SavedRow): CustomReport {
  return { ...customReportDefinition.parse(JSON.parse(row.definition)), id: row.id, revision: row.revision };
}

function visibleReport(db: Store, report: CustomReport, staff: WorkspaceStaff) {
  const { role } = staff.brokerage;
  if (role === "Admin") return true;
  if (!report.roles.includes(role)) return false;
  if (!report.customFilter) return true;
  const filter = resolveCrmFieldFilter(db, report.customFilter);
  return Boolean(filter && canSeeCrmField(filter.field, role));
}

function changeReport(db: Store, input: Extract<CustomReportInput, { type: "save" | "archive" }>, staff: WorkspaceStaff,
  now: string): CustomReportResult {
  if (staff.brokerage.role !== "Admin") return { error: customReportUnavailable };
  return db.transaction(() => {
    const row = db.prepare("SELECT id, revision, definition, archivedAt FROM custom_reports WHERE id = ?").get(input.id) as SavedRow | undefined;
    const changed = { error: "This report changed. Reload saved reports before editing." };
    if (input.type === "archive") {
      if (row?.archivedAt && row.revision === input.revision + 1) return { kind: "archived" };
      if (!row || row.archivedAt || row.revision !== input.revision) return changed;
      db.prepare("UPDATE custom_reports SET archivedAt = ?, revision = revision + 1 WHERE id = ?").run(now, input.id);
      accessEvent(db, staff, "Archived custom report", input.id, now);
      return { kind: "archived" };
    }
    const { customFilter, ...base } = input.definition;
    const filter = customFilter ? resolveCrmFieldFilter(db, customFilter) : null;
    if (customFilter && !filter) return { error: "Choose an available CRM field and a valid filter value." };
    if (filter && !base.roles.every((role) => canSeeCrmField(filter.field, role))) {
      return { error: "Share the CRM field with every role that can run this report, or change who can run it." };
    }
    const config = filter ? { ...base, customFilter: { fieldId: filter.field.id, value: filter.value } } : base;
    const serialized = JSON.stringify(config);
    if (row && !row.archivedAt && row.definition === serialized) return { kind: "saved", report: definition(row) };
    if (row?.archivedAt || (row?.revision ?? 0) !== input.revision) return changed;
    const duplicate = db.prepare("SELECT 1 FROM custom_reports WHERE name = ? COLLATE NOCASE AND archivedAt IS NULL AND id <> ?")
      .get(input.definition.name, input.id);
    if (duplicate) return { error: "Use a different name for this report." };
    if (!row && Number(db.prepare("SELECT count(*) AS count FROM custom_reports WHERE archivedAt IS NULL").get()?.count) >= customReportLimit) {
      return { error: "Archive a saved report before adding another." };
    }
    const revision = input.revision + 1;
    db.prepare(`INSERT INTO custom_reports (id, name, revision, definition) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, revision = excluded.revision, definition = excluded.definition`)
      .run(input.id, input.definition.name, revision, serialized);
    accessEvent(db, staff, row ? "Updated custom report" : "Created custom report", input.id, now);
    return { kind: "saved", report: { ...config, id: input.id, revision } };
  });
}

const reportSource = "coalesce(nullif(loan.leadSource, ''), CASE WHEN loan.partnerId IS NULL THEN 'Direct' ELSE 'Realtor referral' END)";
const firstSubmission = "coalesce((SELECT min(submittedAt) FROM application_versions WHERE loanId = loan.id), app.submittedAt)";
const loanEvents = {
  files: { at: "strftime('%Y-%m-%dT%H:%M:%fZ', coalesce(loan.createdAt, loan.stageSince))", source: "FROM loans loan" },
  applications: { at: firstSubmission, source: "FROM applications app JOIN loans loan ON loan.id = app.loanId" },
  funding: { at: "funded.fundingDate", source: "FROM closing_progress funded JOIN loans loan ON loan.id = funded.loanId" },
} as const;
const groups = {
  "None": { key: "'all'", name: "'All records'" },
  "Lead source": { key: "source", name: "source" },
  "Campaign": { key: "coalesce(campaignId, 'no-campaign')", name: "coalesce(campaignName, 'No campaign')" },
  "Loan officer": { key: "CASE WHEN ownerEmail IS NULL THEN 'name:' || coalesce(owner, '') ELSE 'email:' || ownerEmail END",
    name: "coalesce(nullif(owner, ''), 'Unassigned')" },
  "Purpose": { key: "purpose", name: "purpose" },
  "Current stage": { key: "status", name: "status" },
} as const;
const columnSql = {
  "Lead source": "source", "Loan officer": "coalesce(nullif(owner, ''), 'Unassigned')", "Purpose": "purpose",
  "Current status": "status", "Loan amount": "amount",
} as const;

function eventRows(report: CustomReport, staff: WorkspaceStaff, range: ReportDateRange) {
  const { role } = staff.brokerage;
  const first = easternDayStart(range.from);
  const last = easternDayStart(shiftReportDate(range.through, 1));
  if (report.dataset === "Intake cohort") {
    const source = "coalesce(nullif(lead.importSource, ''), CASE WHEN lead.realtorId IS NULL THEN 'Website quote request' ELSE 'Realtor referral' END)";
    const owner = "CASE WHEN loan.id IS NULL THEN lead.officerEmail ELSE loan.officerEmail END";
    const needsSubmission = report.metrics.includes("converted");
    const needsFunding = report.metrics.includes("cohortFunded");
    const inputs = `intake AS (
      SELECT lead.id, lead.id AS fieldRecordId, lead.createdAt AS at, coalesce(borrower.name, lead.name) AS name,
        CASE WHEN loan.id IS NULL THEN 'lead' ELSE 'loan' END AS targetKind,
        coalesce(loan.id, lead.id) AS targetId, ${owner} AS ownerEmail, coalesce(loan.officer, lead.officer) AS owner,
        ${source} AS source, coalesce(loan.purpose, lead.purpose) AS purpose, loan.amount AS amount,
        coalesce(loan.stage, CASE WHEN lead.heldAt IS NULL THEN 'Open lead' ELSE 'On hold' END) AS status,
        member.campaignId, campaign.name AS campaignName,
        ${needsSubmission ? firstSubmission : "NULL"} AS submittedAt, ${needsFunding ? "funded.fundingDate" : "NULL"} AS fundedAt
      FROM referral_leads lead LEFT JOIN loans loan ON loan.id = lead.loanId
      LEFT JOIN contacts borrower ON borrower.id = loan.contactId
      LEFT JOIN call_campaign_members member ON member.leadId = lead.id
      LEFT JOIN call_campaigns campaign ON campaign.id = member.campaignId
      ${needsSubmission ? "LEFT JOIN applications app ON app.loanId = loan.id" : ""}
      ${needsFunding ? "LEFT JOIN closing_progress funded ON funded.loanId = loan.id" : ""}
      WHERE lead.createdAt >= ? AND lead.createdAt < ? AND (lead.resolvedAt IS NULL OR loan.id IS NOT NULL)
      ${role === "LO" ? `AND (${owner}) = ?` : ""}
    ),`;
    const condition = { inquiries: "", converted: "WHERE submittedAt IS NOT NULL", cohortFunded: "WHERE fundedAt IS NOT NULL" } as const;
    const sql = report.metrics.map((metric) => `SELECT *, '${metric}' AS metric FROM intake ${condition[metric as keyof typeof condition]}`).join(" UNION ALL ");
    return { inputs, sql, params: [first, last, ...(role === "LO" ? [staff.email] : [])] };
  }

  const ownership = role === "LO" ? "AND loan.officerEmail = ?" : role === "Processor"
    ? "AND EXISTS (SELECT 1 FROM loan_processing work WHERE work.loanId = loan.id AND work.processorEmail = ?)" : "";
  const params: SqlValue[] = [];
  const sql = report.metrics.map((metric) => {
    const event = loanEvents[metric as keyof typeof loanEvents];
    params.push(...(metric === "funding" ? [range.from, shiftReportDate(range.through, 1)] : [first, last]), ...(ownership ? [staff.email] : []));
    return `SELECT loan.id, borrower.id AS fieldRecordId, ${event.at} AS at, borrower.name, 'loan' AS targetKind, loan.id AS targetId, loan.officerEmail AS ownerEmail,
      loan.officer AS owner, ${reportSource} AS source, loan.purpose, loan.amount, loan.stage AS status,
      NULL AS campaignId, NULL AS campaignName, '${metric}' AS metric
      ${event.source} JOIN contacts borrower ON borrower.id = loan.contactId
      WHERE ${event.at} >= ? AND ${event.at} < ? ${ownership}`;
  }).join(" UNION ALL ");
  return { inputs: "", sql, params };
}

function cohort(report: CustomReport, staff: WorkspaceStaff, range: ReportDateRange) {
  const events = eventRows(report, staff, range);
  const { key, name } = groups[report.groupBy];
  const { customFilter } = report;
  const table = crmFieldValueTable[report.dataset === "Intake cohort" ? "lead" : "contact"];
  return {
    sql: `WITH ${events.inputs} events AS (${events.sql}), report AS (
      SELECT *, ${key} AS groupKey, ${name} AS groupName FROM events WHERE 1 = 1
      ${report.source ? "AND source = ?" : ""} ${report.purpose ? "AND purpose = ?" : ""}
      ${customFilter ? `AND EXISTS (SELECT 1 FROM ${table} fieldValue
        WHERE fieldValue.recordId = events.fieldRecordId AND fieldValue.fieldId = ? AND fieldValue.value = ?)` : ""}
    )`,
    params: [...events.params, ...(report.source ? [report.source] : []), ...(report.purpose ? [report.purpose] : []),
      ...(customFilter ? [customFilter.fieldId, customFilter.value] : [])],
  };
}

function counts(metrics: CustomReportMetric[], row?: ReportRow): CustomReportCounts {
  return Object.fromEntries(metrics.map((metric) => [metric, Number(row?.[metric] ?? 0)]));
}

function runReport(db: Store, input: RunRequest, report: CustomReport, staff: WorkspaceStaff, range: ReportDateRange): CustomReportResult {
  const source = cohort(report, staff, range);
  const columns = report.metrics.map((metric) => `sum(metric = '${metric}') AS ${metric}`).join(", ");
  const after = input.after;
  if (report.groupBy === "None") {
    const totals = db.prepare(`${source.sql} SELECT ${columns} FROM report`).get(...source.params);
    return { kind: "run", ...range, totals: counts(report.metrics, totals), groups: [], next: null };
  }
  const rows = db.prepare(`${source.sql}, grouped AS (
    SELECT groupKey, min(groupName) AS groupName, ${columns} FROM report GROUP BY groupKey
  )
  SELECT NULL AS groupKey, NULL AS groupName, ${report.metrics.map((metric) => `sum(${metric}) AS ${metric}`).join(", ")} FROM grouped
  UNION ALL SELECT * FROM (
    SELECT * FROM grouped ${after ? "WHERE (groupName COLLATE NOCASE, groupKey) > (?, ?)" : ""}
    ORDER BY groupName COLLATE NOCASE, groupKey LIMIT ?
  )`).all(...source.params, ...(after ? [after.name, after.key] : []), pageSize + 1);
  const [overall, ...groupRows] = rows;
  const page = groupRows.slice(0, pageSize).map((row) => ({ key: String(row.groupKey), name: String(row.groupName), counts: counts(report.metrics, row) }));
  const last = page.at(-1);
  return { kind: "run", ...range, totals: counts(report.metrics, overall), groups: page,
    next: groupRows.length > pageSize && last ? { key: last.key, name: last.name } : null };
}

function recordRows(db: Store, input: { metric?: CustomReportMetric; group?: string; after?: RecordsRequest["after"] },
  report: CustomReport, staff: WorkspaceStaff, range: ReportDateRange, limit: number) {
  const { metric, group, after } = input;
  const source = cohort(metric ? { ...report, metrics: [metric] } : report, staff, range);
  const columns = report.columns.map((column, index) => `${columnSql[column]} AS value${index}`).join(", ");
  return db.prepare(`${source.sql} SELECT id, at, name, targetKind, targetId, metric, groupName
    ${columns ? `, ${columns}` : ""} FROM report
    WHERE 1 = 1 ${group ? "AND groupKey = ?" : ""} ${after ? "AND (at, id) < (?, ?)" : ""}
    ORDER BY at DESC, id DESC, metric LIMIT ?`).all(...source.params, ...(group ? [group] : []), ...(after ? [after.at, after.id] : []), limit);
}

function reportRecords(db: Store, input: RecordsRequest, report: CustomReport, staff: WorkspaceStaff, range: ReportDateRange): CustomReportResult {
  const rows = recordRows(db, input, report, staff, range, pageSize + 1);
  const page = rows.slice(0, pageSize).map((row): CustomReportRecord => ({
    id: String(row.id), at: String(row.at), name: String(row.name),
    destination: { kind: row.targetKind === "lead" ? "lead" : "loan", id: String(row.targetId) },
    values: Object.fromEntries(report.columns.map((column, index) => [column, row[`value${index}`]])),
  }));
  const last = page.at(-1);
  return { kind: "records", rows: page, next: rows.length > pageSize && last ? { id: last.id, at: last.at } : null };
}

function exportReport(db: Store, input: ExportRequest, report: CustomReport, staff: WorkspaceStaff, range: ReportDateRange,
  now: string): CustomReportResult {
  if (input.from !== range.from || input.through !== range.through) {
    return { error: "The report dates rolled over. Run the report again before exporting." };
  }
  return db.transaction(() => {
    const rows = recordRows(db, input, report, staff, range, customReportExportLimit + 1);
    if (rows.length > customReportExportLimit) {
      return { error: "This export has more than 2,000 report rows. Download a single count or narrow the saved report’s filters." };
    }
    const grouped = report.groupBy !== "None";
    const header = ["Metric", ...(grouped ? [`Group (${report.groupBy})`] : []), "Event date", "Name", "Record type", "Record ID", ...report.columns];
    const lines = rows.map((row) => [
      customReportMetricLabels[row.metric as CustomReportMetric], ...(grouped ? [row.groupName] : []),
      row.at, row.name, row.targetKind, row.targetId, ...report.columns.map((_, index) => row[`value${index}`]),
    ].map(callReportCsvCell).join(","));
    const csv = "\uFEFF" + [header.map(callReportCsvCell).join(","), ...lines].join("\r\n") + "\r\n";
    if (new TextEncoder().encode(csv).length > 2_000_000) return { error: "This export is too large. Narrow the saved report’s filters." };
    const slug = report.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "report";
    const filename = `orbit-${slug}${input.metric ? `-${input.metric}` : ""}-v${report.revision}-${range.from}-${range.through}.csv`;
    accessEvent(db, staff, "Prepared custom report CSV", `${report.id} · v${report.revision} · ${range.from} to ${range.through} · ${rows.length} rows`, now);
    return { kind: "export", csv, filename, count: rows.length };
  });
}

export function customReportWork(db: Store, input: unknown, staff: WorkspaceStaff | null, brokerageId: string, now = new Date()): CustomReportResult {
  if (!staff || staff.brokerage.id !== brokerageId) return { error: customReportUnavailable };
  const parsed = customReportInput.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the custom report settings." };
  const request = parsed.data;
  if (request.type === "save" || request.type === "archive") return changeReport(db, request, staff, now.toISOString());
  if (request.type === "list") {
    const rows = db.prepare("SELECT id, revision, definition FROM custom_reports WHERE archivedAt IS NULL ORDER BY name COLLATE NOCASE, id LIMIT ?")
      .all(customReportLimit) as unknown as SavedRow[];
    return { kind: "list", reports: rows.map(definition).filter((report) => visibleReport(db, report, staff)) };
  }
  const row = db.prepare("SELECT id, revision, definition FROM custom_reports WHERE id = ? AND archivedAt IS NULL").get(request.id) as SavedRow | undefined;
  if (!row) return { error: customReportUnavailable };
  const report = definition(row);
  if (!visibleReport(db, report, staff)) return { error: customReportUnavailable };
  if (report.customFilter && !resolveCrmFieldFilter(db, report.customFilter)) {
    return { error: "This report’s CRM field is unavailable. Update the saved filter before running it." };
  }
  if (request.revision !== report.revision) return { error: "This report changed. Reload the saved report before running it." };
  const range = customReportRange(report.period, now);
  if (request.type === "run") return runReport(db, request, report, staff, range);
  if ((request.metric && !report.metrics.includes(request.metric)) || (request.group && (!request.metric || report.groupBy === "None"))) {
    return { error: customReportUnavailable };
  }
  return request.type === "records" ? reportRecords(db, request, report, staff, range) : exportReport(db, request, report, staff, range, now.toISOString());
}
