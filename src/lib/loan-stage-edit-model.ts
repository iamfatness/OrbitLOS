import { z } from "zod";
import { stages, type Stage } from "./model";

const revision = z.number().int().nonnegative();
const reason = z.string().trim().min(8, "Enter a reason of at least 8 characters.").max(300);
const stage = z.enum(stages);
const lockedStages = z.array(stage).max(stages.length)
  .refine((values) => new Set(values).size === values.length, "Choose each stage once.");
export const stageEditAreas = ["application", "fees"] as const;
export type StageEditArea = (typeof stageEditAreas)[number];
export const stageEditLabels = { application: "1003 changes", fees: "Quote and fee edits" } as const;
export const stageEditRules = z.object({ application: lockedStages, fees: lockedStages });
export const stageEditOverride = z.object({ revision, stage, reason });
export type StageEditOverride = z.infer<typeof stageEditOverride>;
export type StageEditRules = z.infer<typeof stageEditRules>;
export const stageEditInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("settings") }),
  z.object({ type: z.literal("loan"), loanId: z.string().min(1).max(100) }),
  z.object({ type: z.literal("publish"), revision, rules: stageEditRules, reason }),
]);
export type StageEditSettings = { kind: "settings"; revision: number; rules: StageEditRules; reason: string;
  publishedAt: string | null; publishedBy: string | null };
export type StageEditLoan = { kind: "loan"; revision: number; stage: Stage; locked: Record<StageEditArea, boolean>; canOverride: boolean };
export type StageEditResult = StageEditSettings | StageEditLoan | { error: string };
export const stageEditUnavailable = "Loan edit controls are unavailable in your workspace.";
