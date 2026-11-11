import { z } from "zod";
import federal from "../../docs/compliance/federal-sources.json" with { type: "json" };
import firstStates from "../../docs/compliance/state-sources-a-m.json" with { type: "json" };
import lastStates from "../../docs/compliance/state-sources-m-w.json" with { type: "json" };
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
export type ResearchSource = (typeof researchSources)[number];
export const researchFilters = z.strictObject({ jurisdiction: z.string().max(2).default(""),
  status: z.enum(["", ...complianceCaseStatuses]).default(""), ownership: z.enum(["all", "mine", "unavailable"]).default("all") });
export type ResearchFilters = z.infer<typeof researchFilters>;
const edit = { caseId: z.uuid(), expectedRevision: z.number().int().positive(), requestId: z.uuid() };
export const researchRequest = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("list"), filters: researchFilters,
    after: z.strictObject({ id: z.uuid(), snapshot: z.string().max(500) }).optional() }),
  z.strictObject({ operation: z.literal("open"), sourceKey: z.string().min(1).max(30), kind: z.enum(researchKinds) }),
  z.strictObject({ operation: z.literal("read"), caseId: z.uuid() }),
  z.strictObject({ operation: z.literal("save"), ...edit, status: z.enum(complianceCaseStatuses), ownerEmail: z.email(),
    followUpOn: z.iso.date().nullable(), nextAction: z.string().trim().min(1).max(500), note: z.string().trim().min(1).max(1000) }),
]);
export type ResearchRequest = z.infer<typeof researchRequest>;
export function sourceSnapshot(source: ResearchSource) { return JSON.stringify({ ...source, researchBaseline }); }
