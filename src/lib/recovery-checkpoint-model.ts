import {z} from "zod";
export const checkpointCreate=z.object({id:z.uuid(),revision:z.number().int().nonnegative(),label:z.string().trim().min(3).max(100)});
export const checkpointCompare=z.object({id:z.uuid(),revision:z.number().int().nonnegative(),offset:z.number().int().min(0).max(25000).default(0)});
export type CheckpointRecord={kind:"Loan"|"Contact"|"Lead"|"Campaign";id:string;label:string};
export type CheckpointRow={table:string;key:string;digest:string;record:string|null};
export type CheckpointImpact={version:1;records:CheckpointRecord[];rows:CheckpointRow[];parts?:number};
export type CheckpointImpactReview={records:(CheckpointRecord&{effect:"Would remove"|"Would restore"|"Would change";added:number;removed:number;changed:number})[];
  total:number;offset:number;next:number|null;unlinked:number;added:number;removed:number;changed:number};
export type CheckpointManifest={version:1;schema:string;tables:{name:string;rows:number;digest:string}[];kv:{keys:number;digest:string};alarm:number|null;files?:CheckpointFiles;impact?:CheckpointImpact};
export type CheckpointSummary={id:string;label:string;actor:string;at:string;expiresAt:string;tables:number;rows:number};
export type CheckpointComparison={checkpoint:CheckpointSummary;at:string;revision:number;schemaChanged:boolean;kvChanged:boolean;alarmChanged:boolean;
  changed:{name:string;area:string;before:number;now:number;change:"Added"|"Removed"|"Changed"}[];unchanged:number;impact:CheckpointImpactReview|null};
export function checkpointArea(name:string) {
  if(/^(uwm|pricing|rate_|credit|aus|lender)/.test(name))return "Lender and pricing work";
  if(/^(document|processing|condition|recovery_)/.test(name))return "Documents and processing";
  if(/^(campaign|lead|contact|crm|outreach|sequence|communication|call_|realtor|referral)/.test(name))return "Relationships and follow-up";
  if(/^(application|borrower|loan|closing|disclosure|income|asset|liabilit|property|settlement)/.test(name))return "Loan files";
  if(/(history|audit|activity|event)/.test(name))return "Activity and evidence";
  return "Other workspace data";
}

export type CheckpointFiles={references:number;unretained:number;items:{objectId:string;bytes:number;sha256:string}[]};
