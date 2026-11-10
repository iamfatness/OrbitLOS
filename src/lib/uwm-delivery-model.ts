import { z } from "zod";

const recordId = z.string().min(1).max(100);
const cursor = z.object({ id: z.string().min(1).max(240), receivedAt: z.iso.datetime({ offset: true }) });
export const uwmDeliveryInput = z.object({ loanId: recordId, submissionId: recordId, before: cursor.optional() });
export const uwmDeliveryUnavailable = "This mock UWM delivery timeline is unavailable.";

export type UwmDeliveryCursor = z.infer<typeof cursor>;
export type UwmDeliveryEvent = UwmDeliveryCursor & {
  title: string;
  detail: string;
  receipt: string | null;
  conditionId: string | null;
  occurredAt: string | null;
};
export type UwmDeliveryPage = { events: UwmDeliveryEvent[]; next: UwmDeliveryCursor | null };
