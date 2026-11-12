import { z } from "zod";
import federal from "../../docs/compliance/federal-sources.json" with { type: "json" };
import firstStates from "../../docs/compliance/state-sources-a-m.json" with { type: "json" };
import lastStates from "../../docs/compliance/state-sources-m-w.json" with { type: "json" };
import reportingReviews from "../../docs/compliance/state-reporting-review-sources.json" with { type: "json" };
import { complianceCaseStatuses } from "./compliance-case-model";

export const researchBaseline = "2026-11-10";
export const researchKinds = ["Requirement review", "Control gap"] as const;
export const researchSources = [
  ...federal.map((entry) => ({ key: entry.id, jurisdiction: "US", title: entry.title, sourceUrl: entry.sourceUrl,
    summary: entry.requirement, applicability: entry.applicability, gap: entry.platformGap, evidence: entry.evidence })),
  ...[...firstStates, ...lastStates].map((entry) => ({ key: `STATE-${entry.code}`, jurisdiction: entry.code, title: entry.name,
    sourceUrl: entry.sourceUrl, summary: entry.summary, applicability: "State applicability requires review for the brokerage's products, roles and activities.",
    gap: "Research is preliminary. Legal rule extraction and implementation verification remain open.",
    evidence: "Approved applicability, exact authorities and effective dates, required controls, operational owners and validation evidence." })),
];
export type ResearchSource = (typeof researchSources)[number] & {
  sourceDate?: string;
  relatedSources?: { label: string; url: string }[];
};
const reportingByState: Record<string, { summary: string; gap: string; sources: { label: string; url: string }[] }> = reportingReviews;
const licensingChecklist = "https://mortgage.nationwidelicensingsystem.org/knowledge/Products/nmls/stateresourcecenter/SitePages/Checklist-Compiler.aspx";
const stateWorkstreams = [
  { key: "LICENSING", title: "Licensing and eligibility",
    summary: "Identify the company, branch and originator authorities for the proposed activities.",
    evidence: "Exact license and regulator, activities, effective dates, branch and sponsorship, renewal, exemptions, and eligibility tests." },
  { key: "REPORTING", title: "Reporting and financials",
    summary: "Confirm each applicable return for the entity, license and period.",
    evidence: "Current form and authority, period and due-date basis, zero-activity handling, delivery and amendment evidence, and report validation." },
  { key: "LOAN", title: "Loan terms and disclosures",
    summary: "Review state-specific disclosures, fees, compensation, high-cost rules and prohibited practices for each product and role.",
    evidence: "Effective rule, triggering facts, responsible party, exceptions, control checks and retained disclosure evidence." },
  { key: "OUTREACH", title: "Communications and consent",
    summary: "Review marketing, contact, recording and consumer consent rules for the channels in use.",
    evidence: "Channel and location scope, consent and suppression evidence, reviewed exception handling and blocked-action tests." },
  { key: "RECORDS", title: "Records, complaints and exams",
    summary: "Review recordkeeping, examination, complaint and incident duties for the proposed activity.",
    evidence: "Record classes, retention triggers and holds, regulator deadlines and routes, evidence access and test exports." },
] as const;

export const stateRolloutSources: ResearchSource[] = [...firstStates, ...lastStates].flatMap(state => stateWorkstreams.map(work => {
  const reporting = work.key === "REPORTING" ? reportingByState[state.code] : undefined;
  return {
    key: `STATE-${state.code}-${work.key}`,
    jurisdiction: state.code,
    title: `${state.name} · ${work.title}`,
    sourceUrl: reporting?.sources[0]?.url ?? state.sourceUrl,
    summary: reporting?.summary ?? work.summary,
    applicability: "Review for the named entity, license, activities, products and period before activation.",
    gap: reporting?.gap ?? "Confirm current authorities, rule details and platform behavior for this jurisdiction.",
    evidence: work.evidence,
    ...(reporting ? { relatedSources: reporting.sources, sourceDate: "2026-11-11" }
      : work.key === "LICENSING" ? { relatedSources: [{ label: "NMLS licensing checklists", url: licensingChecklist }] } : {}),
  };
}));
const researchByKey = new Map([...researchSources, ...stateRolloutSources].map(entry => [entry.key, entry]));
export const getResearchSource = (key: string): ResearchSource | undefined => researchByKey.get(key);
export const researchFilters = z.strictObject({ jurisdiction: z.string().max(2).default(""),
  status: z.enum(["", ...complianceCaseStatuses]).default(""), ownership: z.enum(["all", "mine", "unavailable"]).default("all") });
export type ResearchFilters = z.infer<typeof researchFilters>;
const edit = { caseId: z.uuid(), expectedRevision: z.number().int().positive(), requestId: z.uuid() };
export const researchRequest = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("stateRollout"), jurisdiction: z.string().length(2) }),
  z.strictObject({ operation: z.literal("list"), filters: researchFilters,
    after: z.strictObject({ id: z.uuid(), snapshot: z.string().max(500) }).optional() }),
  z.strictObject({ operation: z.literal("open"), sourceKey: z.string().min(1).max(30), kind: z.enum(researchKinds) }),
  z.strictObject({ operation: z.literal("read"), caseId: z.uuid() }),
  z.strictObject({ operation: z.literal("save"), ...edit, status: z.enum(complianceCaseStatuses), ownerEmail: z.email(),
    followUpOn: z.iso.date().nullable(), nextAction: z.string().trim().min(1).max(500),
    evidenceReference: z.string().trim().max(250).optional(), note: z.string().trim().min(1).max(1000) }),
]);
export type ResearchRequest = z.infer<typeof researchRequest>;
export function sourceSnapshot(source: ResearchSource) { return JSON.stringify({ ...source, researchBaseline: source.sourceDate ?? researchBaseline }); }
