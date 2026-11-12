import { z } from "zod";
import { reportStates } from "./call-report-model";

const reference = z.string().trim().min(1).max(160);
const state = z.string().refine((value) => reportStates.includes(value));
const originator = z.string().regex(/^[1-9]\d{0,12}$/);
const channels = ["brokered", "retail", "wholesale"] as const;
const qmLines = ["AC920", "AC930", "AC940"] as const;
const forwardType = ["AC100", "AC110", "AC120", "AC130"] as const;
const forwardPurpose = ["AC300", "AC310", "AC320"] as const;
const forwardLien = ["AC500", "AC510", "AC520"] as const;
const forwardLines = [...forwardType, ...forwardPurpose, ...forwardLien] as const;
const forwardFields = { type: z.enum(forwardType), purpose: z.enum(forwardPurpose), reference };
const forwardClassification = z.discriminatedUnion("lien", [
  z.strictObject({ ...forwardFields, lien: z.enum(["AC500", "AC520"]) }),
  z.strictObject({ ...forwardFields, lien: z.literal("AC510"),
    exposureAmount: z.number().int().min(0).max(1_000_000_000), exposureReference: reference }),
]);

export const fv7FundedEvidence = z.strictObject({
  ledgerReference: reference,
  rosterReference: reference,
  forwardBreakdown: z.literal(true).optional(),
  entries: z.array(z.strictObject({
    loanId: reference,
    state,
    fundedOn: z.iso.date(),
    amount: z.number().int().min(0).max(1_000_000_000),
    originator: originator.nullable(),
    channel: z.enum(channels),
    qmLine: z.enum(qmLines),
    fundingReference: reference,
    classificationReference: reference,
    forward: forwardClassification.optional(),
  })).max(1_000),
  originators: z.array(z.strictObject({ state, originator, reference })).max(1_000),
});

type FundedEvidence = z.infer<typeof fv7FundedEvidence>;
type FundedFile = { loanId: string; state: string; fundedOn: string; amount: number; originator: string; source: "direct" | "thirdParty" };
type Totals = { count: number; amount: number };

const emptyTotals = (): Totals => ({ count: 0, amount: 0 });
function addLoan(totals: Totals, amount: number) {
  totals.count++;
  totals.amount += amount;
}

function sumTotals(values: Totals[]) {
  return values.reduce((total, value) => ({ count: total.count + value.count, amount: total.amount + value.amount }), emptyTotals());
}

function emptyState(state: string) {
  const column = () => ({ AC920: emptyTotals(), AC930: emptyTotals(), AC940: emptyTotals() });
  return {
    state, AC070BySource: { direct: emptyTotals(), thirdParty: emptyTotals() },
    channels: { brokered: column(), retail: column(), wholesale: column() },
    originators: new Map<string, Totals>(), issues: [] as string[],
  };
}

function emptyForwardState(state: string) {
  const column = () => Object.fromEntries(forwardLines.map(line => [line, emptyTotals()])) as Record<typeof forwardLines[number], Totals>;
  return { state, channels: { brokered: column(), retail: column(), wholesale: column() },
    unclassified: [] as { loanId: string; amount: number; fundingReference: string }[] };
}

export function reconcileFv7Funded(states: string[], fundedFiles: FundedFile[], evidence: FundedEvidence) {
  const workpapers = new Map(states.map((state) => [state, emptyState(state)]));
  const forwardRequested = evidence.forwardBreakdown === true || evidence.entries.some(entry => entry.forward);
  const forwardStates = new Map(forwardRequested ? states.map(state => [state, emptyForwardState(state)] as const) : []);
  const issues: string[] = [];
  const entries = new Map(evidence.entries.map((entry) => [entry.loanId, entry]));
  const rosterKey = (state: string, id: string) => `${state}:${id}`;
  const roster = new Map(evidence.originators.map((entry) => [rosterKey(entry.state, entry.originator), entry]));
  if (entries.size !== evidence.entries.length) throw new Error("Duplicate loan in the reviewed funded ledger.");
  if (roster.size !== evidence.originators.length) throw new Error("Duplicate state and MLO in the reviewed roster.");
  if (evidence.originators.some((entry) => !workpapers.has(entry.state))) throw new Error("The reviewed roster contains an out-of-scope jurisdiction.");

  const loans = [];
  for (const file of fundedFiles) {
    const workpaper = workpapers.get(file.state);
    if (!workpaper) throw new Error("A funded loan is outside the reviewed reporting jurisdictions.");
    addLoan(workpaper.AC070BySource[file.source], file.amount);
    const entry = entries.get(file.loanId);
    entries.delete(file.loanId);
    if (!entry) {
      workpaper.issues.push(`Loan ${file.loanId} is missing from the reviewed funded ledger.`);
      continue;
    }
    const snapshotId = file.originator.replace(/^0+/, "");
    const direct = file.source === "direct";
    const channelMatches = direct ? entry.channel !== "wholesale" : entry.channel === "wholesale";
    const originatorMatches = direct ? entry.originator === snapshotId : !entry.originator || entry.originator === snapshotId;
    const differences = [
      entry.state !== file.state && "reporting state", entry.fundedOn !== file.fundedOn && "funding date",
      entry.amount !== file.amount && "funded amount", !originatorMatches && "MLO ID", !channelMatches && "intake and closing channel",
    ].filter(Boolean);
    if (differences.length) {
      workpaper.issues.push(`Loan ${file.loanId} differs between the saved quarter and the funded ledger in ${differences.join(", ")}.`);
      continue;
    }
    addLoan(workpaper.channels[entry.channel][entry.qmLine], entry.amount);
    if (!direct) {
      loans.push({ ...entry, originatorReference: null });
      continue;
    }
    const staff = roster.get(rosterKey(entry.state, snapshotId));
    if (!staff) {
      workpaper.issues.push(`Loan ${file.loanId} needs reviewed MLO evidence for its reporting state.`);
      continue;
    }
    const mlo = workpaper.originators.get(snapshotId) ?? emptyTotals();
    addLoan(mlo, entry.amount);
    workpaper.originators.set(snapshotId, mlo);
    loans.push({ ...entry, originatorReference: staff.reference });
  }
  for (const loanId of entries.keys()) issues.push(`Loan ${loanId} is in the funded ledger but absent from the saved funded activity.`);
  if (forwardRequested) for (const entry of loans) {
    const forward = forwardStates.get(entry.state)!;
    if (!entry.forward) forward.unclassified.push({ loanId: entry.loanId, amount: entry.amount, fundingReference: entry.fundingReference });
    else {
      const lines = forward.channels[entry.channel];
      const classification = entry.forward;
      addLoan(lines[classification.type], entry.amount);
      addLoan(lines[classification.purpose], entry.amount);
      addLoan(lines[classification.lien], classification.lien === "AC510" ? classification.exposureAmount : entry.amount);
    }
  }

  const results = [...workpapers.values()].map(({ state, AC070BySource, channels: byChannel, originators, issues }) => {
    const channelTotals = channels.map((channel) => ({
      channel, lines: byChannel[channel], AC990: sumTotals(qmLines.map((line) => byChannel[channel][line])),
    }));
    const [brokered, retail, wholesale] = channelTotals;
    const AC070 = sumTotals(Object.values(AC070BySource));
    const AC990 = sumTotals(channelTotals.map((channel) => channel.AC990));
    const mloTotal = sumTotals([...originators.values()]);
    const matches = (actual: Totals, expected: Totals) => actual.count === expected.count && actual.amount === expected.amount;
    if (!matches(sumTotals([brokered.AC990, retail.AC990]), AC070BySource.direct)) {
      issues.push("Brokered and retail closings do not add up to direct AC070.");
    }
    if (!matches(wholesale.AC990, AC070BySource.thirdParty)) issues.push("Wholesale closings do not add up to third-party AC070.");
    if (!matches(mloTotal, AC070BySource.direct)) issues.push("The reviewed MLO totals do not add up to direct AC070.");
    return { state, AC070, AC070BySource, AC990, channels: channelTotals,
      originators: [...originators].map(([originator, totals]) => ({ originator, ...totals })), mloTotal, issues };
  });
  const reconciled = !issues.length && results.every((state) => !state.issues.length);
  const forwardResults = [...forwardStates.values()].map(({ state, channels: byChannel, unclassified }) => ({
    state, unclassified,
    channels: channels.map(channel => {
      const lines = byChannel[channel];
      return { channel, lines,
        AC190: sumTotals(forwardType.map(line => lines[line])),
        AC390: sumTotals(forwardPurpose.map(line => lines[line])),
        AC590: sumTotals(forwardLien.map(line => lines[line])) };
    }),
  }));
  return {
    reconciled,
    states: results, issues, loans, ledgerReference: evidence.ledgerReference, rosterReference: evidence.rosterReference,
    ...(forwardRequested ? { forwardBreakdown: {
      reconciled: reconciled && forwardResults.every(state => !state.unclassified.length),
      states: forwardResults,
    } } : {}),
  };
}
