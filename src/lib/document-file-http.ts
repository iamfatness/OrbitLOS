import { z } from "zod";
import { portalTokenPattern } from "./brokerage-model";
import { borrowerJson } from "./borrower-http";
import { documentKey, maxPdfBytes, uploadSessionPattern } from "./document-files-model";
import type { UploadAccess } from "./document-files";
import { runtimeSetting } from "./staff-auth";

export interface DocumentEnvironment {
  DOCUMENTS?: R2Bucket;
  DOCUMENT_EMAIL?: { send(message: { to: string; from: string; subject: string; text: string }): Promise<unknown> };
}

export function uploadSettings(env: object & DocumentEnvironment, requestUrl: URL) {
  const setting = (name: string) => runtimeSetting(env, name).trim();
  const from = z.email().safeParse(setting("ORBIT_DOCUMENT_FROM"));
  const verificationSecret = setting("ORBIT_DOCUMENT_VERIFICATION_SECRET");
  const scanSecret = setting("ORBIT_DOCUMENT_SCANNER_SECRET");
  if (setting("ORBIT_DOCUMENT_UPLOADS") !== "enabled" || !env.DOCUMENTS || !env.DOCUMENT_EMAIL || !from.success ||
    verificationSecret.length < 32 || scanSecret.length < 32 || scanSecret === verificationSecret) return null;
  try {
    const scanner = new URL(setting("ORBIT_DOCUMENT_SCANNER_URL"));
    const local = requestUrl.hostname === "127.0.0.1" && scanner.protocol === "http:" && scanner.hostname === "127.0.0.1";
    if ((!local && scanner.protocol !== "https:") || scanner.username || scanner.password || scanner.hash) return null;
    return { bucket: env.DOCUMENTS, email: env.DOCUMENT_EMAIL, from: from.data, verificationSecret, scanSecret, scanner };
  } catch { return null; }
}

type Settings = NonNullable<ReturnType<typeof uploadSettings>>;
type ErrorResult = { status: number; error: string };
type DocumentStore = {
  issueUploadCode(token: string, secret: string): Promise<{ email: string; code: string } | ErrorResult>;
  verifyUploadCode(token: string, code: string, secret: string): Promise<{ session: string } | ErrorResult>;
  beginUpload(input: UploadAccess): Promise<{ objectId: string } | ErrorResult>;
  finishUpload(input: UploadAccess, objectId: string): Promise<{ received: boolean } | ErrorResult>;
  failUpload(requestId: string, objectId: string): Promise<void>;
};

const token = z.string().regex(portalTokenPattern);
const verification = z.discriminatedUnion("type", [
  z.object({ type: z.literal("sendCode"), token }),
  z.object({ type: z.literal("verifyCode"), token, code: z.string().regex(/^\d{6}$/) }),
]);
const uploadInput = z.object({ token, session: z.string().regex(uploadSessionPattern), requestId: z.uuid(),
  revision: z.string().regex(/^\d{1,10}$/).transform(Number) });

const privateHeaders = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex", "X-Content-Type-Options": "nosniff" };
export const fileProblem = (status: number, error: string) => Response.json({ error }, { status, headers: privateHeaders });
const unavailable = () => fileProblem(503, "Private PDF uploads are unavailable in this workspace.");

export function verifyBorrowerEmail(request: Request, settings: Settings | null, workspace: (token: string) => Promise<DocumentStore | null>) {
  if (!settings) return unavailable();
  return borrowerJson<{ session?: string; sent?: boolean }>(request, async (input) => {
    const parsed = verification.safeParse(input);
    if (!parsed.success) return { status: 400, error: "Enter a six-digit code from your email." };
    const data = parsed.data;
    const store = await workspace(data.token);
    if (!store) return { status: 404, error: "This borrower link is unavailable." };
    if (data.type === "verifyCode") {
      const result = await store.verifyUploadCode(data.token, data.code, settings.verificationSecret);
      return "error" in result ? result : { value: result };
    }
    const result = await store.issueUploadCode(data.token, settings.verificationSecret);
    if ("error" in result) return result;
    try {
      await settings.email.send({ to: result.email, from: settings.from, subject: "Your OrbitLOS verification code",
        text: `Your OrbitLOS code is ${result.code}. It expires in 10 minutes. Enter it on the OrbitLOS page that requested it.` });
    } catch {
      return { status: 503, error: "Orbit could not send a verification code. Try again in a minute." };
    }
    return { value: { sent: true } };
  }, 2048);
}

async function readPdf(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return { status: 400, error: "Choose a PDF to upload." };
  const bytes = new Uint8Array(maxPdfBytes);
  let length = 0;
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}); }, 30_000);
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (timedOut) return { status: 408, error: "The upload took too long. Try again." };
      if (done) break;
      if (length + value.byteLength > bytes.byteLength) {
        await reader.cancel();
        return { status: 413, error: "Choose a PDF no larger than 5 MB." };
      }
      bytes.set(value, length);
      length += value.byteLength;
    }
  } finally { clearTimeout(timeout); reader.releaseLock(); }
  const header = new TextDecoder().decode(bytes.subarray(0, Math.min(10, length)));
  const trailer = new TextDecoder().decode(bytes.subarray(Math.max(0, length - 1024), length));
  if (!/^%PDF-(?:1\.[0-7]|2\.0)[\r\n]/.test(header) || !/%%EOF[\t\r\n ]*$/.test(trailer)) {
    return { status: 415, error: "Choose a valid PDF file." };
  }
  return { bytes: bytes.subarray(0, length) };
}

export async function uploadBorrowerPdf(request: Request, settings: Settings | null,
  workspace: (token: string) => Promise<{ id: string; store: DocumentStore } | null>) {
  if (!settings) return unavailable();
  if (request.headers.get("Origin") !== new URL(request.url).origin) return fileProblem(403, "Open the application directly in Orbit.");
  if (request.headers.get("Content-Type") !== "application/pdf" || request.headers.has("Content-Encoding")) return fileProblem(415, "Choose a PDF file.");
  if (Number(request.headers.get("Content-Length")) > maxPdfBytes) return fileProblem(413, "Choose a PDF no larger than 5 MB.");
  const parsed = uploadInput.safeParse({ token: request.headers.get("X-Orbit-Application"), session: request.headers.get("X-Orbit-Upload-Session"),
    requestId: request.headers.get("X-Orbit-Request"), revision: request.headers.get("X-Orbit-Revision") });
  if (!parsed.success) return fileProblem(400, "Open the document request and verify your email before uploading.");
  const data = parsed.data;
  const target = await workspace(data.token);
  if (!target) return fileProblem(404, "This borrower link is unavailable.");
  const started = await target.store.beginUpload(data);
  if ("error" in started) return fileProblem(started.status, started.error);
  let completed = false;
  try {
    const file = await readPdf(request);
    if ("error" in file && file.error) return fileProblem(file.status, file.error);
    if (!file.bytes) return fileProblem(400, "Choose a PDF to upload.");
    const checksum = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", file.bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const scan = await fetch(settings.scanner, { method: "POST", redirect: "manual", signal: AbortSignal.timeout(20_000),
      headers: { "Content-Type": "application/pdf", Authorization: `Bearer ${settings.scanSecret}` }, body: file.bytes });
    await scan.body?.cancel();
    if (scan.status === 422) return fileProblem(422, "This PDF could not pass the file check. Choose another file.");
    if (scan.status !== 200 || scan.headers.get("X-Orbit-Scan-Sha256") !== checksum) return fileProblem(503, "Orbit could not complete the PDF scan. Try again shortly.");
    const saved = await settings.bucket.put(documentKey(target.id, started.objectId), file.bytes, { sha256: checksum, httpMetadata: { contentType: "application/pdf" } });
    if (!saved) return fileProblem(503, "Orbit could not store the PDF. Try again.");
    const finished = await target.store.finishUpload(data, started.objectId);
    if ("error" in finished) return fileProblem(finished.status, finished.error);
    completed = true;
    return Response.json({ received: true }, { headers: privateHeaders });
  } catch {
    return fileProblem(503, "Orbit could not process this PDF. Try again shortly.");
  } finally {
    if (!completed) await target.store.failUpload(data.requestId, started.objectId).catch(() => {});
  }
}

export function privatePdf(object: R2ObjectBody) {
  return new Response(object.body, { headers: { ...privateHeaders, "Content-Type": "application/pdf", "Content-Length": String(object.size),
    "Content-Disposition": 'attachment; filename="orbit-document.pdf"', "Content-Security-Policy": "default-src 'none'; sandbox" } });
}
