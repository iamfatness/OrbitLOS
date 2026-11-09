import { borrowerJson } from "@/lib/borrower-http";
import { conversationStartRequest, conversationsUnavailable } from "@/lib/conversation-model";
import { currentStaff, loadConversations, updateConversation } from "@/lib/workspace-service";

export async function POST(request: Request) {
  const staff = await currentStaff();
  const brokerageId = new URL(request.url).searchParams.get("brokerage");
  if (!staff || staff.brokerage.id !== brokerageId) {
    return Response.json({ error: conversationsUnavailable }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  return borrowerJson(request, async (input) => {
    const parsed = conversationStartRequest.safeParse(input);
    if (!parsed.success) return { status: 400, error: "Choose a valid conversation and queue filter." };
    const result = await updateConversation(parsed.data.start, staff);
    if ("error" in result) return { status: 409, error: result.error };
    if (!result.opened) return { status: 409, error: conversationsUnavailable };
    const queue = await loadConversations({ type: "list", ...parsed.data.queue }, staff).catch(() => null);
    return { value: { ...result, ...(queue && "kind" in queue && queue.kind === "list" ? { queue } : {}) } };
  }, 4096);
}
