import type { WorkspaceStaff } from "./staff-store";
import type { SqlValue, Store } from "./store";
import { isDemoStaff } from "./workspace-access";
import { loanContactPickerInput, loanContactPickerUnavailable, type LoanContactOption, type LoanContactPage } from "./loan-contact-picker-model";
type ContactRow = { id: string; name: string; email: string; phone: string };
const pageSize = 20;
const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const digits = (text: string) => text.replace(/\D/g, "");

export function readLoanContactPicker(db: Store, input: unknown, staff: WorkspaceStaff | null): LoanContactPage | { error: string } {
  const parsed = loanContactPickerInput.safeParse(input);
  if (!parsed.success || staff?.brokerage.role === "Processor") return { error: loanContactPickerUnavailable };
  const { kind, search, selectedId, after } = parsed.data;
  const officer = staff?.brokerage.role === "LO" ? staff.email : undefined;
  const scope = `contact.role ${kind === "realtor" ? "=" : "<>"} 'Realtor' ${officer ? `AND (contact.addedBy = ? OR EXISTS (
    SELECT 1 FROM loans linked WHERE linked.contactId = contact.id AND linked.officerEmail = ?
  ) OR EXISTS (
    SELECT 1 FROM loans linked WHERE linked.partnerId = contact.id AND linked.officerEmail = ?
  ))` : ""}`;
  const scopeArgs = officer ? [officer, officer, officer] : [];
  const read = (suffix: string, ...args: SqlValue[]) => db.prepare(`SELECT contact.id, contact.name, contact.email, contact.phone
    FROM contacts contact WHERE ${scope} ${suffix}`).all(...scopeArgs, ...args) as unknown as ContactRow[];
  const selected = selectedId ? read("AND contact.id = ?", selectedId)[0] : undefined;
  const term = fold(search);
  const number = /^[+0-9().\s-]+$/.test(search) ? digits(search) : "";
  const matched: ContactRow[] = [];
  let boundary = after;
  const scanSize = term ? 250 : pageSize + 1;
  // The compact scan preserves accent-insensitive search even while the workspace search index backfills.
  while (matched.length <= pageSize) {
    const rows = read(`${boundary ? "AND contact.name COLLATE NOCASE >= ? AND (contact.name COLLATE NOCASE > ? OR contact.id > ?)" : ""}
      ORDER BY contact.name COLLATE NOCASE, contact.id LIMIT ?`, ...(boundary ? [boundary.name, boundary.name, boundary.id] : []), scanSize);
    for (const row of rows) {
      if (!term || [row.name, row.email, row.phone].some((field) => fold(field).includes(term)) || (number && digits(row.phone).includes(number))) {
        matched.push(row);
        if (matched.length > pageSize) break;
      }
    }
    if (rows.length < scanSize) break;
    boundary = rows.at(-1);
  }
  const option = ({ id, name, email, phone }: ContactRow): LoanContactOption => ({ id, name, detail: email || phone });
  const page = matched.slice(0, pageSize);
  const last = page.at(-1);
  return {
    options: page.map(option), selected: selected ? option(selected) : null,
    selectedHasLoan: Boolean(kind === "borrower" && selected && db.prepare(`SELECT 1 FROM loans WHERE contactId = ?
      ${officer ? "AND officerEmail = ?" : ""} LIMIT 1`).get(selected.id, ...(officer ? [officer] : []))),
    next: matched.length > pageSize && last ? { id: last.id, name: last.name } : null,
    officers: kind === "realtor" && !officer && isDemoStaff(staff) ?
      db.prepare("SELECT DISTINCT officer FROM loans WHERE officer <> '' ORDER BY officer").all().map(({ officer }) => String(officer)) : [],
  };
}
