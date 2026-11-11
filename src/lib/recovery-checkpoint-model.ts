import {z} from "zod";
export const checkpointCreate=z.object({id:z.uuid(),revision:z.number().int().nonnegative(),label:z.string().trim().min(3).max(100)});
export const checkpointCompare=z.object({id:z.uuid(),revision:z.number().int().nonnegative()});
export type CheckpointManifest={version:1;schema:string;tables:{name:string;rows:number;digest:string}[];kv:{keys:number;digest:string};alarm:number|null};
export type CheckpointSummary={id:string;label:string;actor:string;at:string;expiresAt:string;tables:number;rows:number};
export type CheckpointComparison={checkpoint:CheckpointSummary;at:string;revision:number;schemaChanged:boolean;kvChanged:boolean;alarmChanged:boolean;
  changed:{name:string;area:string;before:number;now:number;change:"Added"|"Removed"|"Changed"}[];unchanged:number};
export function checkpointArea(name:string) {
  if(/^(uwm|pricing|rate_|credit|aus|lender)/.test(name))return "Lender and pricing work";
  if(/^(document|processing|condition|recovery_)/.test(name))return "Documents and processing";
  if(/^(campaign|lead|contact|crm|outreach|sequence|communication|call_|realtor|referral)/.test(name))return "Relationships and follow-up";
  if(/^(application|borrower|loan|closing|disclosure|income|asset|liabilit|property|settlement)/.test(name))return "Loan files";
  if(/(history|audit|activity|event)/.test(name))return "Activity and evidence";
  return "Other workspace data";
}
