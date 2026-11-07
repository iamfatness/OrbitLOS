import { z } from "zod";
import { contactRoles, readCsv } from "./contact-csv";
import { leadSources } from "./model";

export const migrationColumns = ["type", "externalId", "parentId", "name", "email", "phone", "role", "ownerEmail",
  "purpose", "source", "zip", "createdAt", "dueAt", "completedAt", "text"] as const;
export type MigrationColumn = (typeof migrationColumns)[number];
export const requiredMigrationColumns: MigrationColumn[] = ["type", "externalId"];
export const migrationTypes = ["Contact", "Lead", "Note", "Task"] as const;
const externalId = z.string().trim().regex(/^[a-zA-Z0-9_.:@-]{1,100}$/, "Use a stable source ID with letters, numbers, or ._:@-.");
const name = z.string().trim().min(1).max(160);
const email = z.union([z.literal(""), z.email().max(160)]);
const date = z.union([z.iso.date(), z.iso.datetime({ offset: true })]);
const optionalDate = z.union([z.literal(""), date]);
const identity = { externalId, name, email, phone: z.string().trim().max(40) };
const migrationRow = z.discriminatedUnion("type", [
  z.object({ type: z.literal("Contact"), ...identity, role: z.enum(contactRoles) }),
  z.object({ type: z.literal("Lead"), ...identity, parentId: z.union([z.literal(""), externalId]), ownerEmail: email,
    purpose: z.enum(["Purchase", "Refinance"]), source: z.enum(leadSources), zip: z.string().regex(/^([0-9]{5})?$/),
    createdAt: date, dueAt: optionalDate }),
  z.object({ type: z.literal("Note"), externalId, parentId: externalId, createdAt: date, text: z.string().trim().min(1).max(1800) }),
  z.object({ type: z.literal("Task"), externalId, parentId: externalId, dueAt: date, completedAt: optionalDate, text: z.string().trim().min(1).max(120) }),
]);
export type MigrationRow = z.infer<typeof migrationRow>;
export const migrationKey = (row: MigrationRow) => `${row.type}:${row.externalId}`;
export const migrationInput = z.object({
  type: z.literal("migratePipeline"), origin: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9_-]{0,59}$/, "Enter a source key such as salesforce-demo."),
  rows: z.array(migrationRow).min(1).max(100),
  decisions: z.record(z.string().max(108), z.string().max(120)),
  preview: z.string().length(64).optional(),
});
export type MigrationInput = z.infer<typeof migrationInput>;

export interface MigrationReport {
  fingerprint: string;
  rows: {
    key: string;
    label: string;
    status: "Create" | "Reuse contact" | "Previously imported" | "Skipped" | "Review";
    detail: string;
    targetId?: string;
    matches?: { id: string; label: string }[];
  }[];
}

const aliases: Partial<Record<MigrationColumn, string[]>> = {
  type: ["record type", "object"], externalId: ["id", "record id", "source id"], parentId: ["parent", "related to id", "related id", "contact id"],
  name: ["full name"], ownerEmail: ["owner email", "assigned to"], createdAt: ["created date", "created"],
  dueAt: ["due date", "due"], completedAt: ["completed date"], text: ["body", "subject", "description"], zip: ["postal code", "zipcode"],
};
const normalizeHeader = (value: string) => value.toLowerCase().replace(/[\s_-]/g, "");

export function migrationFile(input: string) {
  const [header, ...rows] = readCsv(input);
  if (!header || !rows.length || rows.length > 100 || rows.some((row) => row.length > header.length)) {
    throw new Error("Include a header and 1 to 100 records with the same column layout.");
  }
  const mapping: Partial<Record<MigrationColumn, number>> = {};
  for (const column of migrationColumns) {
    const names = [column, ...aliases[column] ?? []].map(normalizeHeader);
    const index = header.findIndex((value) => names.includes(normalizeHeader(value)));
    if (index >= 0) mapping[column] = index;
  }
  return { header, rows, mapping };
}

export function mappedMigrationRows(file: ReturnType<typeof migrationFile>, mapping: ReturnType<typeof migrationFile>["mapping"]) {
  if (requiredMigrationColumns.some((column) => mapping[column] === undefined)) throw new Error("Map the record type and external ID columns.");
  const usedColumns = Object.values(mapping);
  if (new Set(usedColumns).size !== usedColumns.length) throw new Error("Map each CSV column to one field.");
  return file.rows.map((row, index) => {
    const value = (column: MigrationColumn) => row[mapping[column] ?? -1] ?? "";
    const pick = (values: readonly string[], column: MigrationColumn, fallback: string) =>
      values.find((item) => item.toLowerCase() === value(column).toLowerCase()) ?? (value(column) || fallback);
    const parsed = migrationRow.safeParse({
      ...Object.fromEntries(migrationColumns.map((column) => [column, value(column)])),
      type: pick(migrationTypes, "type", ""), role: pick(contactRoles, "role", "Borrower"),
      purpose: pick(["Purchase", "Refinance"], "purpose", "Purchase"), source: pick(leadSources, "source", "Imported CRM"),
      ownerEmail: value("ownerEmail").toLowerCase(),
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new Error(`CSV record ${index + 1} · ${issue.path.join(".")}: ${issue.message}`);
    }
    return parsed.data;
  });
}

export const migrationExample = [
  "record type,record id,parent id,full name,email,phone,role,owner email,purpose,source,postal code,created date,due date,completed date,description",
  "Contact,C-101,,Casey Example,casey@example.test,,Borrower,,,,,,,,",
  "Lead,L-101,C-101,Casey Example,casey@example.test,,,,Purchase,Imported CRM,48304,2026-10-01,2026-10-02,,",
  "Note,N-101,L-101,,,,,,,,,2026-10-01,,,Fictional buyer asked for a purchase quote.",
  "Task,T-101,L-101,,,,,,,,,,2026-10-03,,Follow up on the purchase timeline",
].join("\r\n");
