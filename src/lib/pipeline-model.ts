import { z } from "zod";
import { stages, type Loan, type Stage } from "./model";
import { workFilters, type loanNextAction } from "./loan-workflow";

export const pipelineUnavailable = "The pipeline could not be loaded.";
const id = z.string().min(1).max(100);
const cursor = z.object({ stageSince: z.string().min(1).max(64), id });
const filters = z.object({
  stage: z.enum(["", ...stages]), lender: z.string().max(140), officer: z.string().max(160), partner: z.string().max(100),
  days: z.enum(["", "3", "7", "14"]), work: z.enum(["", ...workFilters]),
});
export type PipelineFilters = z.infer<typeof filters>;
export const emptyPipelineFilters: PipelineFilters = { stage: "", lender: "", officer: "", partner: "", days: "", work: "" };
export const pipelineQuery = z.object({
  view: z.enum(["Board", "List"]), search: z.string().trim().max(200), filters,
  after: cursor.optional(), lane: z.enum(stages).optional(),
}).refine(({ view, lane, after, filters }) => view === "List" ? !lane : Boolean(after) === Boolean(lane) && (!lane || !filters.stage || filters.stage === lane));
export type PipelineQuery = z.infer<typeof pipelineQuery>;
export type PipelineCursor = z.infer<typeof cursor>;
export type PipelineLoan = Pick<Loan, "id" | "address" | "officer" | "amount" | "purpose" | "stage" | "stageSince" | "disposition"> & {
  name: string; lenders: string[]; openConditions: number; action: ReturnType<typeof loanNextAction>;
};
export type PipelinePage = {
  metrics: { total: number; active: number; volume: number; openConditions: number };
  matches: number;
  options: { lenders: string[]; officers: string[]; partners: { id: string; name: string }[] };
  lanes: { stage: Stage; count: number; volume: number; loans: PipelineLoan[]; next: PipelineCursor | null }[];
  list: { loans: PipelineLoan[]; next: PipelineCursor | null };
};
