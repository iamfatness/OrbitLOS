import { borrowerHttp } from "@/lib/borrower-http";
import { updateBorrowerApplication } from "@/lib/workspace-service";

export function POST(request: Request) {
  return borrowerHttp(request, updateBorrowerApplication, Boolean(process.env.GOOGLE_PLACES_API_KEY?.trim()));
}
