import { createHash } from "node:crypto";
import { z } from "zod";
import { quarterRange, reportOutcomes, reportStates } from "./call-report-model";
import { priorQuarter, quarterName, quarterReviewColumns } from "./call-report-quarter-model";
import { readCsv } from "./contact-csv";
import { reconcileFv7Pipeline } from "./mcr-fv7-pipeline";
import { fv7FundedEvidence, reconcileFv7Funded } from "./mcr-fv7-funded-review";

const reference = z.string().trim().min(1).max(160);
const amount = z.number().int().min(0).max(1_000_000_000);
const source = z.enum(["direct", "thirdParty"]);
const state = z.string().refine((value) => reportStates.includes(value));
const balance = z.strictObject({ count: z.number().int().min(0).max(1_000_000), amount: z.number().int().min(0).max(9_999_999_999_999) });
const reviewedAmount = z.strictObject({ amount, reference });
const evidence = z.strictObject({
  entityReference: reference,
  snapshotSha256: z.string().regex(/^[0-9a-f]{64}$/i),
  year: z.literal(2026),
  quarter: z.number().int().min(1).max(4),
  version: z.number().int().positive(),
  priorEnding: z.strictObject({
    period: z.string(),
    reference,
    states: z.array(z.strictObject({ state, direct: balance, thirdParty: balance })).min(1).max(56),
  }),
  adjustmentLedgerReference: reference,
  amountChangeLedgerReference: reference,
  files: z.array(z.strictObject({
    loanId: reference, revision: z.number().int().nonnegative(), state, source, intakeReference: reference,
    opening: reviewedAmount.optional(), ending: reviewedAmount.optional(), outcomeReference: reference.optional(),
  })).max(1_000),
  amountChanges: z.array(z.strictObject({ loanId: reference, date: z.iso.date(), sequence: z.number().int().positive(),
    before: amount, after: amount, reference })).max(5_000),
  adjustments: z.array(z.strictObject({ loanId: reference, kind: z.enum(["add", "remove"]), date: z.iso.date(),
    reference, commentary: z.string().trim().min(1).max(500) })).max(200),
  fundedReview: fv7FundedEvidence.optional(),
});

const activityLines = {
  "Beginning pipeline": "AC010", "Applications received": "AC020", "Approved but not accepted": "AC030",
  Denied: "AC040", Withdrawn: "AC050", "Closed for incompleteness": "AC060", "Closed and funded": "AC070", "Ending pipeline": "AC080",
} as const;
type Activity = keyof typeof activityLines;
type ActivityLine = (typeof activityLines)[Activity];
const csvKeys = Object.keys(quarterReviewColumns) as (keyof typeof quarterReviewColumns)[];
type ReviewRow = Record<(typeof csvKeys)[number], string>;

function readSnapshot(csv: string, period: string, version: number) {
  const [header, ...lines] = readCsv(csv, 1_000_000);
  if (JSON.stringify(header) !== JSON.stringify(Object.values(quarterReviewColumns)) ||
    lines.some((row) => row.length !== csvKeys.length)) throw new Error("Use the saved Orbit quarter review CSV.");
  const rows = lines.map((values) => Object.fromEntries(csvKeys.map((key, index) => [key, values[index]])) as ReviewRow);
  const [summary] = rows;
  if (summary?.type !== "Internal review" || summary.status !== "Quarter ended" ||
    rows.slice(1).some(({ type }) => !["Loan activity", "State comparison", "Carryover difference"].includes(type)) ||
    rows.some((row) => row.period !== period || row.version !== String(version))) {
    throw new Error("The export must be one saved, ended quarter at the reviewed version.");
  }
  return rows.filter(({ type }) => type === "Loan activity");
}

function uniqueMap<T>(items: T[], key: (item: T) => string, label: string) {
  const map = new Map(items.map((item) => [key(item), item]));
  if (map.size !== items.length) throw new Error(`Duplicate ${label} in the quarter evidence.`);
  return map;
}

function readAmount(value: string) {
  if (!/^\d+$/.test(value)) throw new Error("The saved review is missing a reportable amount.");
  return amount.parse(Number(value));
}

function newColumn(priorEnding: z.infer<typeof balance>) {
  const lines = Object.fromEntries(Object.values(activityLines).map((line) => [line, { count: 0, amount: 0 }])) as
    Record<ActivityLine, z.infer<typeof balance>>;
  return { ...lines, priorEnding, AC063: { count: 0, amount: 0 }, AC065: 0 };
}

export function fv7EvidenceTemplate(csv: string, year: number, quarter: number, version: number) {
  const period = { year, quarter };
  const included = readSnapshot(csv, quarterName(period), version).filter(row => row.groups !== "Excluded");
  const blankAmount = () => ({ amount: null, reference: "" });
  const blankBalance = () => ({ count: null, amount: null });
  return {
    entityReference: "", snapshotSha256: createHash("sha256").update(csv).digest("hex"), year, quarter, version,
    priorEnding: { period: quarterName(priorQuarter(period)), reference: "",
      states: [...new Set(included.map(row => row.state))].sort()
        .map(state => ({ state, direct: blankBalance(), thirdParty: blankBalance() })) },
    adjustmentLedgerReference: "", amountChangeLedgerReference: "",
    files: included.map(row => {
      const groups = row.groups.split(" | ");
      return {
        loanId: row.loan, revision: Number(row.revision), state: row.state, source: null, intakeReference: "",
        ...(groups.includes("Beginning pipeline") ? { opening: blankAmount() } : {}),
        ...(groups.includes("Ending pipeline") ? { ending: blankAmount() } : { outcomeReference: "" }),
      };
    }),
    amountChanges: [], adjustments: [],
  };
}

export function buildFv7QuarterWorkpaper(csv: string, input: unknown) {
  const data = evidence.parse(input);
  const snapshotSha256 = createHash("sha256").update(csv).digest("hex");
  if (snapshotSha256 !== data.snapshotSha256.toLowerCase()) throw new Error("The saved quarter review does not match its reviewed checksum.");
  if (data.priorEnding.period !== quarterName(priorQuarter(data))) throw new Error("Supply ending balances from the immediately preceding quarter.");
  const { from, through } = quarterRange(data.year, data.quarter);
  const inQuarter = (date: string) => date >= from && date <= through;
  const states = uniqueMap(data.priorEnding.states.map(({ state, direct, thirdParty }) => ({
    state, direct: newColumn(direct), thirdParty: newColumn(thirdParty), hasAdjustments: false,
  })), (item) => item.state, "reporting jurisdiction");
  const snapshot = readSnapshot(csv, quarterName(data), data.version);
  const included = uniqueMap(snapshot, ({ loan }) => loan, "loan");
  const files = uniqueMap(data.files, ({ loanId }) => loanId, "file review");
  const changes = new Map<string, typeof data.amountChanges>();
  const adjustments = uniqueMap(data.adjustments, ({ loanId }) => loanId, "adjusted loan");
  uniqueMap(data.amountChanges, ({ reference }) => reference, "amount-change evidence reference");
  uniqueMap(data.adjustments, ({ reference }) => reference, "adjustment evidence reference");
  for (const change of data.amountChanges) {
    if (!inQuarter(change.date) || !files.has(change.loanId)) throw new Error("An amount change is outside the reviewed quarter or has no reviewed loan.");
    const group = changes.get(change.loanId) ?? [];
    group.push(change);
    changes.set(change.loanId, group);
  }
  for (const adjustment of data.adjustments) {
    if (!inQuarter(adjustment.date) || !files.has(adjustment.loanId)) {
      throw new Error("An AC063 adjustment is outside the reviewed quarter or has no reviewed loan.");
    }
  }
  const loanEvidence = [];
  const fundedFiles = [];
  for (const [loanId, row] of included) {
    if (row.groups === "Excluded") continue;
    const reviewed = files.get(loanId);
    const jurisdiction = states.get(row.state);
    if (!reviewed || !jurisdiction || reviewed.state !== row.state || String(reviewed.revision) !== row.revision) {
      throw new Error(`Loan ${loanId} requires a reviewed intake source for its exact state and facts revision.`);
    }
    const column = jurisdiction[reviewed.source];
    const activities = row.groups.split(" | ") as Activity[];
    const outcome = reportOutcomes.find((value) => activities.includes(value));
    const opening = activities.includes("Beginning pipeline");
    const ending = activities.includes("Ending pipeline");
    const received = activities.includes("Applications received");
    if ((!opening && !received) || opening === received || Boolean(outcome) === ending ||
      activities.length !== 2 || !activities.every((group) => Object.hasOwn(activityLines, group))) {
      throw new Error(`Loan ${loanId} has unresolved or unsupported report groups.`);
    }
    if (opening !== Boolean(reviewed.opening) || ending !== Boolean(reviewed.ending) || Boolean(outcome) !== Boolean(reviewed.outcomeReference)) {
      throw new Error(`Loan ${loanId} requires evidence for each applicable quarter boundary or outcome.`);
    }
    const firstDay = z.iso.date().parse(row.received);
    const outcomeDay = row.outcomeOn ? z.iso.date().parse(row.outcomeOn) : null;
    const lastDay = outcome ? outcomeDay ?? "" : through;
    if ((opening ? firstDay >= from : !inQuarter(firstDay)) || !inQuarter(lastDay) || firstDay > lastDay ||
      (outcome ? row.outcome !== outcome : Boolean(outcomeDay && outcomeDay <= through))) {
      throw new Error(`Loan ${loanId} has dates that conflict with its reviewed quarter activity.`);
    }
    const start = reviewed.opening?.amount ?? readAmount(row.amount);
    const end = reviewed.ending?.amount ?? readAmount(row.outcomeAmount);
    const adjustment = adjustments.get(loanId);
    const added = adjustment?.kind === "add";
    const removed = adjustment?.kind === "remove";
    if ((added && !opening) || (removed && !ending)) {
      throw new Error(`Loan ${loanId} cannot use AC063 to replace a received or outcome line.`);
    }
    const activeFrom = added ? adjustment.date : firstDay;
    const activeThrough = removed ? adjustment.date : lastDay;
    if (activeFrom > activeThrough) throw new Error(`Loan ${loanId} has a quarter adjustment after the last activity.`);
    const events = (changes.get(loanId) ?? []).sort((a, b) => a.date.localeCompare(b.date) || a.sequence - b.sequence);
    uniqueMap(events, ({ date, sequence }) => `${date}:${sequence}`, "dated amount-change sequence");
    let runningAmount = start;
    for (const event of events) {
      if (event.date < activeFrom || event.date > activeThrough || event.before !== runningAmount || event.before === event.after) {
        throw new Error(`Loan ${loanId} has a disconnected or out-of-period amount change.`);
      }
      runningAmount = event.after;
    }
    if (runningAmount !== end) throw new Error(`Loan ${loanId} needs dated evidence for the difference between its opening or received amount and its ending or outcome amount.`);
    const startLine = added ? "AC063" : activityLines[opening ? "Beginning pipeline" : "Applications received"];
    const endLine = removed ? "AC063" : activityLines[outcome ?? "Ending pipeline"];
    column[startLine].count++;
    column[startLine].amount += start;
    column[endLine].count += removed ? -1 : 1;
    column[endLine].amount += removed ? -end : end;
    if (adjustment) jurisdiction.hasAdjustments = true;
    column.AC065 += end - start;
    loanEvidence.push({ ...reviewed, lines: [startLine, endLine], amountChangeReferences: events.map(({ reference }) => reference) });
    if (endLine === "AC070") fundedFiles.push({ loanId, state: row.state, amount: end, fundedOn: lastDay, originator: row.originator, source: reviewed.source });
    files.delete(loanId);
  }
  if (files.size) throw new Error("The evidence includes a loan missing from the saved review or marked excluded.");
  const workpaper = { form: "FV7", year: data.year, quarter: data.quarter,
    states: [...states.values()].map(({ hasAdjustments, ...values }) => ({
      ...values, adjustmentCommentary: hasAdjustments ? `See the reviewed adjustment ledger ${data.adjustmentLedgerReference}.` : "",
    })) };
  const pipeline = reconcileFv7Pipeline(workpaper);
  const fundedReview = data.fundedReview ? reconcileFv7Funded([...states.keys()], fundedFiles, data.fundedReview) : null;
  return {
    ...pipeline,
    pipelineReconciled: pipeline.reconciled,
    reconciled: pipeline.reconciled && (fundedReview?.reconciled ?? true),
    fundedReview,
    evidence: {
      entityReference: data.entityReference, snapshotSha256, version: data.version, priorEnding: data.priorEnding,
      amountChangeLedgerReference: data.amountChangeLedgerReference, adjustmentLedgerReference: data.adjustmentLedgerReference,
      files: loanEvidence, amountChanges: data.amountChanges, adjustments: data.adjustments,
    },
  };
}
