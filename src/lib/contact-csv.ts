import { z } from "zod";
import type { Contact } from "./model";
import { referralPhone } from "./referral-matches";

export const contactRoles = ["Borrower", "Co-borrower", "Realtor"] as const;
export const contactImportRow = z.object({
  name: z.string().trim().min(1).max(160),
  email: z.union([z.email().max(254), z.literal("")]),
  phone: z.string().trim().max(40),
  role: z.enum(contactRoles),
  separate: z.boolean().optional(),
});
export const contactImportLimit = 100;
export const contactImportRows = z.array(contactImportRow).min(1).max(contactImportLimit);
export type ContactImportRow = z.infer<typeof contactImportRow>;
export type ContactCsvFields = Pick<Contact, "name" | "role" | "email" | "phone">;

export function contactCsvKeys(contact: ContactCsvFields, trim = true) {
  const group = contact.role === "Realtor" ? "realtor" : "borrower";
  const email = (trim ? contact.email.trim() : contact.email).toLowerCase();
  const name = (trim ? contact.name.trim() : contact.name).toLowerCase();
  const phone = referralPhone(contact.phone);
  return { name: `${group}:name:${name}`,
    email: email ? `${group}:email:${email}` : "",
    phone: phone ? `${group}:phone:${phone}` : "" };
}

export function contactCsvDuplicateKeys(contact: ContactCsvFields) {
  const { name, email, phone } = contactCsvKeys(contact, false);
  return email || phone ? [email, phone].filter(Boolean) : [name];
}

export function contactDuplicate(row: ContactImportRow, contacts: ContactCsvFields[]) {
  const keys = contactCsvDuplicateKeys(row);
  return contacts.some((contact) => Object.values(contactCsvKeys(contact)).some((key) => keys.includes(key)));
}

export function readCsv(input: string, maximumLength = 200_000) {
  if (input.length > maximumLength) throw new Error("Choose a smaller CSV file.");
  const rows: string[][] = [];
  let fields: string[] = [];
  let value = "";
  let quoted = false;
  let closed = false;
  const csv = input.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  for (let index = 0; index <= csv.length; index++) {
    const character = csv[index] ?? "\n";
    if (quoted) {
      if (character === '"') {
        if (csv[index + 1] === '"') { value += '"'; index++; }
        else { quoted = false; closed = true; }
      } else value += character;
    } else if (character === "," || character === "\n") {
      fields.push(value.trim());
      value = "";
      closed = false;
      if (character === "\n") {
        if (fields.some(Boolean)) rows.push(fields);
        fields = [];
      }
    } else if (character === '"' && !closed && !value) quoted = true;
    else if (character === '"' || closed) throw new Error("Check the quotes around CSV fields.");
    else value += character;
  }
  if (quoted) throw new Error("Close the quoted CSV field before importing.");
  return rows;
}

export function parseContactCsv(input: string) {
  const rows = readCsv(input);
  const header = rows.shift()?.map((field) => field.toLowerCase()) ?? [];
  const position = (column: string) => header.indexOf(column);
  if (position("name") < 0 || position("role") < 0) throw new Error("Include name and role column headers.");
  if (!rows.length || rows.length > contactImportLimit) throw new Error(`Include 1 to ${contactImportLimit} contacts per file.`);
  return rows.map((row, index) => {
    const fields = {
      name: row[position("name")] ?? "",
      email: row[position("email")] ?? "",
      phone: row[position("phone")] ?? "",
      role: contactRoles.find((role) => role.toLowerCase() === row[position("role")]?.toLowerCase()),
    };
    const parsed = contactImportRow.safeParse(fields);
    if (!parsed.success || row.length > header.length) throw new Error(`Check the name, email, phone, and role on contact row ${index + 1}.`);
    return parsed.data;
  });
}

export const contactCsvHeader = "name,email,phone,role";
export function contactCsvLines(contacts: ContactCsvFields[]) {
  const cell = (value: string) => `"${(/^[\s]*[=+\-@]/.test(value) ? "'" + value : value).replaceAll('"', '""')}"`;
  return contacts.map((item) => [item.name, item.email, item.phone, item.role].map(cell).join(",")).join("\r\n");
}
