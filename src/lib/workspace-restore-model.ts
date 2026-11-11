import {z} from "zod";
import type {CheckpointComparison} from "./recovery-checkpoint-model";
export const restorePreviewInput=z.object({checkpointId:z.uuid(),revision:z.number().int().nonnegative()});
export const restoreStartInput=restorePreviewInput.extend({id:z.uuid(),fingerprint:z.string().regex(/^[a-f0-9]{64}$/),
  confirmation:z.string().min(1).max(200),note:z.string().trim().min(10).max(1000),checks:z.tuple([z.literal(true),z.literal(true),z.literal(true)])});
export type RestoreStartInput=z.infer<typeof restoreStartInput>;
export type RestoreJob={id:string;checkpointId:string;sourceCheckpointId:string;state:"Requested"|"Armed"|"Restored"|"Needs review";
  actor:string;note:string;at:string;finishedAt:string|null;message:string;cycle:string};
export type RestorePreview={comparison:CheckpointComparison;fingerprint:string;blockers:string[];documents:number;unretained:number};
export const restoreChecks=["I reviewed the affected records and understand this replaces the entire workspace database.",
  "I reviewed document availability and will preserve current access restrictions and external lender outcomes.",
  "I will verify the outcome and complete a new reopening review before staff resume work."];
