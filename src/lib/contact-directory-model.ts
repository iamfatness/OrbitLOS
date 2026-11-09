import { z } from "zod";
import type { Contact, Loan } from "./model";
import { contactImportRows } from "./contact-csv";

export const contactsUnavailable = "Could not load contacts. Try again.";
export const contactUnavailable = "This contact is no longer available in your workspace.";
const id = z.string().min(1).max(240);
export const contactCursor = z.object({ name: z.string().max(500), id });
const loanCursor = z.object({ createdAt: z.string().max(40), id });
export const contactDirectoryInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("list"), search: z.string().trim().max(120), role: z.literal("Realtor").optional(), after: contactCursor.optional() }),
  z.object({ type: z.literal("open"), id, after: loanCursor.optional() }),
  z.object({ type: z.literal("previewCsv"), rows: contactImportRows }),
  z.object({ type: z.literal("exportCsv") }),
]);
export type ContactRow = Pick<Contact, "id" | "name" | "role" | "email" | "phone">;
export type ContactDirectoryPage = { kind: "list"; rows: ContactRow[]; next: z.infer<typeof contactCursor> | null };
export type ContactRecord = {
  kind: "contact";
  contact: Contact;
  assignedOnly: boolean;
  loans: Pick<Loan, "id" | "purpose" | "address" | "disposition" | "stage">[];
  nextLoan?: z.infer<typeof loanCursor> | null;
};
export type ContactDirectoryResult = ContactDirectoryPage | ContactRecord | { kind: "previewCsv"; duplicates: boolean[] } |
  { kind: "exportCsv"; csv: string } | { error: string };
export type ContactMutationResult = { contactsChanged: true; contactId?: string; message: string };
