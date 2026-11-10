import type { BorrowerApplication, BorrowerResult, BorrowerStatusRefresh } from "./application-model";
import type { BorrowerPortalPreferences } from "./borrower-channel-model";
import { demoBrokerageId } from "./brokerage-model";
import type { DocumentUploadMode } from "./document-files-model";

const headers = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer" };
const maxRequestBytes = 262_144;

function problem(error: string, status: number) {
  return Response.json({ error }, { status, headers });
}

function sameOrbitOrigin(request: Request) {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  if (origin === url.origin) return true;
  // Next's local Node server can construct request.url with localhost even when bound to IPv4 loopback.
  const loopback = url.port ? `127.0.0.1:${url.port}` : "127.0.0.1";
  return url.protocol === "http:" && url.hostname === "localhost" &&
    request.headers.get("Host") === loopback && origin === `http://${loopback}`;
}

export async function borrowerJson<T>(request: Request, run: (input: unknown) => Promise<Response | { value: T } | { status: number; error: string }>, limit: number) {
  if (!sameOrbitOrigin(request)) return problem("Open the application directly in Orbit.", 403);
  if (request.headers.get("Content-Type")?.split(";")[0] !== "application/json") return problem("Send the application as JSON.", 415);
  const reader = request.body?.getReader();
  if (!reader) return problem("The application request is empty.", 400);

  const decoder = new TextDecoder();
  let content = "";
  let bytes = 0;
  let input: unknown;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        return problem("The application request is too large.", 413);
      }
      content += decoder.decode(value, { stream: true });
    }
    input = JSON.parse(content + decoder.decode());
  } catch {
    return problem("The application request could not be read.", 400);
  } finally {
    reader.releaseLock();
  }
  try {
    const result = await run(input);
    if (result instanceof Response) return result;
    if ("error" in result) return problem(result.error, result.status);
    return Response.json(result.value, { headers });
  } catch {
    return problem("Orbit could not load or save the application. Try again.", 500);
  }
}

export function documentUploadMode(mode: DocumentUploadMode | undefined, brokerage: string | null, pilot = false) {
  if (!brokerage) return undefined;
  return (brokerage === demoBrokerageId || pilot ? mode === "mock" : mode === "live") ? mode : undefined;
}

export function borrowerHttp(request: Request, run: (input: unknown) => Promise<BorrowerResult & { uploadsMode?: DocumentUploadMode }>, addressLookupEnabled = false) {
  return borrowerJson<BorrowerApplication | BorrowerStatusRefresh | BorrowerPortalPreferences>(request, async (input) => {
    const result = await run(input);
    if ("error" in result) return result;
    if ("preferences" in result) return { value: result.preferences };
    const mode = result.uploadsMode;
    if ("statusView" in result) return { value: { ...result.statusView, documentUploadsMode: mode } };
    return { value: { ...result.application, addressLookupEnabled, documentUploadsEnabled: Boolean(mode), documentUploadsMode: mode } };
  }, maxRequestBytes);
}
