import { createHash } from "node:crypto";
import { applicationDraft } from "./application-model";
import type { CutoverApplicationComparison, CutoverApplicationStatus } from "./cutover-application-model";
import { mismoBorrowerName, mismoFields } from "./mismo-rehearsal-model";
import type { Store } from "./store";

function parsedJson(value: string) {
  try { return JSON.parse(value) as unknown; }
  catch { return null; }
}

function normal(value: string | null) {
  return value?.normalize("NFC").trim().replace(/\s+/gu, " ").toLowerCase() || null;
}

function comparisonStatus(source: string | null, draft: string | null): CutoverApplicationStatus {
  if (source === draft) return source === null ? "Not supplied" : "Matched";
  if (source === null) return "Added in draft";
  return draft === null ? "Missing in draft" : "Changed";
}

function orderedObjectKeys(_key: string, value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, (value as Record<string, unknown>)[key]])) : value;
}

export function readApplicationComparison(db: Store, loanId: string): CutoverApplicationComparison | null {
  const row = db.prepare(`SELECT source.fields, source.sourceExtraBorrowers, application.draft, application.revision
    FROM mismo_rehearsals source JOIN applications application ON application.loanId = source.loanId WHERE source.loanId = ?`).get(loanId);
  if (typeof row?.fields !== "string" || typeof row.draft !== "string" || typeof row.revision !== "number" ||
    !Number.isSafeInteger(row.revision) || row.revision < 0) return null;
  const source = mismoFields.safeParse(parsedJson(row.fields));
  const application = applicationDraft.safeParse(parsedJson(row.draft));
  if (!source.success || !application.success) return null;
  const fields = source.data;
  const { borrowerName, loanAmount, purpose, occupancy, propertyAddress, propertyLocation: { unit, city, state, zip, ...otherLocation },
    urla, ...manualAnswers } = application.data;
  const pairs = [
    ["borrowerName", "Primary borrower name", mismoBorrowerName(fields), borrowerName],
    ["loanAmount", "Loan amount", Number(fields.amount).toFixed(2), loanAmount ? Number(loanAmount).toFixed(2) : ""],
    ["purpose", "Loan purpose", fields.purpose, purpose],
    ["occupancy", "Occupancy", fields.occupancy, occupancy],
    ["street", "Property street", fields.street, propertyAddress],
    ["unit", "Property unit", fields.unit, unit],
    ["city", "Property city", fields.city, city],
    ["state", "Property state", fields.state, state],
    ["zip", "Property ZIP code", fields.zip, zip],
  ] as const;
  const revision = row.revision;
  const storedCount = row.sourceExtraBorrowers;
  const sourceExtraBorrowers = typeof storedCount === "number" && Number.isSafeInteger(storedCount) && storedCount >= 0 ? storedCount : null;
  const additional = urla.credit.fields.type === "Joint" ? urla.additional : [];
  const draftExtraBorrowers = additional.filter(({ identity }) => Boolean(identity.fields.name?.trim())).length;
  const missingExtraBorrowers = sourceExtraBorrowers === null ? 0 : Math.max(0, sourceExtraBorrowers - draftExtraBorrowers);
  const normalized = pairs.map(([key, , original, current]) => [key, normal(original), normal(current)] as const);
  // Navigation can increment the stored revision without changing any answers.
  const draftEvidence = { ...manualAnswers, propertyLocation: otherLocation, urla: { ...urla, additional } };
  const fingerprint = createHash("sha256").update(JSON.stringify([loanId, normalized, sourceExtraBorrowers, draftEvidence], orderedObjectKeys)).digest("hex");
  const rows = pairs.map(([key, label, original, current], index) => ({ key, label, source: original || null, draft: current || null,
    status: comparisonStatus(normalized[index][1], normalized[index][2]) }));
  return { fingerprint, revision, rows, sourceExtraBorrowers, draftExtraBorrowers, missingExtraBorrowers };
}
