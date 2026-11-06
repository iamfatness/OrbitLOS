import { borrowerHttp } from "@/lib/borrower-http";
import { updateBorrowerApplication } from "@/lib/workspace-service";

export function POST(request: Request) {
  return borrowerHttp(request, updateBorrowerApplication);
}
