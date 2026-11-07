"use server";

import { currentStaff, updateWorkspace } from "@/lib/workspace-service";
import { demoBrokerageId } from "@/lib/brokerage-model";

export async function mutate(input: unknown, expectedBrokerage: string) {
  const staff = await currentStaff();
  if ((staff?.brokerage.id ?? demoBrokerageId) !== expectedBrokerage) return { error: "The workspace changed. Reload before saving." };
  return updateWorkspace(input, staff);
}
