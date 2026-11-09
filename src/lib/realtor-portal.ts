import { z } from "zod";
import type { Store } from "./store";
import type { RealtorReferralCursor, RealtorReferrals } from "./model";
import { borrowerJson } from "./borrower-http";
import { portalTokenPattern } from "./brokerage-model";
import { accessEvent } from "./workspace-access";
import { leadContactFields } from "./lead-inbox-model";
import { firstContactDue, leadRouting, startLeadFollowUp } from "./lead-inbox";
import type { StaffIdentity } from "./staff-store";
import { readSharedPreapprovalLetters } from "./preapproval-sharing";

export type RealtorPortalResult = { value: RealtorReferrals } | { status: number; error: string };

const token = z.string().regex(portalTokenPattern);
const referralSubmission = z.object({
  type: z.literal("submit"), token, requestId: z.uuid(),
  ...leadContactFields, consent: z.literal(true),
}).refine((value) => !!(value.email || value.phone));
const referralCursor = z.object({ at: z.string().min(1).max(80), id: z.string().min(1).max(200), source: z.enum(["loan", "referral"]) });
const portalCommand = z.union([referralSubmission, z.object({ type: z.literal("read").optional(), token, after: referralCursor.optional() })]);
const hour = 3_600_000;
const pageSize = 20;

export function saveRealtorLinkOwner(db: Store, input: { realtorId: string; token: string; revision: number }, owner: StaffIdentity | null,
  staff: StaffIdentity, now: string) {
  const email = owner?.email ?? null;
  const current = db.prepare(`SELECT portal.revision, portal.officerEmail FROM realtor_portals portal
    JOIN contacts contact ON contact.id = portal.realtorId AND contact.role = 'Realtor'
    WHERE portal.realtorId = ? AND portal.token = ? AND portal.expiresAt > ?`).get(input.realtorId, input.token, now);
  const sameOwner = current?.officerEmail === email;
  if (!current || (current.revision !== input.revision && !(sameOwner && current.revision === input.revision + 1))) {
    return { error: "This referral link changed or expired. Refresh the current routing before saving." } as const;
  }
  if (!sameOwner) {
    db.prepare("UPDATE realtor_portals SET officer = ?, officerEmail = ?, revision = revision + 1 WHERE realtorId = ?")
      .run(owner?.name.slice(0, 160) ?? "", email, input.realtorId);
    accessEvent(db, staff, "Updated realtor link routing", input.realtorId, now);
  }
  return { message: "Referral routing saved. The existing link and expiry are still active." } as const;
}

export function realtorReferrals(db: Store, input: unknown, now = new Date().toISOString(), pilot = false,
  routed?: { revision: number; linkRevision?: number; owner: StaffIdentity | null }): RealtorPortalResult {
  const parsed = portalCommand.safeParse(input);
  if (!parsed.success) return { status: 400, error: "Check your referral link and enter a name, a valid email or phone number, and permission to share." };
  const data = parsed.data;
  return db.transaction(() => {
    const portal = db.prepare(`SELECT portal.realtorId, portal.officer, portal.officerEmail, portal.revision, contacts.name
      FROM realtor_portals portal JOIN contacts ON contacts.id = portal.realtorId AND contacts.role = 'Realtor'
      WHERE token = ? AND expiresAt > ?`).get(data.token, now);
    if (!portal) return { status: 404, error: "This referral link is invalid or expired. Ask your loan officer for a new link." };

    if (data.type === "submit" && !db.prepare("SELECT 1 FROM referral_leads WHERE realtorId = ? AND requestId = ?")
      .get(portal.realtorId, data.requestId)) {
      const nowMs = Date.parse(now);
      const recent = db.prepare("SELECT count(*) AS total FROM referral_leads WHERE realtorId = ? AND createdAt > ?")
        .get(portal.realtorId, new Date(nowMs - hour).toISOString());
      if (Number(recent?.total) >= 20) return { status: 429, error: "This referral link has reached its hourly limit. Try again later." };
      const routing = leadRouting(db);
      if (routed && (routed.revision !== routing.revision ||
          (routing.realtorRoute === "Link owner" && routed.linkRevision !== portal.revision))) {
        return { status: 409, error: "Routing changed. Submit the referral again." };
      }
      const useLinkOwner = !routed && routing.realtorRoute === "Link owner";
      const id = crypto.randomUUID();
      const ownerEmail = useLinkOwner ? portal.officerEmail : routed?.owner?.email ?? null;
      db.prepare(`INSERT INTO referral_leads (id, requestId, realtorId, name, email, phone, purpose, officer, officerEmail, createdAt, dueAt, realtorSharedSince)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, data.requestId, portal.realtorId, data.name,
        data.email, data.phone, data.purpose, useLinkOwner ? portal.officer : routed?.owner?.name.slice(0, 160) ?? "",
        ownerEmail, now, firstContactDue(now, routing), ownerEmail === null ? now : null);
      startLeadFollowUp(db, id, now, data);
      if (pilot) accessEvent(db, { name: "Realtor", email: "Realtor" }, "Pilot referral received", id, now);
    }

    const after = data.type === "submit" ? undefined : data.after;
    return { value: { realtorName: String(portal.name), ...referralPage(db, String(portal.realtorId), data.token, now, after) } };
  });
}

function referralPage(db: Store, realtorId: string, token: string, now: string, after?: RealtorReferralCursor) {
  const loanCursor = after ? `AND (loan.stageSince, loan.id) ${after.source === "referral" ? "<=" : "<"} (?, ?)` : "";
  const leadCursor = after ? "AND (createdAt, id) < (?, ?)" : "";
  const pageArgs = [realtorId, ...(after ? [after.at, after.id] : []), pageSize + 1];
  const rows = db.prepare(`WITH loan_page AS MATERIALIZED (
      SELECT loan.id, coalesce(lead.name, contacts.name) AS borrowerName, loan.stage, loan.stageSince AS updatedAt, 'loan' AS source
      FROM loans loan JOIN contacts ON contacts.id = loan.contactId
      LEFT JOIN referral_leads lead ON lead.loanId = loan.id AND lead.realtorId = loan.partnerId
      WHERE loan.partnerId = ? ${loanCursor}
      ORDER BY loan.stageSince DESC, loan.id DESC LIMIT ?
    ), referral_page AS MATERIALIZED (
      SELECT id, name AS borrowerName, 'Referral received' AS stage, createdAt AS updatedAt, 'referral' AS source
      FROM referral_leads WHERE realtorId = ? AND resolvedAt IS NULL ${leadCursor}
      ORDER BY createdAt DESC, id DESC LIMIT ?
    )
    SELECT * FROM loan_page UNION ALL SELECT * FROM referral_page
    ORDER BY updatedAt DESC, id DESC, source DESC LIMIT ?`).all(...pageArgs, ...pageArgs, pageSize + 1);
  const page = rows.slice(0, pageSize);
  const letters = readSharedPreapprovalLetters(db, page.filter(({ source }) => source === "loan").map(({ id }) => String(id)), "Realtor", token, now);
  const referrals = page.map(({ id, source, borrowerName, stage, updatedAt }) => {
    const preapproval = source === "loan" ? letters.get(String(id)) : undefined;
    return { borrowerName: String(borrowerName), stage: stage as RealtorReferrals["referrals"][number]["stage"], updatedAt: String(updatedAt),
      ...(preapproval ? { preapproval } : {}) };
  });
  const last = rows.length > pageSize ? rows[pageSize - 1] : null;
  const next: RealtorReferralCursor | null = last ? { at: String(last.updatedAt), id: String(last.id), source: last.source as RealtorReferralCursor["source"] } : null;
  return { referrals, next };
}

export function realtorHttp(request: Request, run: (input: unknown) => Promise<RealtorPortalResult>) {
  return borrowerJson(request, run, 2048);
}
