import { easternDayStart } from "./client-retention";
import { priorReportPeriod, shiftReportDate, type ReportDateRange } from "./report-date-range";
import { salesDashboardFilters, salesDashboardQuery, salesDashboardUnavailable, salesMetrics, salesPeriods, salesSettingRequest,
  type SalesDashboardResult, type SalesFilters, type SalesQuery, type SalesRecord, type SalesTarget, type SalesTotals } from "./sales-dashboard-model";
import { changeDashboardView, readDashboardViews } from "./dashboard-views";
import { accessEvent } from "./workspace-access";
import type { WorkspaceStaff } from "./staff-store";
import type { SqlValue, Store } from "./store";

const pageSize = 20;
const dimensions = {
  Campaigns: {
    source: "call_campaign_members member JOIN referral_leads lead ON lead.id = member.leadId",
    label: "JOIN call_campaigns source ON source.id = member.campaignId",
    at: "member.joinedAt", eligible: "", outreach: "member.attempts > 0",
    windowOutreach: "member.firstCallAt >= member.joinedAt AND member.firstCallAt < json_extract(day.value, '$.maturesAt')",
  },
  Realtors: {
    source: "referral_leads lead",
    label: "JOIN contacts source ON source.id = lead.realtorId",
    at: "lead.createdAt", eligible: "AND lead.realtorId IS NOT NULL",
    outreach: `EXISTS (SELECT 1 FROM lead_follow_up follow WHERE follow.leadId = lead.id AND follow.firstContactAt >= lead.createdAt)
      OR EXISTS (SELECT 1 FROM activity event WHERE event.loanId = lead.loanId AND event.outcome IS NOT NULL AND event.createdAt >= lead.createdAt)`,
    windowOutreach: `EXISTS (SELECT 1 FROM lead_follow_up follow WHERE follow.leadId = lead.id AND follow.firstContactAt >= lead.createdAt
      AND follow.firstContactAt < json_extract(day.value, '$.maturesAt')) OR EXISTS (SELECT 1 FROM activity event
      WHERE event.loanId = lead.loanId AND event.outcome IS NOT NULL AND event.createdAt >= lead.createdAt
      AND event.createdAt < json_extract(day.value, '$.maturesAt'))`,
  },
} as const;

function observationDays(range: ReportDateRange, windowDays: number, now: Date) {
  const dates = [];
  const checkedAt = now.toISOString();
  for (let date = range.from; date <= range.through; date = shiftReportDate(date, 1)) {
    const endsOn = shiftReportDate(date, windowDays);
    const maturesAt = easternDayStart(endsOn);
    dates.push({ date, start: easternDayStart(date), next: easternDayStart(shiftReportDate(date, 1)),
      endsOn, maturesAt, mature: maturesAt <= checkedAt ? 1 : 0 });
  }
  return JSON.stringify(dates);
}

function cohortWindow(at: string, fixed: boolean) {
  return { from: fixed ? "json_each(?) day CROSS JOIN " : "",
    where: fixed ? `${at} >= json_extract(day.value, '$.start') AND ${at} < json_extract(day.value, '$.next')` : `${at} >= ? AND ${at} < ?`,
    fields: fixed ? `json_extract(day.value, '$.mature') AS mature, json_extract(day.value, '$.maturesAt') AS maturesAt,
      json_extract(day.value, '$.date') AS entryDay, json_extract(day.value, '$.endsOn') AS endsOn` :
      "1 AS mature, NULL AS maturesAt, NULL AS entryDay, NULL AS endsOn" };
}

function intakeCohort(fixed: boolean, params: string[], groupId?: string | null) {
  const leadDate = cohortWindow("lead.createdAt", fixed);
  const fileAt = "strftime('%Y-%m-%dT%H:%M:%fZ', coalesce(loan.createdAt, loan.stageSince))";
  const fileDate = cohortWindow(fileAt, fixed);
  const contactBeforeCutoff = (at: string) => fixed ? `AND ${at} < json_extract(day.value, '$.maturesAt')` : "";
  const loanOutreach = (at: string) => `EXISTS (SELECT 1 FROM activity event WHERE event.loanId = loan.id AND event.outcome IS NOT NULL
    AND event.createdAt >= ${at} ${contactBeforeCutoff("event.createdAt")})`;
  const leadOutreach = `EXISTS (SELECT 1 FROM lead_follow_up follow WHERE follow.leadId = lead.id
    AND follow.firstContactAt >= lead.createdAt ${contactBeforeCutoff("follow.firstContactAt")}) OR ${loanOutreach("lead.createdAt")}`;
  const leadSource = `CASE WHEN lead.importSource = 'Imported CRM' AND EXISTS (
      SELECT 1 FROM migration_records imported WHERE imported.targetId = lead.id
        AND imported.origin = 'call-' || member.campaignId AND imported.recordKey GLOB 'Lead:*'
        AND NOT EXISTS (SELECT 1 FROM migration_import_rows row JOIN migration_imports receipt ON receipt.id = row.importId
          WHERE row.targetId = lead.id AND receipt.origin = imported.origin)
    ) THEN 'Campaign import' ELSE coalesce(nullif(lead.importSource, ''),
      CASE WHEN lead.realtorId IS NULL THEN 'Website quote request' ELSE 'Realtor referral' END) END`;
  const ownerId = (email: string, name: string) => `CASE WHEN ${email} IS NOT NULL THEN 'email:' || (${email}) ELSE 'name:' || ${name} END`;
  const sql = `SELECT intake.*, groupId AS groupName FROM (
    SELECT lead.id, lead.name, lead.loanId, lead.createdAt AS at, ${leadSource} AS groupId,
      coalesce(loan.officer, lead.officer) AS officer, lead.resolvedAt IS NULL AS openLead,
      ${ownerId("(CASE WHEN loan.id IS NULL THEN lead.officerEmail ELSE loan.officerEmail END)", "coalesce(loan.officer, lead.officer)")} AS ownerId,
      (${leadOutreach}) AS outreach, ${leadDate.fields}
    FROM ${leadDate.from}referral_leads lead LEFT JOIN loans loan ON loan.id = lead.loanId
    LEFT JOIN call_campaign_members member ON member.leadId = lead.id WHERE ${leadDate.where}
    UNION ALL
    SELECT loan.id, contact.name, loan.id, ${fileAt}, coalesce(nullif(loan.leadSource, ''),
      CASE WHEN loan.partnerId IS NULL THEN 'Direct' ELSE 'Realtor referral' END),
      loan.officer, 0, ${ownerId("loan.officerEmail", "loan.officer")}, (${loanOutreach(fileAt)}), ${fileDate.fields}
    FROM ${fileDate.from}loans loan JOIN contacts contact ON contact.id = loan.contactId
    WHERE ${fileDate.where} AND NOT EXISTS (SELECT 1 FROM referral_leads lead WHERE lead.loanId = loan.id)
  ) intake ${groupId ? "WHERE groupId = ?" : ""}`;
  return { sql, params: [...params, ...params, ...(groupId ? [groupId] : [])] };
}

function cohort(filters: SalesFilters, range: ReportDateRange, now: Date, groupId?: string | null) {
  const fixed = Boolean(filters.windowDays);
  const params = fixed ? [observationDays(range, filters.windowDays, now)] :
    [easternDayStart(range.from), easternDayStart(shiftReportDate(range.through, 1))];
  if (filters.channel === "Lead sources") return intakeCohort(fixed, params, groupId);
  const dimension = dimensions[filters.channel];
  const window = cohortWindow(dimension.at, fixed);
  const sql = `SELECT lead.id, lead.name, lead.loanId, ${dimension.at} AS at, source.id AS groupId, source.name AS groupName,
    coalesce(loan.officer, lead.officer) AS officer, lead.resolvedAt IS NULL AS openLead,
    CASE WHEN (CASE WHEN loan.id IS NULL THEN lead.officerEmail ELSE loan.officerEmail END) IS NOT NULL
      THEN 'email:' || (CASE WHEN loan.id IS NULL THEN lead.officerEmail ELSE loan.officerEmail END)
      ELSE 'name:' || coalesce(loan.officer, lead.officer) END AS ownerId,
    (${fixed ? dimension.windowOutreach : dimension.outreach}) AS outreach,
    ${window.fields}
    FROM ${window.from}${dimension.source} ${dimension.label} LEFT JOIN loans loan ON loan.id = lead.loanId
    WHERE ${window.where} ${dimension.eligible} ${groupId ? "AND source.id = ?" : ""}`;
  if (groupId) params.push(groupId);
  return { sql, params };
}

function facts(cohortSql: string, filterOwner: boolean, fixed: boolean) {
  const submitted = fixed ? "CASE WHEN firstSubmitted >= at AND firstSubmitted < maturesAt THEN firstSubmitted END" : "firstSubmitted";
  const funded = fixed ? "CASE WHEN recordedFunding >= entryDay AND recordedFunding < endsOn THEN recordedFunding END" : "recordedFunding";
  const repeat = fixed ? "CASE WHEN fundingDate IS NOT NULL AND repeatCreatedAt >= at AND repeatCreatedAt < maturesAt THEN linkedRepeat END" : "linkedRepeat";
  return `WITH cohort AS (${cohortSql}), events AS (
    SELECT entry.*, coalesce((SELECT min(version.submittedAt) FROM application_versions version WHERE version.loanId = entry.loanId), app.submittedAt) AS firstSubmitted,
      funding.fundingDate AS recordedFunding, repeatApp.loanId AS linkedRepeat ${fixed ? ", repeatLoan.createdAt AS repeatCreatedAt" : ""}
    FROM cohort entry LEFT JOIN applications app ON app.loanId = entry.loanId
    LEFT JOIN closing_progress funding ON funding.loanId = entry.loanId
    LEFT JOIN returning_client_loans repeat ON repeat.fundedLoanId = entry.loanId AND funding.fundingDate IS NOT NULL
    LEFT JOIN applications repeatApp ON repeatApp.loanId = repeat.loanId
    ${fixed ? "LEFT JOIN loans repeatLoan ON repeatLoan.id = repeatApp.loanId" : ""}
    ${filterOwner ? "WHERE entry.ownerId = ?" : ""}
  ), timed AS (
    SELECT *, ${submitted} AS submittedAt, ${funded} AS fundingDate FROM events
  ), facts AS (
    SELECT *, ${repeat} AS repeatLoanId FROM timed
  )`;
}

const metricCondition = {
  leads: "mature = 1", outreach: "mature = 1 AND outreach = 1", submitted: "mature = 1 AND submittedAt IS NOT NULL",
  funded: "mature = 1 AND fundingDate IS NOT NULL", repeat: "mature = 1 AND repeatLoanId IS NOT NULL", maturing: "mature = 0",
} satisfies Record<keyof SalesTotals, string>;
const totalMetrics = [...salesMetrics, "maturing"] as const;
const metricColumns = salesPeriods.flatMap((period) => totalMetrics.map((metric) => `${period}_${metric}`));

function totals(row: Record<string, SqlValue> | undefined, period: (typeof salesPeriods)[number]): SalesTotals {
  return Object.fromEntries(totalMetrics.map((metric) => [metric, Number(row?.[`${period}_${metric}`] ?? 0)])) as SalesTotals;
}

function summarize(db: Store, query: Extract<SalesQuery, { kind: "summary" }>, now: Date): SalesDashboardResult {
  const selected = { from: query.from, through: query.through };
  const previous = priorReportPeriod(selected);
  const source = cohort(query, { from: previous.from, through: selected.through }, now);
  const { afterGroup, owner } = query;
  const columns = salesPeriods.flatMap((period) => totalMetrics.map((metric) =>
    `sum((${metricCondition[metric]}) AND isSelected = ${period === "selected" ? 1 : 0}) AS ${period}_${metric}`));
  const rows = db.prepare(`${facts(source.sql, Boolean(owner), Boolean(query.windowDays))}, grouped AS (
    SELECT groupId AS id, min(groupName) AS name, ${columns.join(", ")}
    FROM (SELECT *, at >= ? AS isSelected FROM facts) GROUP BY groupId
  )
  SELECT NULL AS id, NULL AS name, ${metricColumns.map((column) => `sum(${column}) AS ${column}`).join(", ")} FROM grouped
  UNION ALL SELECT * FROM (
    SELECT * FROM grouped ${afterGroup ? "WHERE (name COLLATE NOCASE, id) > (?, ?)" : ""}
    ORDER BY name COLLATE NOCASE, id LIMIT ?
  )`).all(...source.params, ...(owner ? [owner] : []), easternDayStart(selected.from),
    ...(afterGroup ? [afterGroup.name, afterGroup.id] : []), pageSize + 1);
  const [overall, ...groups] = rows;
  const page = groups.slice(0, pageSize).map((row) => ({ id: String(row.id), name: String(row.name),
    selected: totals(row, "selected"), previous: totals(row, "previous") }));
  const last = page.at(-1);
  const owners = db.prepare(`WITH cohort AS (${source.sql})
    SELECT ownerId AS id, coalesce(nullif(max(officer), ''), 'Unassigned') AS name FROM cohort
    GROUP BY ownerId ORDER BY name COLLATE NOCASE, id LIMIT 100`).all(...source.params)
    .map((row) => ({ id: String(row.id), name: String(row.name) }));
  const views = readDashboardViews(db, "Sales", salesDashboardFilters);
  const target = !owner && db.prepare("SELECT submitted, funded, revision FROM sales_conversion_targets WHERE channel = ? AND windowDays = ?")
    .get(query.channel, query.windowDays);
  return { kind: "summary", checkedAt: now.toISOString(), owners, groups: page, views, target: target ? { ...target } as SalesTarget : null,
    periods: { selected: { ...selected, ...totals(overall, "selected") }, previous: { ...previous, ...totals(overall, "previous") } },
    next: groups.length > pageSize && last ? { id: last.id, name: last.name } : null };
}

function records(db: Store, query: Extract<SalesQuery, { kind: "records" }>, now: Date): SalesDashboardResult {
  const { after, owner, groupId, period, metric } = query;
  const source = cohort(query, period === "previous" ? priorReportPeriod(query) : query, now, groupId);
  const rows = db.prepare(`${facts(source.sql, Boolean(owner), Boolean(query.windowDays))}
    SELECT id, at, name, groupId, groupName, officer, loanId, openLead, maturesAt,
      coalesce(outreach, 0) AS outreach, submittedAt, fundingDate, repeatLoanId
    FROM facts WHERE ${metricCondition[metric]} ${after ? "AND (at, id) < (?, ?)" : ""}
    ORDER BY at DESC, id DESC LIMIT ?`).all(...source.params, ...(owner ? [owner] : []),
    ...(after ? [after.at, after.id] : []), pageSize + 1) as unknown as SalesRecord[];
  const page = rows.slice(0, pageSize).map((row) => ({ ...row }));
  const last = page.at(-1);
  return { kind: "records", records: page, next: rows.length > pageSize && last ? { id: last.id, at: last.at } : null };
}

export function readSalesDashboard(db: Store, input: unknown, staff: WorkspaceStaff | null, brokerageId: string, now = new Date()): SalesDashboardResult {
  if (staff?.brokerage.role !== "Admin" || staff.brokerage.id !== brokerageId) return { error: salesDashboardUnavailable };
  const parsed = salesDashboardQuery.safeParse(input);
  if (!parsed.success) return { error: "Choose valid sales filters and a date range of up to 366 days." };
  return parsed.data.kind === "summary" ? summarize(db, parsed.data, now) : records(db, parsed.data, now);
}

export function changeSalesSettings(db: Store, input: unknown, staff: WorkspaceStaff | null, brokerageId: string): { message: string } | { error: string } {
  if (staff?.brokerage.role !== "Admin" || staff.brokerage.id !== brokerageId) return { error: salesDashboardUnavailable };
  const parsed = salesSettingRequest.safeParse(input);
  if (!parsed.success) return { error: "Check the sales dashboard settings and try again." };
  const data = parsed.data;
  const now = new Date().toISOString();
  return db.transaction(() => {
    if (data.type !== "saveTarget") return changeDashboardView(db, staff, "Sales", data, now);
    const { channel, windowDays, submitted, funded, revision } = data;
    const current = db.prepare("SELECT submitted, funded, revision FROM sales_conversion_targets WHERE channel = ? AND windowDays = ?")
      .get(channel, windowDays);
    if (current?.submitted === submitted && current.funded === funded) return { message: "Sales targets saved." };
    if ((current?.revision ?? 0) !== revision) return { error: "These targets changed. Refresh sales conversion before saving." };
    db.prepare(`INSERT INTO sales_conversion_targets (channel, windowDays, submitted, funded, revision) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(channel, windowDays) DO UPDATE SET submitted = excluded.submitted, funded = excluded.funded, revision = excluded.revision`)
      .run(channel, windowDays, submitted, funded, revision + 1);
    accessEvent(db, staff, "Saved sales conversion targets", `${channel} · ${windowDays || "All time"}`, now);
    return { message: "Sales targets saved." };
  });
}
