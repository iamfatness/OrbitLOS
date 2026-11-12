import { z } from "zod";
import { reportStates } from "./call-report-model";

const maximumFieldValue = 9_999_999_999_999;
const signedInteger = z.number().int().min(-maximumFieldValue).max(maximumFieldValue);
const unsignedInteger = signedInteger.min(0);
const totals = z.strictObject({ count: unsignedInteger, amount: unsignedInteger });
const adjustment = z.strictObject({ count: signedInteger, amount: signedInteger });

const outcomeLines = ["AC030", "AC040", "AC050", "AC060"] as const;
const column = z.strictObject({
  priorEnding: totals.nullable(),
  AC010: totals.nullable(),
  AC020: totals.nullable(),
  AC030: totals.nullable(),
  AC040: totals.nullable(),
  AC050: totals.nullable(),
  AC060: totals.nullable(),
  AC063: adjustment.nullable(),
  AC065: signedInteger.nullable(),
  AC070: totals.nullable(),
  AC080: totals.nullable(),
});
const stateWorkpaper = z.strictObject({
  state: z.string().refine((state) => reportStates.includes(state), "Choose a recognized reporting jurisdiction."),
  direct: column,
  thirdParty: column,
  adjustmentCommentary: z.string().trim().max(2_000),
});
const workpaper = z.strictObject({
  form: z.literal("FV7"),
  year: z.literal(2026),
  quarter: z.number().int().min(1).max(4),
  states: z.array(stateWorkpaper).min(1).max(56),
}).superRefine(({ states }, context) => {
  const seen = new Set<string>();
  for (const [index, { state }] of states.entries()) {
    if (seen.has(state)) context.addIssue({ code: "custom", path: ["states", index, "state"], message: "Enter each jurisdiction once." });
    seen.add(state);
  }
});

function reconcileColumn(values: z.infer<typeof column>) {
  const { priorEnding, ...lines } = values;
  const { AC010, AC020, AC063, AC065, AC070, AC080 } = lines;
  const outcomes = outcomeLines.map((line) => lines[line]);
  const pipeline = AC010 && AC020 && AC063 && AC065 !== null && outcomes.every((value) => value !== null)
    ? outcomes.reduce((total, value) => ({ count: total.count - value.count, amount: total.amount - value.amount }), {
      count: AC010.count + AC020.count + AC063.count,
      amount: AC010.amount + AC020.amount + AC063.amount + AC065,
    }) : null;
  const results = AC070 && AC080 ? { count: AC070.count + AC080.count, amount: AC070.amount + AC080.amount } : null;
  const missing = Object.entries(lines).flatMap(([line, value]) => value === null ? [line] : []);
  const issues: string[] = [];
  if (missing.length) issues.push(`Missing reviewed values for ${missing.join(", ")}.`);
  if (!priorEnding) issues.push("Prior-quarter ending totals are missing.");
  else if (AC010 && (priorEnding.count !== AC010.count || priorEnding.amount !== AC010.amount)) {
    issues.push("AC010 does not match the prior-quarter ending totals.");
  }
  if (pipeline && results && (pipeline.count !== results.count || pipeline.amount !== results.amount)) {
    issues.push("AC066 and AC090 differ in count or dollars.");
  }
  for (const [line, value] of [["AC066", pipeline], ["AC090", results]] as const) {
    if (value && !totals.safeParse(value).success) issues.push(`${line} exceeds the nonnegative FV7 field range.`);
  }
  return { priorEnding, lines, calculated: { AC066: pipeline, AC090: results }, issues };
}

export function reconcileFv7Pipeline(input: unknown) {
  const parsed = workpaper.parse(input);
  const states = parsed.states.map(({ state, direct, thirdParty, adjustmentCommentary }) => {
    const issues: string[] = [];
    if (!adjustmentCommentary && [direct.AC063, thirdParty.AC063].some((entry) => entry && (entry.count !== 0 || entry.amount !== 0))) {
      issues.push("Record commentary and retain evidence for AC063 adjustments.");
    }
    return { state, direct: reconcileColumn(direct), thirdParty: reconcileColumn(thirdParty), adjustmentCommentary, issues };
  });
  return {
    form: parsed.form,
    year: parsed.year,
    quarter: parsed.quarter,
    purpose: "Internal FV7 application pipeline workpaper",
    reconciled: states.every(({ issues, direct, thirdParty }) => !issues.length && !direct.issues.length && !thirdParty.issues.length),
    states,
  };
}
