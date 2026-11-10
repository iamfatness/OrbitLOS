import { z } from "zod";

export const serviceOrderKinds = ["Appraisal", "Title", "Homeowners insurance", "Flood", "Mortgage insurance"] as const;
export const serviceOrderViews = ["Open", "Overdue", "Ready to review"] as const;
export const serviceOrderLimit = 24;
export const serviceReturnLimit = 8;
export const serviceOrderTargetPrefix = "loan-service-order-";
export const serviceOrdersTarget = "loan-service-orders";
export const serviceOrderTarget = (id: string) => serviceOrderTargetPrefix + id;
export const serviceOrdersUnavailable = "Mock service orders are available on assigned loans in fictional workspaces.";
export const serviceOrderSlug = (kind: ServiceOrder["kind"]) => kind.toLowerCase().replaceAll(" ", "-");
const id = z.string().min(1).max(100);
const orderId = z.uuid();
const dueOn = z.iso.date();
const note = z.string().trim().max(500);

export const createServiceOrder = z.strictObject({
  type: z.literal("createServiceOrder"), loanId: id, orderId, kind: z.enum(serviceOrderKinds), dueOn, note,
});
export const updateServiceOrder = z.strictObject({
  type: z.literal("updateServiceOrder"), loanId: id, orderId, revision: z.number().int().nonnegative(),
  action: z.enum(["Reschedule", "Simulate return", "Accept", "Request replacement", "Cancel"]), dueOn: dueOn.optional(), note,
}).refine((input) => input.action === "Reschedule" ? Boolean(input.dueOn) : input.dueOn === undefined,
  "Choose a due date when rescheduling an order.")
  .refine((input) => !["Request replacement", "Cancel"].includes(input.action) || input.note.length >= 3,
    "Enter an internal reason for the replacement or cancellation.");
export type ServiceOrderCommand = z.infer<typeof createServiceOrder> | z.infer<typeof updateServiceOrder>;
export type ServiceOrderStatus = "Ordered" | "Received" | "Completed" | "Cancelled";
export type ServiceOrderReturn = {
  reference: string; returnedAt: string; receivedBy: string;
  review?: { at: string; actor: string; decision: "Accepted" | "Replacement requested"; note: string };
};
export type ServiceOrder = {
  id: string; loanId: string; kind: (typeof serviceOrderKinds)[number]; status: ServiceOrderStatus;
  dueOn: string; revision: number; createdAt: string; createdBy: string; note: string;
  owner: string; returns: ServiceOrderReturn[]; cancellation: string | null;
};
export const serviceOrderQueueQuery = z.object({
  view: z.enum(serviceOrderViews),
  after: z.object({ dueOn, id: orderId }).optional(),
});
export type ServiceOrderQueueQuery = z.infer<typeof serviceOrderQueueQuery>;
export type ServiceOrderQueuePage = {
  today: string; rows: (Pick<ServiceOrder, "id" | "loanId" | "kind" | "status" | "dueOn" | "owner"> & { name: string })[];
  next: ServiceOrderQueueQuery["after"] | null;
};
