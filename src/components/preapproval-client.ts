import type { PreapprovalResult } from "@/lib/preapproval-model";

export async function preapprovalRequest(brokerageId: string, data: object, signal?: AbortSignal): Promise<PreapprovalResult> {
  const result = await fetch(`/api/preapproval-letters?brokerage=${encodeURIComponent(brokerageId)}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data), signal,
  });
  if (!result.headers.get("Content-Type")?.includes("application/json")) return { error: "Refresh the workspace and try again." };
  return result.json() as Promise<PreapprovalResult>;
}
