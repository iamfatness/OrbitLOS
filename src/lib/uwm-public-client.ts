import { z } from "zod";
import { UwmError, type UwmEnvironment } from "./uwm-live";
import { uwmUserSettings, uwmUserToken } from "./uwm-user-access";
import { prepareUwmXmlUpload } from "./uwm-origination-blob";
import { uwmScanRequest, uwmConditionAttachments, uwmConditionSubmission, uwmConditionAcknowledgment, uwmDocumentName, uwmLoanNumber, uwmBrokerAssociations, uwmScanResponse, uwmAmendRequest, uwmAttachmentList, uwmLockRequest, uwmRelockRequest, uwmLockAcknowledgment, uwmFloatRequest, uwmFloatAcknowledgment, uwmCancelAcknowledgment, uwmProductSearch } from "./uwm-public-contracts";
import type { Store } from "./store";
import type { WorkspaceStaff } from "./staff-store";

// Request bodies are supplied by operation-specific, validated mappings. The
// transport never invents UWM fields or treats a 2xx as business confirmation.
export type UwmRequestBody = Record<string, unknown>;
export class UwmRequestError extends UwmError {
  readonly status: number | null;
  readonly outcome: "rejected" | "unknown";
  constructor(message: string, status: number | null, outcome: "rejected" | "unknown") {
    super(message); this.status = status; this.outcome = outcome;
  }
}
const id = (value: string) => encodeURIComponent(z.string().trim().min(1).max(200).parse(value));
export function uwmPublicClient(db: Store, env: UwmEnvironment, staff: WorkspaceStaff) {
  const settings = uwmUserSettings(env);
  async function request(path: string, method = "GET", body?: UwmRequestBody | Uint8Array, contentType = "application/json") {
    const token = await uwmUserToken(db, env, staff);
    let response: Response;
    try {
      response = await fetch(`${settings.api}${path}`, { method, redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(30000),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
        body: body instanceof Uint8Array ? new Uint8Array(body) : body === undefined ? undefined : JSON.stringify(body) });
    } catch { throw new UwmRequestError("UWM did not confirm the request outcome. Reconcile before retrying.", null, "unknown"); }
    if (!response.ok) {
      await response.body?.cancel();
      const outcome = response.status >= 500 || response.status === 408 ||
        (response.status === 422 && path.endsWith("/condition-attachments-submissions")) ? "unknown" : "rejected";
      throw new UwmRequestError(response.status === 429 ? "UWM rate limit reached. Wait at least 60 seconds before a new attempt."
        : `UWM request returned HTTP ${response.status}.`, response.status, outcome);
    }
    const reader = response.body?.getReader();
    if (!reader) return { status: response.status, body: null };
    let text = "", bytes = 0;
    try {
      const decoder = new TextDecoder("utf-8", { fatal: true });
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 8 * 1024 * 1024) { await reader.cancel(); throw new Error(); }
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode();
      return { status: response.status, body: text.trim() ? JSON.parse(text) as unknown : null };
    } catch { throw new UwmRequestError("UWM returned an unreadable acknowledgment. Reconcile before retrying.", response.status, "unknown"); }
    finally { reader.releaseLock(); }
  }
  function verified<T>(response: { status: number; body: unknown }, schema: z.ZodType<T>) {
    const parsed = schema.safeParse(response.body);
    if (!parsed.success) throw new UwmRequestError("UWM did not return a verifiable acknowledgment. Reconcile before retrying.", response.status, "unknown");
    return { ...response, body: parsed.data };
  }
  function scanResult(response: { status: number; body: unknown }) {
    const result = verified(response, uwmScanResponse);
    return { ...result, readyToCommit: result.body.data.transferStatus === "UpdateUploaded" &&
      result.body.data.fields.every(field => !field.required || field.validated) };
  }
  const loan = (number: string) => `/public/products/v1/loans/${uwmLoanNumber.parse(number)}`;
  const documents = (number: string) => `/public/v1/deal/loans/${z.string().regex(/^\d{10}$/).parse(number)}`;
  return {
    brokerAssociations: async () => verified(await request("/public/rolodex/v1/current-user/broker-associations"), uwmBrokerAssociations),
    alternativeContacts: (entityId: string) => request(`/public/rolodex/v1/brokers/${id(entityId)}/alternative-contacts`),
    createTransaction: async () => {
      const response = await request("/public/v1/transactions", "POST");
      const parsed = z.object({ success: z.literal(true), errors: z.null(), validationErrors: z.null(),
        data: z.object({ transactionId: z.string().min(1), uri: z.url(), fileName: z.string().min(1) }) }).safeParse(response.body);
      if (!parsed.success) throw new UwmRequestError("UWM transaction response could not be verified. Reconcile before retrying.", response.status, "unknown");
      return parsed.data.data;
    },
    uploadXml: async (signedUrl: string, bytes: Uint8Array, digest: string) => {
      const upload = prepareUwmXmlUpload({ signedUrl, storageOrigin: env.UWM_STORAGE_ORIGIN ?? "", bytes, digest });
      let response: Response;
      try { response = await fetch(upload, { signal: AbortSignal.timeout(30000) }); }
      catch { throw new UwmRequestError("XML upload outcome is unknown. Check the transaction before retrying.", null, "unknown"); }
      await response.body?.cancel();
      if (response.status !== 201) throw new UwmRequestError(`XML upload returned HTTP ${response.status}.`, response.status, "unknown");
      return { uploaded: true as const };
    },
    scanTransaction: async (transactionId: string, body: UwmRequestBody) => {
      const response = await request(`/public/v1/transactions/${id(transactionId)}/scan-result`, "POST", uwmScanRequest.parse(body));
      return scanResult(response);
    },
    amendTransaction: async (transactionId: string, body: UwmRequestBody) => scanResult(await request(`/public/v1/transactions/${id(transactionId)}/urla`, "PATCH", uwmAmendRequest.parse(body))),
    commitTransaction: async (transactionId: string) => {
      const response = await request(`/public/v1/transactions/${id(transactionId)}`, "POST");
      return verified(response, z.object({ transactionId: z.literal(transactionId), message: z.literal("File Imported Successfully") }));
    },
    searchProducts: async (number: string, body: UwmRequestBody) => {
      const input = uwmProductSearch.parse(body);
      if (input.loanNumber && input.loanNumber !== number) throw new UwmError("Pricing loan number does not match the linked loan.");
      return verified(await request(`/public/products/v3/loans/${uwmLoanNumber.parse(number)}/search`, "POST", input),
        z.object({ Quote: z.object({ LoanNumber: z.literal(number), QuoteSet: z.object({ ValidQuotes: z.array(z.unknown()) }).passthrough() }).passthrough(),
          CanSeePricing: z.boolean(), CanLockLoan: z.boolean(), UserHasExternalViewPricingPermission: z.boolean(), UserHasExternalLockingPermissions: z.boolean() }).passthrough());
    },
    float: async (number: string, body: UwmRequestBody) => {
      const input = uwmFloatRequest.parse(body);
      if (input.loanNumber && input.loanNumber !== number) throw new UwmError("Float loan number does not match the linked loan.");
      return verified(await request(`${loan(number)}/float`, "POST", input), uwmFloatAcknowledgment);
    },
    lock: async (number: string, body: UwmRequestBody) => verified(await request(`${loan(number)}/lock`, "POST", uwmLockRequest.parse(body)), uwmLockAcknowledgment),
    relock: async (number: string, body: UwmRequestBody) => verified(await request(`${loan(number)}/relock`, "POST", uwmRelockRequest.parse(body)), uwmLockAcknowledgment),
    extendLock: async (number: string, body: UwmRequestBody) => verified(await request(`${loan(number)}/lock/extension`, "POST", uwmRelockRequest.parse(body)), uwmLockAcknowledgment),
    cancelLock: async (number: string) => verified(await request(`${loan(number)}/lock/cancel`, "PUT"), uwmCancelAcknowledgment),
    createConditionUpload: async (number: string, fileName: string) => {
      const response = await request(`${documents(number)}/documentations/${id(uwmDocumentName.parse(fileName))}`, "POST");
      const parsed = z.object({ sasUri: z.url(), documentId: z.number().int().positive(), fileName: uwmDocumentName,
        location: z.literal("Public Documentations") }).safeParse(response.body);
      if (!parsed.success) throw new UwmRequestError("UWM document upload target could not be verified.", response.status, "unknown");
      return parsed.data;
    },
    uploadConditionBytes: async (signedUrl: string, bytes: Uint8Array, digest: string) => {
      const checked = prepareUwmXmlUpload({ signedUrl, storageOrigin: env.UWM_DOCUMENT_STORAGE_ORIGIN ?? "", bytes, digest });
      let response: Response;
      // Documentation page 75 explicitly specifies POST of raw bytes to the SAS URI.
      // Use a separate approved origin; never forward the UWM bearer token.
      try { response = await fetch(checked.url, { method: "POST", redirect: "manual", signal: AbortSignal.timeout(30000),
        headers: { "Content-Type": "application/octet-stream" }, body: new Uint8Array(bytes) }); }
      catch { throw new UwmRequestError("Document upload outcome is unknown. Reconcile before retrying.", null, "unknown"); }
      await response.body?.cancel();
      if (!response.ok) throw new UwmRequestError(`Document upload returned HTTP ${response.status}.`, response.status, "unknown");
      return { uploaded: true as const }; // Listing, attachment and submission are separate steps.
    },
    listConditionDocuments: async (number: string) => verified(await request(`${documents(number)}/documentations`), z.object({ documents: z.array(z.object({ documentId: z.number().int().positive(), fileName: uwmDocumentName, location: z.string() })) })),
    attachConditions: async (number: string, body: UwmRequestBody) => {
      const input = uwmConditionAttachments.parse(body);
      const response = verified(await request(`${documents(number)}/condition-attachments`, "PUT", input), uwmAttachmentList);
      const sameSet = (a: (string | number)[], b: (string | number)[]) => a.length === b.length && new Set(a).size === a.length && a.every(value => b.includes(value));
      if (input.attachments.some(sent => !response.body.attachments.some(saved =>
        (!sent.attachmentId || saved.attachmentId === sent.attachmentId) && saved.documentType === sent.documentType &&
        saved.comments === sent.comments && !saved.SubmittedDateTime &&
        sameSet(saved.files.map(file => file.documentId), sent.files.map(file => file.documentId)) && sameSet(saved.conditions, sent.conditions)))) {
        throw new UwmRequestError("UWM did not confirm all requested attachments. Reconcile before retrying.", response.status, "unknown");
      }
      return response;
    },
    listConditionAttachments: async (number: string) => verified(await request(`${documents(number)}/condition-attachments`), uwmAttachmentList),
    submitConditions: async (number: string, body: UwmRequestBody) => {
      const input = uwmConditionSubmission.parse(body);
      const response = await request(`${documents(number)}/condition-attachments-submissions`, "POST", input);
      const parsed = uwmConditionAcknowledgment.safeParse(response.body);
      const expected = new Set(input.attachments.map(item => item.documentType));
      if (!parsed.success || parsed.data.errors.length || parsed.data.documentTypes.length !== expected.size ||
        new Set(parsed.data.documentTypes).size !== expected.size || parsed.data.documentTypes.some(type => !expected.has(type))) {
        throw new UwmRequestError("UWM did not confirm every condition document type. Reconcile before retrying.", response.status, "unknown");
      }
      return { ...response, body: parsed.data };
    },
  };
}
