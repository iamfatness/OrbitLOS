import type { BrokerageRole } from "./brokerage-model";
import { contactCsvDuplicateKeys, contactCsvHeader, contactCsvKeys, contactCsvLines, type ContactCsvFields } from "./contact-csv";
import { contactDirectoryInput, contactsUnavailable, contactUnavailable, type ContactDirectoryResult,
  type ContactRecord, type ContactRow } from "./contact-directory-model";
import { blockedOutreachKeys, outreachSuppressed } from "./outreach-preferences";
import { readBorrowerHours, readContactChannelBlocks } from "./borrower-channels";
import type { WorkspaceStaff } from "./staff-store";
import type { Store } from "./store";

export function loanScope(role: BrokerageRole, alias: "loan" | "linked") {
  if (role === "Admin") return "1";
  if (role === "LO") return `${alias}.officerEmail = actor.email`;
  return `EXISTS (SELECT 1 FROM loan_processing processing WHERE processing.loanId = ${alias}.id AND processing.processorEmail = actor.email)`;
}

export function fullContactScope(role: BrokerageRole) {
  if (role === "Admin") return "1";
  const linked = ["contactId", "partnerId"].map((field) =>
    `EXISTS (SELECT 1 FROM loans linked WHERE linked.${field} = contact.id AND ${loanScope(role, "linked")})`).join(" OR ");
  return role === "LO" ? `(contact.addedBy = actor.email OR ${linked})` : `(${linked})`;
}

export function assignedContactScope(role: BrokerageRole) {
  return role === "LO" ? `EXISTS (SELECT 1 FROM contact_activity followup
    WHERE followup.contactId = contact.id AND followup.dueAt IS NOT NULL AND followup.followUpOwnerEmail = actor.email)` : "0";
}

const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const digits = (text: string) => text.replace(/\D/g, "");
const contactFields = "contact.id, contact.name, contact.role, contact.email, contact.phone";
const contactExportByteLimit = 16_000_000;

function readContactBatch(db: Store, email: string, scope: string, after: { name: string; id: string } | undefined, limit: number) {
  return db.prepare(`SELECT ${contactFields} FROM contacts contact CROSS JOIN (SELECT ? AS email) actor
    WHERE ${scope} ${after ? "AND contact.name COLLATE NOCASE >= ? AND (contact.name COLLATE NOCASE > ? OR contact.id > ?)" : ""}
    ORDER BY contact.name COLLATE NOCASE, contact.id LIMIT ?`)
    .all(email, ...(after ? [after.name, after.name, after.id] : []), limit) as unknown as ContactRow[];
}

function* contactCsvPages(db: Store, staff: WorkspaceStaff | null) {
  const scope = fullContactScope(staff?.brokerage.role ?? "Admin");
  const limit = 1_000;
  let after: ContactRow | undefined;
  do {
    const page = readContactBatch(db, staff?.email ?? "", scope, after, limit);
    if (page.length) yield page;
    after = page.length === limit ? page.at(-1) : undefined;
  } while (after);
}

export function matchingContactCsvKeys(db: Store, rows: ContactCsvFields[], staff: WorkspaceStaff | null) {
  const wanted = new Set(rows.flatMap(contactCsvDuplicateKeys));
  const matches = new Set<string>();
  for (const page of contactCsvPages(db, staff)) {
    for (const contact of page) {
      for (const key of Object.values(contactCsvKeys(contact))) {
        if (wanted.delete(key)) matches.add(key);
      }
      if (!wanted.size) return matches;
    }
  }
  return matches;
}

function exportContacts(db: Store, staff: WorkspaceStaff | null): ContactDirectoryResult {
  const encoder = new TextEncoder();
  const csv = [contactCsvHeader];
  let bytes = contactCsvHeader.length;
  for (const contacts of contactCsvPages(db, staff)) {
    const lines = contactCsvLines(contacts);
    bytes += 2 + encoder.encode(lines).byteLength;
    if (bytes > contactExportByteLimit) return { error: "This contact directory exceeds the 16 MB CSV export limit." };
    csv.push(lines);
  }
  return { kind: "exportCsv", csv: csv.join("\r\n") };
}

function readContactRows(db: Store, { email, scope, search, after, limit }: {
  email: string; scope: string; search: string; after?: { name: string; id: string }; limit: number;
}) {
  const term = fold(search);
  const number = /^[+0-9().\s-]+$/.test(search) ? digits(search) : "";
  const matched: ContactRow[] = [];
  let boundary = after;
  const scanSize = term ? 250 : limit + 1;
  // Seek to each batch by name and ID, then match accents and formatted phone numbers in the compact rows.
  while (matched.length <= limit) {
    const rows = readContactBatch(db, email, scope, boundary, scanSize);
    for (const row of rows) {
      if (!term || [row.name, row.email, row.phone, row.role].some((field) => fold(field).includes(term)) ||
        (number && digits(row.phone).includes(number))) {
        matched.push(row);
        if (matched.length > limit) break;
      }
    }
    if (rows.length < scanSize) break;
    boundary = rows.at(-1);
  }
  const rows = matched.slice(0, limit);
  const last = rows.at(-1);
  return { rows, next: matched.length > limit && last ? { name: last.name, id: last.id } : null };
}

export function readContactRecord(db: Store, staff: WorkspaceStaff | null, id: string, options: {
  kind?: "contact" | "partner"; after?: { createdAt: string; id: string };
} = {}): ContactRecord | null {
  const { kind, after } = options;
  const role = staff?.brokerage.role ?? "Admin";
  const email = staff?.email ?? "";
  const contactId = db.prepare("SELECT canonicalId FROM contact_merges WHERE sourceId = ?").get(id)?.canonicalId ?? id;
  const scope = fullContactScope(role);
  const row = db.prepare(`SELECT ${contactFields}, ${scope} AS fullAccess
    FROM contacts contact CROSS JOIN (SELECT ? AS email) actor
    WHERE contact.id = ? ${kind ? "AND (contact.role = 'Realtor') = ?" : ""}
    AND (${scope}${kind ? ` OR ${assignedContactScope(role)}` : ""})`)
    .get(email, contactId, ...(kind ? [Number(kind === "partner")] : []));
  if (!row) return null;
  const { fullAccess, ...fields } = row;
  const contact = fields as unknown as ContactRow;
  const identity = { ...contact, contactId: contact.id };
  const optedOut = contact.role !== "Realtor" && outreachSuppressed(blockedOutreachKeys(db, [identity]), identity);
  const loanLimit = 20;
  const createdAt = "coalesce(loan.createdAt, '')";
  const linked = fullAccess ? db.prepare(`SELECT loan.id, loan.purpose, loan.address, loan.disposition, loan.stage, ${createdAt} AS createdAt
    FROM loans loan CROSS JOIN (SELECT ? AS email) actor WHERE (loan.contactId = ? OR loan.partnerId = ?)
    AND ${loanScope(role, "loan")} ${after ? `AND (${createdAt} < ? OR (${createdAt} = ? AND loan.id > ?))` : ""}
    ORDER BY createdAt DESC, loan.id LIMIT ?`)
    .all(email, contactId, contactId, ...(after ? [after.createdAt, after.createdAt, after.id] : []), loanLimit + 1) : [];
  const loans = linked.slice(0, loanLimit).map(({ id, purpose, address, disposition, stage }) =>
    ({ id, purpose, address, disposition, stage }) as ContactRecord["loans"][number]);
  const last = linked[loanLimit - 1];
  const nextLoan = linked.length > loanLimit ? { id: String(last.id), createdAt: String(last.createdAt) } : null;
  const blocked = contact.role === "Realtor" ? 0 : readContactChannelBlocks(db, contact.id);
  const hours = contact.role === "Realtor" ? null : readBorrowerHours(db, contact.id);
  return { kind: "contact", contact: { ...contact, outreachSuppressed: optedOut,
    ...(blocked ? { outreachChannelBlocks: blocked } : {}), ...(hours ? { outreachHours: hours } : {}) },
    assignedOnly: !fullAccess, loans, nextLoan };
}

export function readContactDirectory(db: Store, input: unknown, staff: WorkspaceStaff | null): ContactDirectoryResult {
  const parsed = contactDirectoryInput.safeParse(input);
  if (!parsed.success) return { error: contactsUnavailable };
  if (parsed.data.type === "open") return readContactRecord(db, staff, parsed.data.id, { after: parsed.data.after }) ?? { error: contactUnavailable };
  if (parsed.data.type === "previewCsv" || parsed.data.type === "exportCsv") {
    if (staff?.brokerage.role === "Processor") return { error: contactsUnavailable };
    if (parsed.data.type === "exportCsv") return exportContacts(db, staff);
    const matches = matchingContactCsvKeys(db, parsed.data.rows, staff);
    const duplicates = parsed.data.rows.map((row) => {
      const duplicate = contactCsvDuplicateKeys(row).some((key) => matches.has(key));
      for (const key of Object.values(contactCsvKeys(row))) if (key) matches.add(key);
      return duplicate;
    });
    return { kind: "previewCsv", duplicates };
  }
  return { kind: "list", ...readContactRows(db, { ...parsed.data, email: staff?.email ?? "",
    scope: parsed.data.role ? `contact.role = 'Realtor' AND (${fullContactScope(staff?.brokerage.role ?? "Admin")})` :
      fullContactScope(staff?.brokerage.role ?? "Admin"), limit: 30 }) };
}
