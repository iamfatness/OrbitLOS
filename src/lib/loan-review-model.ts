import { z } from "zod";
import { filePreflightCategory, preflightKey, type FilePreflight } from "./file-preflight-model";
import { closingPackageReviewCategory, closingPackageReviewRef, type ClosingPackageReviewEvidence, type ClosingPackageReviewRef } from "./disclosure-model";

export const reviewsUnavailable = "This internal review is unavailable in your workspace.";
export const reviewCategories = ["General file review", "1003 second review", "Document checklist", "Closing readiness", filePreflightCategory, closingPackageReviewCategory] as const;
export const reviewStatuses = ["Requested", "Changes requested", "Approved", "Canceled"] as const;
export const reviewViews = ["Assigned to me", "Requested by me", "Brokerage"] as const;
export const reviewFilters = ["Open", "Overdue", "Escalated", "All"] as const;
export const reviewEvents = ["Requested", "Commented", "Approved", "Changes requested", "Reassigned", "Resubmitted", "Escalated", "Canceled",
  "Reviewer handed off", "Requester handed off"] as const;
export const reviewTarget = (id: string) => `loan-review-${id}`;
export const loanReviewsTarget = "loan-reviews";
const loanId = z.string().min(1).max(100);
const id = z.uuid();
const dueOn = z.iso.date().refine((date) => date >= "1900-01-01" && date <= "9998-12-31");
const note = z.string().trim().min(1).max(800);
const reviewerEmail = z.email().max(254);
const cursor = z.object({ id, dueOn });
const event = { loanId, id, eventId: id, note };
const change = { ...event, revision: z.number().int().positive() };
const noticeId = z.string().min(1).max(160);
const noticeCursor = z.object({ id: noticeId, at: z.iso.datetime() });

export const reviewInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("queue"), view: z.enum(reviewViews), filter: z.enum(reviewFilters), after: cursor.optional() }),
  z.object({ type: z.literal("inbox"), unread: z.boolean(), after: noticeCursor.optional() }),
  z.object({ type: z.literal("readNotice"), id: noticeId, reviewId: id }),
  z.object({ type: z.literal("loan"), loanId, focusId: id.optional(), preparePreflight: z.literal(true).optional(), prepareClosing: z.literal(true).optional() }),
  z.object({ type: z.literal("preflight"), loanId }),
  z.object({ type: z.literal("detail"), loanId, id, before: z.number().int().positive().optional() }),
  z.object({ type: z.literal("create"), loanId, id, title: z.string().trim().min(1).max(120), category: z.enum(reviewCategories),
    reviewerEmail, dueOn, note, preflightKey: preflightKey.optional(), closingPackage: closingPackageReviewRef.optional() }),
  z.object({ type: z.literal("comment"), ...event, mentionEmail: reviewerEmail.optional() }),
  z.object({ type: z.literal("decide"), ...change, decision: z.enum(["Approved", "Changes requested"]) }),
  z.object({ type: z.literal("reassign"), ...change, reviewerEmail, dueOn }),
  z.object({ type: z.literal("resubmit"), ...change, dueOn, preflightKey: preflightKey.optional(), closingPackage: closingPackageReviewRef.optional() }),
  z.object({ type: z.literal("escalate"), ...change }),
  z.object({ type: z.literal("cancel"), ...change }),
]);

export type ReviewInput = z.infer<typeof reviewInput>;
export type ReviewOffboarding = {
  type: "offboardingHandoff"; loanId: string; id: string; eventId: string; note: string; revision: number;
  participant: "Review requester" | "Reviewer"; from: string; replacement: string | null;
};
export type ReviewQueueQuery = Extract<ReviewInput, { type: "queue" }>;
export type ReviewInboxQuery = Extract<ReviewInput, { type: "inbox" }>;
export type ReviewFileInput = Exclude<ReviewInput, { type: "queue" | "inbox" | "readNotice" }>;
export type ReviewMutation = Exclude<ReviewFileInput, { type: "loan" | "detail" | "preflight" }>;
export type ReviewSummary = z.infer<typeof cursor> & { loanId: string; borrower: string; title: string; category: (typeof reviewCategories)[number];
  status: (typeof reviewStatuses)[number]; reviewerName: string; requesterName: string; escalatedAt: string | null; overdue: boolean };
export type ReviewOption = { email: string; name: string; role: "Admin" | "LO" | "Processor" };
export type ReviewDetail = ReviewSummary & { revision: number; reviewerEmail: string; applicationRevision: number | null; evidenceChanged: boolean;
  reviewerAvailable: boolean; canManage: boolean; canDecide: boolean; options: ReviewOption[]; mentionOptions: ReviewOption[]; preflight?: FilePreflight;
  closingPackage?: ClosingPackageReviewEvidence; resubmitClosingPackage?: ClosingPackageReviewRef };
export type ReviewHistoryEvent = { sequence: number; action: (typeof reviewEvents)[number]; actorName: string; note: string; context: string; at: string;
  preflight?: FilePreflight; closingPackage?: ClosingPackageReviewRef };
export type ReviewNotice = z.infer<typeof noticeCursor> & { loanId: string; reviewId: string; title: string; borrower: string;
  status: ReviewSummary["status"]; dueOn: string; label: string; actor: string | null; read: boolean };
export type ReviewResult = { kind: "queue"; reviews: ReviewSummary[]; next: z.infer<typeof cursor> | null } |
  { kind: "inbox"; notices: ReviewNotice[]; next: z.infer<typeof noticeCursor> | null } |
  { kind: "noticeRead"; loanId: string; reviewId: string } |
  { kind: "preflight"; preflight: FilePreflight; latest: (ReviewSummary & { current: boolean }) | null; canRequest: boolean } |
  { kind: "loan"; reviews: ReviewSummary[]; options: ReviewOption[]; today: string; hasMore: boolean; canReview1003: boolean;
    preflightKey?: string; closingPackage?: ClosingPackageReviewRef;
    routingBlock?: { dueOn: string | null; reason: string } } |
  { kind: "detail"; review: ReviewDetail; history: ReviewHistoryEvent[]; before: number | null; today: string } |
  { kind: "saved"; id: string; message: string } | { error: string };
