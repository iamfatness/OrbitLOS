import { z } from "zod";
import type { AutomationEventType } from "./automation-event-model";

export const deliveryExceptionViews = ["attention", "waiting"] as const;
export const deliveryExceptionQuery = z.object({
  view: z.enum(deliveryExceptionViews),
  after: z.object({ sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), destinationId: z.uuid() }).optional(),
}).strict();

export type DeliveryExceptionQuery = z.infer<typeof deliveryExceptionQuery>;
export type DeliveryException = {
  eventId: string;
  destinationId: string;
  destinationName: string;
  eventType: AutomationEventType;
  failedAt: string;
  retryAt: string | null;
  status: "Retry ready" | "Retry exhausted" | "Retry scheduled" | "Destination paused";
};
export type DeliveryExceptionPage = {
  items: DeliveryException[];
  next: DeliveryExceptionQuery["after"] | null;
};
