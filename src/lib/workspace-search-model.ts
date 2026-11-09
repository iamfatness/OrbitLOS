import { z } from "zod";
import type { LeadWorkRecord } from "./lead-work-model";
import type { ContactRecord } from "./contact-directory-model";

export const searchUnavailable = "Workspace search is unavailable in this brokerage.";
export const searchRecordUnavailable = "This search result is no longer available in your workspace.";
export const searchKinds = ["loan", "lead", "contact", "partner", "task", "document", "conversation"] as const;
export const searchLabels = { loan: "Loan", lead: "Lead", contact: "Contact", partner: "Realtor partner",
  task: "Loan task", document: "Document request", conversation: "Conversation" } as const;
export const searchFilters = ["All records", "Loans", "Leads", "Contacts", "Realtor partners", "Tasks", "Documents", "Conversations"] as const;
const id = z.string().min(1).max(240);
const cursor = z.object({ kind: z.enum(searchKinds), title: z.string().max(500), id });
export const workspaceSearchInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("search"), query: z.string().trim().max(100), filter: z.enum(searchFilters), after: cursor.optional() }),
  z.object({ type: z.literal("open"), kind: z.enum(["lead", "contact", "partner"]), id }),
]);

export type SearchInput = z.infer<typeof workspaceSearchInput>;
export type SearchQuery = Extract<SearchInput, { type: "search" }>;
export type SearchRecord = z.infer<typeof cursor> & { detail: string; loanId: string | null };
export type SearchPage = { kind: "results"; rows: SearchRecord[]; next: z.infer<typeof cursor> | null; indexing: boolean };
export type SearchContact = ContactRecord;
export type SearchResult = SearchPage | SearchContact | ({ kind: "lead" } & LeadWorkRecord) | { error: string };

export const searchTaskTarget = (id: string) => `loan-task-${id}`;
