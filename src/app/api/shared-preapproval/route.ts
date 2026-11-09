import { borrowerJson } from "@/lib/borrower-http";
import { loadSharedPreapproval } from "@/lib/workspace-service";

export function POST(request: Request) {
  return borrowerJson(request, loadSharedPreapproval, 1024);
}
