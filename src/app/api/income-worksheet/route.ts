import { demoBrokerageId } from "@/lib/brokerage-model";
import { borrowerJson } from "@/lib/borrower-http";
import { incomeReviewUnavailable } from "@/lib/income-review-model";
import { currentStaff, workOnIncomeWorksheet } from "@/lib/workspace-service";

export async function POST(request: Request) {
  const staff = await currentStaff();
  const brokerageId = new URL(request.url).searchParams.get("brokerage") ?? demoBrokerageId;
  if (brokerageId !== (staff?.brokerage.id ?? demoBrokerageId) || (!staff && process.env.NODE_ENV !== "development")) {
    return Response.json({ error: incomeReviewUnavailable }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  return borrowerJson(request, async (input) => {
    const result = await workOnIncomeWorksheet(input, staff);
    return "error" in result ? { status: 409, error: result.error ?? incomeReviewUnavailable } : { value: result };
  }, 24_576);
}
