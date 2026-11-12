import { z } from "zod";

const recoveryDeadlineCommand = z.object({type:z.literal("setDocumentDeadline"),loanId:z.string().min(1).max(200),
  requestId:z.uuid(),revision:z.number().int().nonnegative(),deadlineRevision:z.number().int().nonnegative(),dueOn:z.iso.date().nullable()});
const recoveryClosingCommand = z.object({type:z.literal("completeClosingItem"),loanId:z.string().min(1).max(100),
  itemId:z.string().min(1).max(100),revision:z.number().int().positive(),completed:z.boolean()});
export const recoveryCommand = z.discriminatedUnion("type", [recoveryDeadlineCommand, recoveryClosingCommand]);
export type RecoveryCommand = z.infer<typeof recoveryCommand>;
export const recoveryDocument = z.object({id:z.uuid(),revision:z.number().int().nonnegative(),deadlineRevision:z.number().int().nonnegative(),
  dueOn:z.iso.date().nullable(),status:z.string().max(40)});
export type RecoveryDocument = z.infer<typeof recoveryDocument>;
export const recoveryClosingItem = z.object({id:z.string().min(1).max(100),revision:z.number().int().positive(),completedAt:z.iso.datetime().nullable()});
const recoveryState = z.union([recoveryDocument, recoveryClosingItem]);
export type RecoveryState = z.infer<typeof recoveryState>;
const recoveryLabel = z.object({recordName:z.string().max(200),label:z.string().max(120)});
export const recoveryIntent = z.union([
  recoveryLabel.extend({command:recoveryDeadlineCommand,before:recoveryDocument}),
  recoveryLabel.extend({command:recoveryClosingCommand,before:recoveryClosingItem}),
]);
export type RecoveryIntent = z.infer<typeof recoveryIntent>;
export const recoveryProof = z.object({id:z.string().regex(/^[a-f0-9]{64}$/),before:recoveryState,after:recoveryState,at:z.iso.datetime()});
export type RecoveryProof = z.infer<typeof recoveryProof>;
export type RecoveryEdit = RecoveryIntent & {id:string;actor:string;actorEmail:string;at:string;state:"Pending"|"Recorded"|"Rejected"|"Reviewed";proof:RecoveryProof|null;
  review:{note:string;actor:string;at:string}|null};
export const recoveryEditPage = z.object({revision:z.number().int().nonnegative(),offset:z.number().int().min(0).max(1000000).default(0),
  pendingOnly:z.boolean().optional()});
export const recoveryEditReview = recoveryEditPage.extend({id:z.string().regex(/^[a-f0-9]{64}$/),fingerprint:z.string().regex(/^[a-f0-9]{64}$/),note:z.string().trim().min(20).max(1000)});
export const recoveryReplayInput=z.union([recoveryEditReview,recoveryEditReview.pick({id:true}).extend({resume:z.literal(true)})]);
export type RecoveryReplay = {id:string;editId:string;cycle:string;state:"Pending"|"Applied"|"Not applied";actor:string;note:string;at:string;finishedAt:string|null;result:string|null};
export type RecoveryEditInspection = {pendingReplay?:{editId:string;recordName:string;label:string}|null;revision:number;offset:number;total:number;next:number|null;pendingOnly?:boolean;items:(RecoveryEdit & {
  current:RecoveryState|null;sourceProof:RecoveryProof|null;finding:"Saved revision present"|"Original revision present"|"Different revision present"|"Record unavailable";
  fingerprint:string;canConfirm:boolean;canReplay:boolean;replay:RecoveryReplay|null})[]};
export function sameRecoveryState(a:RecoveryState|null,b:RecoveryState|null) {
  if (!a || !b || a.id !== b.id || a.revision !== b.revision) return false;
  if ("completedAt" in a) return "completedAt" in b && a.completedAt === b.completedAt;
  return "deadlineRevision" in b && a.deadlineRevision === b.deadlineRevision && a.dueOn === b.dueOn && a.status === b.status;
}
export function expectedRecoveryDocument(intent:{before:RecoveryDocument;command:z.infer<typeof recoveryDeadlineCommand>}):RecoveryDocument {
  return {...intent.before,dueOn:intent.command.dueOn,deadlineRevision:intent.before.deadlineRevision+1};
}
export function expectedRecoveryState(intent:RecoveryIntent, at:string|null):RecoveryState|null {
  const {command,before} = intent;
  if (command.type === "setDocumentDeadline" && "deadlineRevision" in before) return expectedRecoveryDocument({command,before});
  if (command.type === "completeClosingItem" && "completedAt" in before && (!command.completed || at)) {
    return {...before,revision:before.revision+1,completedAt:command.completed?at:null};
  }
  return null;
}
