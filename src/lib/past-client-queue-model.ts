import { z } from "zod";
import type { Loan, PastClientProfile } from "./model";

export const pastClientViews = ["All clients", "Anniversaries", "Rate watchlist"] as const;
export const pastClientsUnavailable = "Could not load past clients. Try again.";
const cursor = z.object({ rank: z.string().max(10), stageSince: z.string().min(1).max(40), id: z.string().min(1).max(100) });
export const pastClientInput = z.object({ view: z.enum(pastClientViews), query: z.string().trim().max(160), after: cursor.optional() });
export type PastClientQuery = z.infer<typeof pastClientInput>;
export type ReturningClientOption = { kind: "start" } | { kind: "open"; loanId: string } | { kind: "restricted" } | { kind: "unavailable" };
export type PastClientRow = Pick<Loan, "id" | "stage" | "address" | "officer"> & {
  contactId: string | null; borrower: string | null; anniversary: string; reached: boolean; repeat: ReturningClientOption["kind"];
  profile: Pick<PastClientProfile, "closingDate" | "watchEnabled" | "currentRate" | "targetRate" | "observedRate" | "checkedAt">;
};
export type PastClientPage = {
  rows: PastClientRow[]; next: z.infer<typeof cursor> | null;
  totals?: { clients: number; withDate: number; watched: number; reached: number };
};
