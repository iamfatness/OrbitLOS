import { z } from "zod";
import type { TridEntry } from "./trid-model";

export const michiganBookletAuthority = "https://legislature.mi.gov/Laws/MCL?objectName=mcl-445-1636";
export const michiganBookletGuidance = "https://www.michigan.gov/difs/news-and-outreach/faq/consumer-finance/consumer-mort-protection-act";
export const michiganApplicationChannels = ["In person", "Phone", "Website", "Through a broker", "Other or unresolved"] as const;
export const michiganBookletMethods = ["In person", "Electronic", "Mail", "Other or unresolved"] as const;
const date = z.iso.date().refine(value => value >= "2022-01-01" && value <= "2099-12-31", "Enter a date from 2022 through 2099.");
const reference = z.string().trim().min(1).max(180);
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Enter a local time in hours and minutes.").optional();

export const michiganBookletReview = z.strictObject({
  type: z.literal("miBookletReview"),
  applicability: z.enum(["Covered application for review", "Unresolved"]),
  channel: z.enum(michiganApplicationChannels),
  on: date,
  localTime: time,
  reference,
  delivery: z.strictObject({
    on: date,
    localTime: time,
    method: z.enum(michiganBookletMethods),
    provider: z.enum(["Broker", "Lender", "Other or unresolved"]),
    edition: reference,
    reference,
  }).optional(),
});
export type MichiganBookletReview = z.infer<typeof michiganBookletReview>;

export function reviewMichiganBooklet(active: readonly TridEntry[]) {
  const record = active.find(entry => entry.event.type === "miBookletReview");
  if (!record || record.event.type !== "miBookletReview") return null;
  const event = record.event;
  const { delivery } = event;
  const issues: string[] = [];
  if (event.applicability === "Unresolved") issues.push("Confirm Michigan coverage and the responsible parties.");
  if (event.channel === "Other or unresolved") issues.push("Confirm the application channel.");
  if (!delivery) {
    issues.push("Record the booklet version and evidence it was provided to the applicant.");
    return { sequence: record.sequence, chronology: "Delivery not documented", issues };
  }
  if (delivery.provider === "Other or unresolved" || delivery.method === "Other or unresolved")
    issues.push("Confirm who provided the booklet and how.");
  if (delivery.on === event.on && (!delivery.localTime || !event.localTime)) {
    issues.push("Review when the booklet was provided. The dates alone do not establish timing.");
    return { sequence: record.sequence, chronology: "Same date, order unresolved", issues };
  }
  const applied = `${event.on}T${event.localTime ?? "00:00"}`;
  const provided = `${delivery.on}T${delivery.localTime ?? "00:00"}`;
  if (provided > applied) issues.push("Review the interval and the application channel with counsel.");
  const chronology = provided > applied ? "Recorded after application" :
    provided < applied ? "Recorded before application" : "Same recorded minute";
  return { sequence: record.sequence, chronology, issues };
}
