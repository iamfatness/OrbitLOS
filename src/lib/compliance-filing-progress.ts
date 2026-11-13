import { createHash } from "node:crypto";
import type { Store } from "./store";
import { reviewColoradoCompanyRenewal, type ColoradoCompanyRenewalEvidence } from "./colorado-company-renewal-model";
import { reviewIllinoisAuditEvidence, type IllinoisAuditEvidence } from "./illinois-audit-evidence-model";
import { prepareNewYorkEmploymentWorkpaper, reviewNewYorkEmployment, type NewYorkEmploymentEvidence } from "./new-york-employment-model";
import { isNewYorkVoorSource, reviewNewYorkVoor, type NewYorkVoorEvidence } from "./new-york-voor-model";
import { reviewMichiganMloRenewal, type MichiganMloRenewalEvidence } from "./michigan-mlo-renewal-model";
import { nmlsFilingComponent, reviewNmlsFiling, type MichiganFilingEvidence } from "./michigan-filing-evidence-model";
import type { ObligationDraft } from "./compliance-obligations-model";

export type FilingProgress = { revision: string | null; summary: string; gaps: string[]; reviewedScopeRevision?: number; reviewedDueOn?: string };
type FilingTarget = {
  brokerageId: string; entityId: string; obligationId: string; period: string; sourceKey: string;
  bounds: { from: string; through: string }; nominalDueOn: string | null;
  basisChanged?: boolean;
  reviewedScopeIsCurrent: (basis: ObligationStateSource & { snapshot?: string }) => boolean;
  draft: Pick<ObligationDraft, "cadence" | "annualStartMonth">;
};

export function currentFilingProgress(db: Store, target: FilingTarget, now: string): FilingProgress | undefined {
  const { sourceKey, bounds, nominalDueOn } = target;
  if (sourceKey === "REQ-MI-LICENSING-MLO-RENEW" && nominalDueOn)
    return michiganRenewalProgress(db, target, nominalDueOn, now);
  const nmlsComponent = nmlsFilingComponent(sourceKey, target.draft, bounds.from);
  const table = nmlsComponent ? "michigan_filing_versions" :
    isNewYorkVoorSource(sourceKey) && bounds.from.endsWith("-01-01") && bounds.through.endsWith("-12-31")
    ? "new_york_voor_versions" : sourceKey === "REQ-NY-REPORTING-QRES" && nominalDueOn ? "new_york_employment_versions"
    : sourceKey === "REQ-CO-LICENSING-CO-RENEW" && nominalDueOn && bounds.from >= "2026-01-01" ? "colorado_company_renewal_versions"
    : sourceKey === "REQ-IL-REPORTING-ANNUAL-AUDIT" && nominalDueOn ? "illinois_audit_evidence_versions" : null;
  if (!table) return;
  const timeZone = table === "colorado_company_renewal_versions" ? "America/Denver" :
    table === "illinois_audit_evidence_versions" ? "America/Chicago" : "America/New_York";
  const asOf = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
  const row = db.prepare(`SELECT version,evidence${nmlsComponent ? ",finding" : ""} FROM ${table}
    WHERE brokerageId=? AND entityId=? AND obligationId=? AND period=? ORDER BY version DESC LIMIT 1`)
    .get(target.brokerageId, target.entityId, target.obligationId, target.period);
  if (!row) return {
    revision: null, summary: "Filing evidence needed",
    gaps: [...(nominalDueOn && nominalDueOn < asOf ? ["The nominal date passed without recorded evidence."] : []),
      nmlsComponent ? "Record the original filing receipt and supporting evidence." : "Open the linked period in Obligations to record evidence."],
  };
  const revision = String(row.version);
  const evidence: unknown = JSON.parse(String(row.evidence));
  if (table === "michigan_filing_versions") {
    const review = evidence as MichiganFilingEvidence;
    const { reviewedScope } = JSON.parse(String(row.finding)) as { reviewedScope?: ObligationStateSource & { snapshot?: string } };
    const rechecked = reviewedScope && review.deadline && target.reviewedScopeIsCurrent(reviewedScope);
    const finding = reviewNmlsFiling(review, nominalDueOn, asOf, nmlsComponent, bounds.through, target.basisChanged && !rechecked);
    return { revision, summary: finding.summary, gaps: finding.gaps, ...(rechecked && {
      reviewedScopeRevision: reviewedScope.revision, reviewedDueOn: review.deadline?.on,
    }) };
  }
  if (table === "new_york_voor_versions") {
    const finding = reviewNewYorkVoor(evidence as NewYorkVoorEvidence, nominalDueOn, asOf);
    if (finding.initialTiming === "After recorded deadline") finding.gaps.push("Review the late initial submission.");
    return { revision, summary: finding.initialTiming, gaps: finding.gaps };
  }
  if (table === "new_york_employment_versions" && nominalDueOn) {
    const record = evidence as NewYorkEmploymentEvidence;
    const finding = reviewNewYorkEmployment(record, nominalDueOn, asOf);
    const workpaperGaps = prepareNewYorkEmploymentWorkpaper(record, bounds).gaps.length;
    const gaps = workpaperGaps ? [`Review ${workpaperGaps} open ${workpaperGaps === 1 ? "finding" : "findings"} in the quarterly filing workpaper.`] : [];
    if (finding.entityNoticesMissing) gaps.push("Verify missing brokerage departure notices.");
    if (finding.individualNoticesMissing) gaps.push("Verify missing individual departure notices.");
    if (finding.verifyNoticeTiming) gaps.push("Verify the timing of recorded prompt notices.");
    if (finding.filingStatus === "Mailing recorded after nominal date") gaps.push("Review the late quarterly mailing.");
    if (!record.mailed) gaps.push("Record the quarterly mailing evidence or confirm the filing treatment.");
    return { revision, summary: finding.filingStatus, gaps };
  }
  if (table === "illinois_audit_evidence_versions") {
    const record = evidence as IllinoisAuditEvidence;
    const finding = reviewIllinoisAuditEvidence(record, asOf);
    const gaps = [];
    if (!record.filing) gaps.push("Record the audit filing receipt.");
    if (finding.filingStatus === "Filed late") gaps.push("Review the late audit filing.");
    if (finding.extensionStatus === "Pending decision") gaps.push("Verify the extension decision. The original deadline still applies.");
    if (finding.requestStatus === "Late") gaps.push("Review the timing of the extension request.");
    return { revision, summary: finding.filingStatus, gaps };
  }
  const record = evidence as ColoradoCompanyRenewalEvidence;
  const finding = reviewColoradoCompanyRenewal(record, Number(bounds.from.slice(0, 4)), asOf);
  const gaps = [];
  if (finding.classificationNeedsReview) gaps.push("Verify the reporting classification.");
  if (!finding.requestRecorded) gaps.push("Record the renewal request.");
  if (finding.renewalStatus !== "Renewed") gaps.push("Verify the regulator's renewal status.");
  for (const row of finding.rows.filter(item => item.timing !== "Receipt by nominal date"))
    gaps.push(`${row.component} ${row.period} · ${row.timing}`);
  const outstanding = record.olderDeficiencies?.filter(item => !item.clearance).length ?? 0;
  if (outstanding) gaps.push(`${outstanding} older filing ${outstanding === 1 ? "deficiency needs" : "deficiencies need"} clearance evidence.`);
  return { revision, summary: finding.renewalStatus, gaps };
}

function michiganRenewalProgress(db: Store, target: FilingTarget, dueOn: string, now: string): FilingProgress {
  const rows = db.prepare(`SELECT v.originatorNmls,v.version,v.evidence FROM michigan_mlo_renewal_versions v
    WHERE v.brokerageId=? AND v.entityId=? AND v.obligationId=? AND v.period=? AND v.version=(
      SELECT MAX(n.version) FROM michigan_mlo_renewal_versions n
      WHERE n.brokerageId=v.brokerageId AND n.entityId=v.entityId AND n.obligationId=v.obligationId AND n.period=v.period
        AND n.originatorNmls=v.originatorNmls)
    ORDER BY v.originatorNmls`).all(target.brokerageId, target.entityId, target.obligationId, target.period);
  const asOf = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Detroit", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
  const reviews = rows.map(row => reviewMichiganMloRenewal(JSON.parse(String(row.evidence)) as MichiganMloRenewalEvidence,
    target.bounds.from, dueOn, asOf));
  const renewed = reviews.filter(review => review.regulatorStatus === "Renewed").length;
  const missingRequest = reviews.filter(review => !["Request recorded by nominal date", "Request recorded after nominal date"].includes(review.requestStatus)).length;
  const lateRequest = reviews.filter(review => review.requestStatus === "Request recorded after nominal date").length;
  return {
    revision: rows.length ? createHash("sha256").update(JSON.stringify(rows.map(row => [row.originatorNmls, row.version]))).digest("hex") : null,
    summary: rows.length ? `${renewed} of ${rows.length} recorded originators show renewed status` : "Individual renewal evidence needed",
    gaps: ["Reconcile the individual records to the sponsored roster.",
      ...(missingRequest ? [`${missingRequest} without a recorded request${asOf > dueOn ? " after the nominal deadline" : ""}.`] : []),
      ...(lateRequest ? [`${lateRequest} requests recorded after the nominal deadline.`] : [])],
  };
}
