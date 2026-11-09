import { borrowerJson } from "@/lib/borrower-http";
import { submitQuoteRequest } from "@/lib/workspace-service";

export async function POST(request: Request) {
  return borrowerJson(request, submitQuoteRequest, 4096);
}
