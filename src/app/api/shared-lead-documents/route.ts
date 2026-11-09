import { borrowerJson } from "@/lib/borrower-http";
import { leadDocumentPortalUnavailable } from "@/lib/lead-document-model";

// The hosted Worker handles sample uploads with its private bucket.
export function POST(request: Request) {
  return borrowerJson(request, async () => ({ status: 404, error: leadDocumentPortalUnavailable }), 2048);
}
