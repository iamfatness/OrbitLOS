import { demoBrokerageId } from "@/lib/brokerage-model";
import { borrowerJson } from "@/lib/borrower-http";
import { documentTemplatesUnavailable } from "@/lib/document-template-model";
import { currentStaff, workOnDocumentTemplates } from "@/lib/workspace-service";

export async function POST(request: Request) {
  const staff = await currentStaff();
  const brokerageId = new URL(request.url).searchParams.get("brokerage") ?? demoBrokerageId;
  if (brokerageId !== (staff?.brokerage.id ?? demoBrokerageId) || (!staff && process.env.NODE_ENV !== "development")) {
    return Response.json({ error: documentTemplatesUnavailable }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  return borrowerJson(request, async (input) => {
    const result = await workOnDocumentTemplates(input, staff);
    return "error" in result ? { status: 409, error: result.error } : { value: result };
  }, 16_384);
}
