import { borrowerJson } from "@/lib/borrower-http";
import { updateCoBorrowerApplication } from "@/lib/workspace-service";

export function POST(request: Request) {
  return borrowerJson(request, updateCoBorrowerApplication, 262_144);
}
