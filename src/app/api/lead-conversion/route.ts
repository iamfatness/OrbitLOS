import { borrowerJson } from "@/lib/borrower-http";
import { convertReferralInput } from "@/lib/lead-inbox-model";
import { currentStaff, updateWorkspace } from "@/lib/workspace-service";

export async function POST(request: Request) {
  const staff = await currentStaff();
  const brokerageId = new URL(request.url).searchParams.get("brokerage");
  const unavailable = "This lead is unavailable in your workspace.";
  if (!staff || staff.brokerage.id !== brokerageId || staff.brokerage.role === "Processor") {
    return Response.json({ error: unavailable }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  return borrowerJson(request, async (input) => {
    const parsed = convertReferralInput.safeParse(input);
    if (!parsed.success) return { status: 400, error: "Choose a valid lead and borrower contact." };
    const result = await updateWorkspace(parsed.data, staff, "inbox");
    if ("error" in result) return { status: 409, error: result.error };
    if (!("inboxChanged" in result) || !result.inboxLoan || result.inboxLoan.loanId !== result.referralLoanId ||
      result.convertedLead?.id !== parsed.data.referralId) return { status: 409, error: unavailable };
    return { value: result };
  }, 4096);
}
