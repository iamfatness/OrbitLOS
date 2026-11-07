import { z } from "zod";

export const processingStatuses = ["Unassigned", "Assigned", "Ready for processing", "In processing", "Returned to LO", "Complete"] as const;
export type ProcessingStatus = (typeof processingStatuses)[number];
export const processingActions = ["Send to processing", "Accept handoff", "Return to LO", "Complete handoff"] as const;
export type ProcessingAction = (typeof processingActions)[number];

export interface LoanProcessing {
  loanId: string;
  processorEmail: string | null;
  processorName: string;
  status: ProcessingStatus;
  note: string;
  updatedAt: string;
  revision: number;
}

export const updateProcessingInput = z.object({
  type: z.literal("updateProcessing"), loanId: z.string().min(1).max(100), revision: z.number().int().positive(),
  action: z.enum(processingActions), note: z.string().trim().max(500),
});

export function availableProcessingActions(status: ProcessingStatus, role: "Admin" | "LO" | "Processor"): ProcessingAction[] {
  if (status === "Unassigned") return [];
  if (status === "Ready for processing") return role !== "LO" ? ["Accept handoff"] : [];
  if (status === "In processing") return role !== "LO" ? ["Return to LO"] : [];
  if (role === "Processor") return [];
  if (status === "Returned to LO") return ["Complete handoff", "Send to processing"];
  return ["Send to processing"];
}
