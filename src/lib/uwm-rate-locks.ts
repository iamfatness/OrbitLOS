import { addApplicationActivity } from "./applications";
import { mockRateStatus, type MockLockExtensionPeriod, type MockLockPeriod, type MockUwmRate, type PricingOffer } from "./pricing-model";
import { savedPricingRun, type Store } from "./store";

type Result = { message: string } | { error: string };

function currentRate(db: Store, loanId: string) {
  return db.prepare("SELECT * FROM mock_uwm_rates WHERE loanId = ?").get(loanId) as unknown as MockUwmRate | undefined;
}

function uwmFile(db: Store, loanId: string, submissionId: string) {
  return db.prepare("SELECT externalId FROM submissions WHERE id = ? AND loanId = ? AND lender = 'UWM' AND syncedAt IS NOT NULL")
    .get(submissionId, loanId);
}

export function floatMockRate(db: Store, input: {
  loanId: string; submissionId: string; runId: string; offerId: string; previousFloatReference: string | null;
}, now: string): Result {
  const { loanId, submissionId, runId, offerId, previousFloatReference } = input;
  const previous = currentRate(db, loanId);
  const status = previous && mockRateStatus(previous, now);
  if (previous && (status === "Floating" || status === "Mock locked") && previous.submissionId === submissionId && previous.runId === runId && previous.offerId === offerId) {
    return { message: previous.lockReference ? "This sample rate already has a mock lock." : `Rate already floating · ${previous.floatReference}` };
  }
  if (status === "Mock locked") return { error: "This loan already has an active mock rate lock." };
  if ((previous?.floatReference ?? null) !== previousFloatReference) return { error: "The floating rate changed. Reopen pricing before floating another quote." };

  const file = uwmFile(db, loanId, submissionId);
  if (!file) return { error: "Select a synced UWM submission on this loan before floating a rate." };
  const run = savedPricingRun(db, loanId);
  if (run?.id !== runId || run.selectedId !== offerId || run.mode !== "mock") {
    return { error: "Save the current sample quote before floating its rate." };
  }
  const offer = (JSON.parse(String(run.offers)) as PricingOffer[]).find((item) => item.id === offerId);
  if (!offer) return { error: "This sample quote is unavailable." };

  const reference = `DEMO-FLOAT-${crypto.randomUUID().toUpperCase()}`;
  db.prepare(`INSERT INTO mock_uwm_rates (loanId, submissionId, loanNumber, runId, offerId, product, rate, quotedAt, floatReference, floatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(loanId) DO UPDATE SET submissionId = excluded.submissionId,
      loanNumber = excluded.loanNumber, runId = excluded.runId, offerId = excluded.offerId, product = excluded.product,
      rate = excluded.rate, quotedAt = excluded.quotedAt, floatReference = excluded.floatReference, floatedAt = excluded.floatedAt,
      lockReference = NULL, lockedAt = NULL, lockDays = NULL, lockExpiresAt = NULL,
      lockExtensionReference = NULL, lockExtensionDays = NULL, lockCancellationReference = NULL, lockCancelledAt = NULL`)
    .run(loanId, submissionId, file.externalId, runId, offerId, offer.product, offer.rate, run.quotedAt, reference, now);
  addApplicationActivity(db, loanId, `Rate floated with mock UWM · ${offer.product} at ${offer.rate.toFixed(3)}% · ${reference}`, now);
  return { message: "Sample rate floated with mock UWM." };
}

export function lockMockRate(db: Store, input: { loanId: string; floatReference: string; days: MockLockPeriod }, now: string): Result {
  const { loanId, floatReference, days } = input;
  const current = currentRate(db, loanId);
  if (current?.floatReference !== floatReference) return { error: "Float the current saved quote before requesting a mock lock." };
  if (current.lockCancelledAt || (current.lockExpiresAt && current.lockExpiresAt <= now)) {
    return { error: "Float the saved quote again before requesting a new mock lock." };
  }
  if (current.lockReference) return current.lockDays === days
    ? { message: `Mock lock confirmed · ${current.lockReference}` }
    : { error: "A mock lock already exists for this floating rate." };

  const run = savedPricingRun(db, loanId);
  if (run?.id !== current.runId || run.selectedId !== current.offerId || run.mode !== "mock") {
    return { error: "The saved quote changed. Float it before requesting a mock lock." };
  }
  if (uwmFile(db, loanId, current.submissionId)?.externalId !== current.loanNumber) {
    return { error: "This UWM submission is unavailable. Refresh the loan before locking the rate." };
  }

  const reference = `DEMO-LOCK-${crypto.randomUUID().toUpperCase()}`;
  const expiresAt = new Date(Date.parse(now) + days * 86_400_000).toISOString();
  db.prepare("UPDATE mock_uwm_rates SET lockReference = ?, lockedAt = ?, lockDays = ?, lockExpiresAt = ? WHERE loanId = ?")
    .run(reference, now, days, expiresAt, loanId);
  addApplicationActivity(db, loanId, `Mock UWM rate lock confirmed · ${current.rate.toFixed(3)}% for ${days} days · ${reference}`, now);
  return { message: `Mock lock confirmed · ${reference}` };
}

type LockChange = { loanId: string; lockReference: string; expectedExpiresAt: string };

export function extendMockLock(db: Store, input: LockChange & { days: MockLockExtensionPeriod }, now: string): Result {
  const { loanId, lockReference, expectedExpiresAt, days } = input;
  const rate = currentRate(db, loanId);
  if (rate?.lockReference !== lockReference) return { error: "The mock lock changed. Reopen pricing before extending it." };
  if (mockRateStatus(rate, now) !== "Mock locked") return { error: "Only an active mock lock can be extended." };

  const expiresAt = new Date(Date.parse(expectedExpiresAt) + days * 86_400_000).toISOString();
  if (rate.lockExtensionReference && rate.lockExtensionDays === days && rate.lockExpiresAt === expiresAt) {
    return { message: `Mock extension confirmed · ${rate.lockExtensionReference}` };
  }
  if (rate.lockExpiresAt !== expectedExpiresAt) return { error: "The lock expiration changed. Reopen pricing before extending it." };

  const reference = `DEMO-EXT-${crypto.randomUUID().toUpperCase()}`;
  db.prepare("UPDATE mock_uwm_rates SET lockExpiresAt = ?, lockExtensionReference = ?, lockExtensionDays = ? WHERE loanId = ?")
    .run(expiresAt, reference, days, loanId);
  addApplicationActivity(db, loanId, `Mock UWM rate lock extended · ${days} days · ${reference}`, now);
  return { message: `Mock extension confirmed · ${reference}` };
}

export function cancelMockLock(db: Store, input: LockChange, now: string): Result {
  const { loanId, lockReference, expectedExpiresAt } = input;
  const rate = currentRate(db, loanId);
  if (rate?.lockReference !== lockReference) return { error: "The mock lock changed. Reopen pricing before cancelling it." };
  if (rate.lockCancellationReference) return { message: `Mock lock cancelled · ${rate.lockCancellationReference}` };
  if (mockRateStatus(rate, now) !== "Mock locked") return { error: "Only an active mock lock can be cancelled." };
  if (rate.lockExpiresAt !== expectedExpiresAt) return { error: "The lock expiration changed. Reopen pricing before cancelling it." };

  const reference = `DEMO-CANCEL-${crypto.randomUUID().toUpperCase()}`;
  db.prepare("UPDATE mock_uwm_rates SET lockCancellationReference = ?, lockCancelledAt = ? WHERE loanId = ?").run(reference, now, loanId);
  addApplicationActivity(db, loanId, `Mock UWM rate lock cancelled · ${lockReference} · ${reference}`, now);
  return { message: `Mock lock cancelled · ${reference}` };
}
