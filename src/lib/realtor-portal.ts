import { z } from "zod";
import type { Store } from "./store";
import type { RealtorReferrals, Stage } from "./model";
import { borrowerJson } from "./borrower-http";

export type RealtorPortalResult = { value: RealtorReferrals } | { status: number; error: string };

export function realtorReferrals(db: Store, input: unknown, now = new Date().toISOString()): RealtorPortalResult {
  const parsed = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }).safeParse(input);
  if (!parsed.success) return { status: 400, error: "Open the complete referral link from your loan officer." };
  const portal = db.prepare(`SELECT portal.realtorId, contacts.name FROM realtor_portals portal
    JOIN contacts ON contacts.id = portal.realtorId AND contacts.role = 'Realtor'
    WHERE token = ? AND expiresAt > ?`).get(parsed.data.token, now);
  if (!portal) return { status: 404, error: "This referral link is invalid or expired. Ask your loan officer for a new link." };
  const referrals = db.prepare(`SELECT contacts.name AS borrowerName, loans.stage, loans.stageSince AS updatedAt
    FROM loans JOIN contacts ON contacts.id = loans.contactId
    WHERE loans.partnerId = ? ORDER BY loans.stageSince DESC, loans.id`).all(portal.realtorId)
    .map((row) => ({ borrowerName: String(row.borrowerName), stage: row.stage as Stage, updatedAt: String(row.updatedAt) }));
  return { value: { realtorName: String(portal.name), referrals } };
}

export function realtorHttp(request: Request, run: (input: unknown) => Promise<RealtorPortalResult>) {
  return borrowerJson(request, run, 2048);
}
