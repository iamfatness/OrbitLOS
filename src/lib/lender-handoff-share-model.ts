import { z } from "zod";
import { portalAccessCodePattern, portalTokenPattern } from "./brokerage-model";
import { exportReviewedApplication } from "./lender-export-model";

const maxDocuments = 8;
const credentials = { token: z.string().regex(portalTokenPattern), code: z.string().trim().toLowerCase().regex(portalAccessCodePattern) };
const loanId = exportReviewedApplication.shape.loanId;
const shareId = z.uuid();
export const lenderShareStaffInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("read"), loanId }),
  z.object({ type: z.literal("create"), ...exportReviewedApplication.omit({ type: true, eventId: true }).shape,
    ...credentials, shareId, recipient: z.string().trim().min(2).max(120), hours: z.literal([1, 24, 72]), confirmedFictional: z.literal(true),
    documents: z.array(z.object({ id: z.uuid(), revision: z.number().int().nonnegative() })).max(maxDocuments),
  }).refine(({ documents }) => new Set(documents.map(({ id }) => id)).size === documents.length, "Choose distinct documents."),
  z.object({ type: z.literal("revoke"), loanId, shareId }),
]);

export const sharedLenderPackageInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("read"), ...credentials }),
  z.object({ type: z.literal("download"), ...credentials, slot: z.number().int().min(0).max(maxDocuments) }),
]);
export type SharedLenderPackageInput = z.infer<typeof sharedLenderPackageInput>;
export type PackageDownloadInput = Extract<SharedLenderPackageInput, { type: "download" }>;
export const lenderPackageUnavailable = "This fictional lender package is unavailable. Check the link and code or ask staff for a new package.";

export type PackageFile = { slot: number; label: string };
export type LenderPackageManifest = { recipient: string; expiresAt: string; files: PackageFile[] };
export type LenderPackageStatus = "Available" | "Revoked" | "Expired" | "File changed";
export type LenderSharePage = {
  eligible: { id: string; revision: number; label: string }[];
  shares: {
    id: string; recipient: string; createdAt: string; createdBy: string; expiresAt: string; status: LenderPackageStatus; canRevoke: boolean;
    files: (PackageFile & { downloads: number; firstDownloadedAt: string | null; lastDownloadedAt: string | null })[];
  }[];
  createdId?: string;
  message?: string;
};

export function lenderPackageFilename(slot: number) {
  return slot === 0 ? "orbit-fictional-1003.xml" : `orbit-fictional-evidence-${slot}.pdf`;
}
