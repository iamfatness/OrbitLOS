import type { Contact, ReferralLead, ReferralReview } from "./model";

export function referralPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

export function referralMatches(lead: Pick<ReferralLead, "email" | "phone">, contacts: Contact[]): ReferralReview["matches"] {
  const email = lead.email.trim().toLowerCase();
  const phone = referralPhone(lead.phone);
  return contacts.flatMap((contact) => {
    if (contact.role === "Realtor") return [];
    const emailMatch = email && email === contact.email.trim().toLowerCase();
    const phoneMatch = phone && phone === referralPhone(contact.phone);
    if (!emailMatch && !phoneMatch) return [];
    return [{ id: contact.id, name: contact.name, reason: emailMatch && phoneMatch ? "Email and phone" : emailMatch ? "Email" : "Phone" }];
  });
}
