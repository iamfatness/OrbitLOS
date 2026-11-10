import { z } from "zod";

export const filePreflightCategory = "File preflight";
export const filePreflightTarget = "file-preflight";
export const filePreflightRequestTarget = "request-file-preflight";
export const preflightFeesTarget = "preflight-fee-worksheet";
export const preflightFeeField = (field: string) => `${preflightFeesTarget}-${field}`;
export const closingDisclosureReviewTarget = "closing-disclosure-review";
export const preflightKey = z.string().regex(/^[a-f0-9]{64}$/);

export type PreflightCheck = {
  id: string;
  label: string;
  detail: string;
  state: "Ready" | "Needs attention";
  target: string;
};

export type FilePreflight = {
  key: string;
  checks: PreflightCheck[];
};

export function preflightBlocked(preflight: FilePreflight) {
  return preflight.checks.some(({ state }) => state === "Needs attention");
}
