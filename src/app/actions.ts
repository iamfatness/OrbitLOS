"use server";

import { updateWorkspace } from "@/lib/workspace-service";

export async function mutate(input: unknown) {
  return updateWorkspace(input);
}
