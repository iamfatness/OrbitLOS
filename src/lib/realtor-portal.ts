import { z } from "zod";
import type { Store } from "./store";
import type { RealtorReferrals } from "./model";
import { borrowerJson } from "./borrower-http";
import { portalTokenPattern } from "./brokerage-model";
import { referralPhone } from "./referral-matches";
import { accessEvent } from "./workspace-access";

export type RealtorPortalResult = { value: RealtorReferrals } | { status: number; error: string };

const token = z.string().regex(portalTokenPattern);
const referralSubmission = z.object({
  type: z.literal("submit"), token, requestId: z.uuid(),
  name: z.string().trim().min(1).max(160),
  email: z.string().trim().max(160).refine((value) => !value || z.email().safeParse(value).success),
  phone: z.string().trim().max(40).refine((value) => !value || /^[+\d().\s-]+$/.test(value) && /^\d{10,15}$/.test(referralPhone(value))),
  purpose: z.enum(["Purchase", "Refinance"]), consent: z.literal(true),
}).refine((value) => !!(value.email || value.phone));
const portalCommand = z.union([referralSubmission, z.object({ type: z.literal("read").optional(), token })]);
const hour = 3_600_000;

export function realtorReferrals(db: Store, input: unknown, now = new Date().toISOString(), pilot = false): RealtorPortalResult {
  const parsed = portalCommand.safeParse(input);
  if (!parsed.success) return { status: 400, error: "Check your referral link and enter a name, a valid email or phone number, and permission to share." };
  const data = parsed.data;
  return db.transaction(() => {
    const portal = db.prepare(`SELECT portal.realtorId, portal.officer, portal.officerEmail, contacts.name
      FROM realtor_portals portal JOIN contacts ON contacts.id = portal.realtorId AND contacts.role = 'Realtor'
      WHERE token = ? AND expiresAt > ?`).get(data.token, now);
    if (!portal) return { status: 404, error: "This referral link is invalid or expired. Ask your loan officer for a new link." };

    if (data.type === "submit" && !db.prepare("SELECT 1 FROM referral_leads WHERE realtorId = ? AND requestId = ?")
      .get(portal.realtorId, data.requestId)) {
      const nowMs = Date.parse(now);
      const recent = db.prepare("SELECT count(*) AS total FROM referral_leads WHERE realtorId = ? AND createdAt > ?")
        .get(portal.realtorId, new Date(nowMs - hour).toISOString());
      if (Number(recent?.total) >= 20) return { status: 429, error: "This referral link has reached its hourly limit. Try again later." };
      const id = crypto.randomUUID();
      db.prepare(`INSERT INTO referral_leads (id, requestId, realtorId, name, email, phone, purpose, officer, officerEmail, createdAt, dueAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, data.requestId, portal.realtorId, data.name,
        data.email, data.phone, data.purpose, portal.officer, portal.officerEmail, now, new Date(nowMs + 24 * hour).toISOString());
      if (pilot) accessEvent(db, { name: "Realtor", email: "Realtor" }, "Pilot referral received", id, now);
    }

    const referrals = db.prepare(`SELECT loans.id, COALESCE(lead.name, contacts.name) AS borrowerName, loans.stage, loans.stageSince AS updatedAt
      FROM loans JOIN contacts ON contacts.id = loans.contactId
      LEFT JOIN referral_leads lead ON lead.loanId = loans.id AND lead.realtorId = loans.partnerId
      WHERE loans.partnerId = ?
      UNION ALL
      SELECT id, name AS borrowerName, 'Referral received' AS stage, createdAt AS updatedAt
      FROM referral_leads WHERE realtorId = ? AND resolvedAt IS NULL
      ORDER BY updatedAt DESC, id`).all(portal.realtorId, portal.realtorId)
      .map((row) => ({ borrowerName: String(row.borrowerName),
        stage: row.stage as RealtorReferrals["referrals"][number]["stage"], updatedAt: String(row.updatedAt) }));
    return { value: { realtorName: String(portal.name), referrals } };
  });
}

export function realtorHttp(request: Request, run: (input: unknown) => Promise<RealtorPortalResult>) {
  return borrowerJson(request, run, 2048);
}
