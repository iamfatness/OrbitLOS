import { demoBrokerageId } from "./brokerage-model";
import { easternDate } from "./client-retention";
import { feeTemplateChanged, feeTemplateConfig, feeTemplateRequest, feeTemplatesUnavailable,
  type FeeTemplate, type FeeTemplatePage } from "./fee-template-model";
import { pricingInputError } from "./income-review-freshness";
import type { PricingScenario } from "./pricing-model";
import { propertyStateCodes, propertyStateName } from "./property-state";
import { feeAllocationIssue, feeKeys, type FeePropertyLocation, type FeeTemplateOrigin } from "./quote-worksheet";
import type { WorkspaceStaff } from "./staff-store";
import type { SqlValue, Store } from "./store";
import { accessEvent, loanAccess } from "./workspace-access";
import { zipCityState } from "./zip-city-state";

const activeLimit = 24;
const pageSize = 30;
const templateState = "coalesce(json_extract(config, '$.state'), '')";
const compatibleFees = `archived = 0 AND effectiveOn <= ? AND (purpose = 'Any loan purpose' OR purpose = ?)
  AND (zip = '' OR zip = ?) AND ${templateState} IN ('', ?)`;

function feeProperty(zip: string): FeePropertyLocation {
  const state = zipCityState(zip)?.state;
  return state && propertyStateCodes.includes(state) ? { zip, state } : { zip };
}

function readTemplate(row: Record<string, SqlValue>): FeeTemplate {
  return { ...feeTemplateConfig.parse(JSON.parse(String(row.config))), id: String(row.id),
    revision: Number(row.revision), archived: Boolean(row.archived) };
}

function resolveTemplate(template: FeeTemplate, scenario: PricingScenario): FeeTemplate {
  if (!template.rules || !Object.keys(template.rules).length) return template;
  const fees = { ...template.fees };
  const calculations: NonNullable<FeeTemplateOrigin["calculations"]> = {};
  for (const key of feeKeys) {
    const rule = template.rules[key];
    if (!rule) continue;
    const base = rule.basis === "Loan amount" ? scenario.loanAmount : scenario.purchasePrice;
    if (!base) return { ...template, blocked: "Reprice with a purchase price to use this template." };
    const baseCents = Math.round(base * 100);
    const amountCents = Math.floor((baseCents * rule.basisPoints + 5_000) / 10_000);
    fees[key] = amountCents;
    calculations[key] = { ...rule, baseCents, amountCents };
  }
  const issue = feeAllocationIssue({ fees, allocations: template.allocations }, scenario.purpose === "Purchase");
  return { ...template, fees, calculations, ...(issue ? { blocked: issue } : {}) };
}

export function feeOriginForQuote(db: Store, choice: Pick<FeeTemplateOrigin, "id" | "revision">,
  scenario: PricingScenario, asOf: string): FeeTemplateOrigin | { error: string } | undefined {
  const property = feeProperty(scenario.zip);
  const row = db.prepare(`SELECT id, revision, archived, config FROM brokerage_fee_templates
    WHERE id = ? AND revision = ? AND ${compatibleFees}`).get(choice.id, choice.revision, asOf, scenario.purpose, property.zip, property.state ?? "");
  if (!row) return;
  const { id, revision, title, source, effectiveOn, zip, state, fees, allocations, calculations, blocked } = resolveTemplate(readTemplate(row), scenario);
  if (blocked) return { error: blocked };
  return { id, revision, title, source, effectiveOn, zip, ...(state ? { state } : {}), property, fees,
    ...(allocations ? { allocations } : {}), ...(calculations ? { calculations } : {}) };
}

function canActivate(db: Store, id: string, title: string) {
  const titleTaken = db.prepare(`SELECT 1 FROM brokerage_fee_templates WHERE archived = 0 AND id <> ?
    AND title = ? COLLATE NOCASE`).get(id, title);
  if (titleTaken) return "Choose a different title for this active fee template.";
  const others = db.prepare("SELECT COUNT(*) AS count FROM brokerage_fee_templates WHERE archived = 0 AND id <> ?").get(id);
  if (Number(others?.count) >= activeLimit) return `Archive an active template first. The limit is ${activeLimit}.`;
}

export function feeTemplateWork(db: Store, input: unknown, staff: WorkspaceStaff | null, brokerageId: string,
  now = new Date()): FeeTemplatePage | { error: string } {
  if (brokerageId !== (staff?.brokerage.id ?? demoBrokerageId) || staff?.brokerage.role === "Processor") {
    return { error: feeTemplatesUnavailable };
  }
  const parsed = feeTemplateRequest.safeParse(input);
  if (!parsed.success) {
    const feeError = parsed.error.issues.find(({ path }) => path[0] === "config" && ["allocations", "rules", "fees", "state"].includes(String(path[1])));
    return { error: feeError?.message ?? "Enter a title, source, effective date, and at least one valid fee. Use five digits for a ZIP restriction." };
  }
  const data = parsed.data;
  const asOf = easternDate(now);
  if (data.type === "forQuote") {
    if (staff && !loanAccess(db, staff, data.loanId)) return { error: feeTemplatesUnavailable };
    const run = db.prepare("SELECT scenario, applicationRevision, incomeReviewRevision FROM pricing_runs WHERE id = ? AND loanId = ? AND mode = 'mock'")
      .get(data.runId, data.loanId);
    const app = db.prepare("SELECT revision, correctionNote FROM applications WHERE loanId = ?").get(data.loanId);
    if (!run) return { error: "Price the current loan before loading a fee template." };
    const freshness = pricingInputError(db, data.loanId, { applicationRevision: run.applicationRevision, incomeReviewRevision: run.incomeReviewRevision },
      app ? { revision: Number(app.revision), correctionNote: String(app.correctionNote ?? "") } : undefined);
    if (freshness) return { error: freshness };
    const scenario = JSON.parse(String(run.scenario)) as PricingScenario;
    const property = feeProperty(scenario.zip);
    const rows = db.prepare(`SELECT id, revision, archived, config FROM brokerage_fee_templates WHERE ${compatibleFees}
      ORDER BY (zip <> '') DESC, (${templateState} <> '') DESC, title COLLATE NOCASE, id LIMIT ?`)
      .all(asOf, scenario.purpose, property.zip, property.state ?? "", activeLimit);
    return { templates: rows.map((row) => resolveTemplate(readTemplate(row), scenario)), asOf, more: false, property };
  }
  if (staff && staff.brokerage.role !== "Admin") return { error: "Only brokerage admins can manage fee templates." };
  return db.transaction(() => {
    if (data.type !== "manage") {
      const row = db.prepare("SELECT * FROM brokerage_fee_templates WHERE id = ?").get(data.id);
      const revision = Number(row?.revision ?? 0);
      if (data.type === "publish") {
        const config = JSON.stringify(data.config);
        const replay = row && !row.archived && row.config === config && [data.revision, data.revision + 1].includes(revision);
        if (!replay) {
          if (row?.archived || revision !== data.revision) return { error: feeTemplateChanged };
          const { title, purpose, effectiveOn, zip, state } = data.config;
          if (effectiveOn > asOf) return { error: "Choose an effective date on or before today." };
          if (state && zip) {
            const resolved = feeProperty(zip).state;
            if (!resolved) return { error: "Use a ZIP in the property directory or leave the ZIP blank for a statewide template." };
            if (resolved !== state) return { error: `ZIP ${zip} is listed in ${propertyStateName(resolved)}. Choose a ZIP in ${propertyStateName(state)} or clear the ZIP restriction.` };
          }
          const error = canActivate(db, data.id, title);
          if (error) return { error };
          db.prepare(`INSERT INTO brokerage_fee_templates (id, title, revision, effectiveOn, purpose, zip, config)
            VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title = excluded.title, revision = excluded.revision,
            effectiveOn = excluded.effectiveOn, purpose = excluded.purpose, zip = excluded.zip, config = excluded.config`)
            .run(data.id, title, revision + 1, effectiveOn, purpose, zip, config);
          accessEvent(db, staff, "Published sample fee template", `${title} · Version ${revision + 1}`, now.toISOString());
        }
      } else {
        if (!row || (revision !== data.revision &&
          !(revision === data.revision + 1 && Boolean(row.archived) === data.archived))) return { error: feeTemplateChanged };
        if (Boolean(row.archived) !== data.archived) {
          const error = !data.archived && canActivate(db, data.id, String(row.title));
          if (error) return { error };
          db.prepare("UPDATE brokerage_fee_templates SET archived = ?, revision = revision + 1 WHERE id = ?")
            .run(Number(data.archived), data.id);
          accessEvent(db, staff, data.archived ? "Archived sample fee template" : "Restored sample fee template", String(row.title), now.toISOString());
        }
      }
    }
    const search = data.type === "manage" ? data.search : "";
    const rows = db.prepare(`SELECT id, revision, archived, config FROM brokerage_fee_templates
      WHERE instr(lower(title), lower(?)) > 0 ORDER BY archived, title COLLATE NOCASE, id LIMIT ?`).all(search, pageSize + 1);
    return { templates: rows.slice(0, pageSize).map(readTemplate), asOf, more: rows.length > pageSize };
  });
}
