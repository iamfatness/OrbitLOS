import { borrowerJson } from "./borrower-http";
import { fileProblem, privatePdf } from "./document-file-http";
import { documentKey } from "./document-files-model";
import { lenderPackageUnavailable, sharedLenderPackageInput, type LenderPackageManifest,
  type PackageDownloadInput, type SharedLenderPackageInput } from "./lender-handoff-share-model";
import type { PackageAccessResult } from "./lender-handoff-share";

type RecipientWorkspace = {
  id: string;
  read: (input: SharedLenderPackageInput) => PackageAccessResult | Promise<PackageAccessResult>;
  confirmPdf?: (input: PackageDownloadInput, objectId: string) => boolean | Promise<boolean>;
};

export function sharedLenderPackageHttp(request: Request, workspace: (token: string) => RecipientWorkspace | null | Promise<RecipientWorkspace | null>,
  bucket?: R2Bucket) {
  return borrowerJson<LenderPackageManifest>(request, async (input) => {
    const denied = { status: 404, error: lenderPackageUnavailable };
    const parsed = sharedLenderPackageInput.safeParse(input);
    if (!parsed.success) return denied;
    const data = parsed.data;
    const target = await workspace(data.token);
    if (!target) return denied;
    const result = await target.read(data);
    if ("error" in result || "value" in result) return result;
    if (data.type !== "download") return denied;
    const disposition = `attachment; filename="${result.filename}"`;
    if ("xml" in result) return new Response(result.xml, { headers: {
      "Content-Type": "application/xml; charset=utf-8", "Content-Disposition": disposition,
      "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex",
      "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox",
    } });
    if (!bucket || !target.confirmPdf) return denied;
    try {
      const object = await bucket.get(documentKey(target.id, result.objectId));
      if (!object) return denied;
      let confirmed = false;
      try { confirmed = await target.confirmPdf(data, result.objectId); }
      finally { if (!confirmed) await object.body.cancel().catch(() => {}); }
      if (!confirmed) return denied;
      const response = privatePdf(object, true);
      response.headers.set("Content-Disposition", disposition);
      return response;
    } catch {
      return fileProblem(503, "Orbit could not open this sample PDF. Try again.");
    }
  }, 2048);
}
