import { applicationDraft } from "./application-model";
import { primaryDocumentRecipient, type DocumentRecipient } from "./document-model";
import type { DocumentRuleMatch, DocumentTemplateRule } from "./document-template-model";
import type { Store } from "./store";

export function reviewedDocumentFacts(db: Store, loanId: string, recipient: DocumentRecipient) {
  const row = db.prepare(`SELECT current.revision, reviewed.draft FROM applications current
    JOIN application_versions reviewed ON reviewed.loanId = current.loanId AND reviewed.revision = current.revision
    WHERE current.loanId = ? AND current.submittedAt IS NOT NULL AND current.reviewedAt IS NOT NULL
      AND current.correctionNote = '' AND reviewed.reviewedAt IS NOT NULL`).get(loanId);
  if (!row) return null;
  const parsed = applicationDraft.safeParse(JSON.parse(String(row.draft)));
  if (!parsed.success) return null;
  const { occupancy, urla } = parsed.data;
  const person = recipient === primaryDocumentRecipient ? urla.primary : urla.additional[0];
  const hasJobs = person?.work.fields.hasJobs;
  const jobs = person?.work.groups.jobs ?? [];
  const current = hasJobs === "Yes" ? jobs.filter((job) => job.status === "Current") : [];
  const incomplete = hasJobs !== "No" && (hasJobs !== "Yes" || !jobs.length || jobs.some((job) =>
    (job.status !== "Current" && job.status !== "Previous") ||
    (job.status === "Current" && job.selfEmployed !== "Yes" && job.selfEmployed !== "No")));
  return { revision: Number(row.revision), occupancy,
    wage: current.some((job) => job.selfEmployed === "No") ? true : incomplete ? null : false,
    selfEmployed: current.some((job) => job.selfEmployed === "Yes") ? true : incomplete ? null : false };
}

export function documentRuleMatch(rule: DocumentTemplateRule | undefined, facts: ReturnType<typeof reviewedDocumentFacts>): DocumentRuleMatch {
  if (!rule) return "Matches";
  if (!facts) return "Needs reviewed 1003";
  const occupancy = rule.occupancy ? facts.occupancy ? rule.occupancy === facts.occupancy : null : true;
  const employment = rule.employment === "Current wage employment" ? facts.wage :
    rule.employment === "Current self-employment" ? facts.selfEmployed : true;
  if (occupancy === false || employment === false) return "Does not match";
  return occupancy === null || employment === null ? "Missing answer" : "Matches";
}
