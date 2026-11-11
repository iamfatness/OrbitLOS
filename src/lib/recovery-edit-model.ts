import { z } from "zod";

export const recoveryDeadlineCommand = z.object({type:z.literal("setDocumentDeadline"),loanId:z.string().min(1).max(200),
  requestId:z.uuid(),revision:z.number().int().nonnegative(),deadlineRevision:z.number().int().nonnegative(),dueOn:z.iso.date().nullable()});
export const recoveryDocument = z.object({id:z.uuid(),revision:z.number().int().nonnegative(),deadlineRevision:z.number().int().nonnegative(),
  dueOn:z.iso.date().nullable(),status:z.string().max(40)});
export type RecoveryDocument = z.infer<typeof recoveryDocument>;
export const recoveryIntent = z.object({command:recoveryDeadlineCommand,before:recoveryDocument,recordName:z.string().max(200),label:z.string().max(100)});
export type RecoveryIntent = z.infer<typeof recoveryIntent>;
export const recoveryProof = z.object({id:z.string().regex(/^[a-f0-9]{64}$/),before:recoveryDocument,after:recoveryDocument,at:z.iso.datetime()});
export type RecoveryProof = z.infer<typeof recoveryProof>;
export type RecoveryEdit = RecoveryIntent & {id:string;actor:string;actorEmail:string;at:string;state:"Pending"|"Recorded"|"Rejected"|"Reviewed";proof:RecoveryProof|null;
  review:{note:string;actor:string;at:string}|null};
export const recoveryEditPage = z.object({revision:z.number().int().nonnegative(),offset:z.number().int().min(0).max(1000000).default(0)});
export const recoveryEditReview = recoveryEditPage.extend({id:z.string().regex(/^[a-f0-9]{64}$/),fingerprint:z.string().regex(/^[a-f0-9]{64}$/),note:z.string().trim().min(20).max(1000)});
export type RecoveryEditInspection = {revision:number;offset:number;total:number;next:number|null;items:(RecoveryEdit & {
  current:RecoveryDocument|null;sourceProof:RecoveryProof|null;finding:"Saved revision present"|"Original revision present"|"Different revision present"|"Record unavailable";
  fingerprint:string;canConfirm:boolean})[]};
export const sameRecoveryDocument=(a:RecoveryDocument|null,b:RecoveryDocument|null)=>!!a&&!!b&&
  a.id===b.id&&a.revision===b.revision&&a.deadlineRevision===b.deadlineRevision&&a.dueOn===b.dueOn&&a.status===b.status;
export function expectedRecoveryDocument(intent:RecoveryIntent):RecoveryDocument {
  return {...intent.before,dueOn:intent.command.dueOn,deadlineRevision:intent.before.deadlineRevision+1};
}
