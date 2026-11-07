"use server";

import { updateWorkspace } from "@/lib/workspace-service";
import { currentStaff } from "@/lib/current-staff";

export async function mutate(input: unknown) {
  return updateWorkspace(input, await currentStaff());
}
