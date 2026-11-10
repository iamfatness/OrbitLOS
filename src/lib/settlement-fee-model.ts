import { z } from "zod";
import { feeCents, feeKeys, type FeeKey } from "./quote-worksheet";

const amounts = z.strictObject({
  gross: feeCents.nullable(), borrower: feeCents.nullable(), payee: z.string().trim().max(80).regex(/^[^\r\n]*$/),
});
export const settlementFeeAmounts = z.record(z.enum(feeKeys), amounts).superRefine((lines, context) => {
  for (const key of feeKeys) {
    const line = lines[key];
    if (line.gross === null ? line.borrower !== null || Boolean(line.payee) : line.borrower !== null && line.borrower > line.gross) {
      context.addIssue({ code: "custom", path: [key], message: "Enter a total fee at or above the borrower’s share." });
    }
  }
  if (!feeKeys.some((key) => lines[key].gross !== null)) {
    context.addIssue({ code: "custom", message: "Enter at least one sample settlement fee." });
  }
});

export const settlementFeeBaselineVersion = z.object({ version: z.number().int().positive(), revision: z.number().int().positive() });
export type SettlementFeeAmounts = z.infer<typeof settlementFeeAmounts>;
export type SettlementFeeBaseline = z.infer<typeof settlementFeeBaselineVersion> & {
  feeRevision: number; confirmedAt: string; confirmedBy: string; lines: SettlementFeeAmounts;
};
export type SettlementFeeStatement = { occurredOn: string; reference: string; lines: SettlementFeeAmounts };
export type SettlementFeeEvent = {
  revision: number; kind: "Statement" | "Review"; at: string; actor: string;
  fundingDate: string; statement: SettlementFeeStatement; note: string; differenceCount: number; missingCount: number;
};
export type SettlementFeeStatus = "Awaiting confirmed fees" | "Awaiting fee statement" | "Fee difference to review" |
  "Fee difference reviewed" | "More fee figures needed" | "Fees match";
export type SettlementFeeWork = {
  revision: number; baseline: SettlementFeeBaseline | null; statement: SettlementFeeStatement | null;
  status: SettlementFeeStatus; reviewed: boolean; entries: SettlementFeeEvent[]; before: number | null;
};
export const settlementFeeQueueViews = ["Fee differences", "Reviewed fee differences"] as const;
const company = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();

export function compareSettlementFees(baseline: SettlementFeeBaseline, statement: SettlementFeeStatement) {
  return feeKeys.map((key: FeeKey) => {
    const expected = baseline.lines[key], actual = statement.lines[key];
    const grossDifference = expected.gross === null || actual.gross === null ? null : actual.gross - expected.gross;
    const borrowerDifference = expected.borrower === null || actual.borrower === null ? null : actual.borrower - expected.borrower;
    const payeeChanged = Boolean(expected.payee && actual.payee && company(expected.payee) !== company(actual.payee));
    const missing = (expected.gross === null) !== (actual.gross === null) ||
      expected.borrower !== null && actual.borrower === null || Boolean(expected.payee && !actual.payee);
    return { key, expected, actual, grossDifference, borrowerDifference, payeeChanged, missing,
      different: Boolean(grossDifference || borrowerDifference || payeeChanged) };
  });
}
