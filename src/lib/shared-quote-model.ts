import { easternDate } from "./client-retention";
import { shiftReportDate } from "./report-date-range";

const reviewPrefix = "shared-quote-review:";
export const sharedQuoteReviewTarget = "shared-quote-review";
export const sharedQuoteReviewId = (loanId: string) => reviewPrefix + loanId;
export const isSharedQuoteReview = (id: string) => id.startsWith(reviewPrefix);

export function sharedQuoteExpiry(now = new Date()) {
  const today = easternDate(now);
  return { today, suggested: shiftReportDate(today, 7), latest: shiftReportDate(today, 30) };
}

export function sharedQuoteExpired(expiresOn: string | null | undefined, now = new Date()) {
  return !!expiresOn && expiresOn < easternDate(now);
}
