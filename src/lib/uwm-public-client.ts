import { z } from "zod";
import { UwmError, type UwmEnvironment } from "./uwm-live";
import { uwmUserSettings, uwmUserToken } from "./uwm-user-access";
import { prepareUwmXmlUpload } from "./uwm-origination-blob";
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
      const outcome = response.status >= 500 || response.status === 408 ? "unknown" : "rejected";
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
  const loan = (number: string) => `/public/products/v1/loans/${id(number)}`;
  const documents = (number: string) => `/public/v1/deal/loans/${id(number)}`;
  return {
    brokerAssociations: () => request("/public/rolodex/v1/current-user/broker-associations"),
    alternativeContacts: (entityId: string) => request(`/public/rolodex/v1/brokers/${id(entityId)}/alternative-contacts`),
    createTransaction: async (body: UwmRequestBody) => {
      const response = await request("/public/v1/transactions", "POST", body);
      const parsed = z.object({ data: z.object({ transactionId: z.string().min(1), uri: z.url(), fileName: z.string().min(1) }) }).safeParse(response.body);
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
    scanTransaction: (transactionId: string, body: UwmRequestBody) => request(`/public/v1/transactions/${id(transactionId)}/scan-result`, "POST", body),
    amendTransaction: (transactionId: string, body: UwmRequestBody) => request(`/public/v1/transactions/${id(transactionId)}/urla`, "PATCH", body),
    commitTransaction: (transactionId: string, body: UwmRequestBody) => request(`/public/v1/transactions/${id(transactionId)}`, "POST", body),
    searchProducts: (number: string, body: UwmRequestBody) => request(`/public/products/v4/loans/${id(number)}/search`, "POST", body),
    float: (number: string, body: UwmRequestBody) => request(`${loan(number)}/float`, "POST", body),
    lock: (number: string, body: UwmRequestBody) => request(`${loan(number)}/lock`, "POST", body),
    relock: (number: string, body: UwmRequestBody) => request(`${loan(number)}/relock`, "POST", body),
    extendLock: (number: string, body: UwmRequestBody) => request(`${loan(number)}/lock/extension`, "POST", body),
    cancelLock: (number: string, body: UwmRequestBody) => request(`${loan(number)}/lock/cancel`, "PUT", body),
    uploadConditionDocument: (number: string, fileName: string, bytes: Uint8Array) =>
      request(`${documents(number)}/documentations/${id(fileName)}`, "POST", bytes, "application/octet-stream"),
    listConditionDocuments: (number: string) => request(`${documents(number)}/documentations`),
    attachConditions: (number: string, body: UwmRequestBody) => request(`${documents(number)}/condition-attachments`, "PUT", body),
    listConditionAttachments: (number: string) => request(`${documents(number)}/condition-attachments`),
    submitConditions: (number: string, body: UwmRequestBody) => request(`${documents(number)}/condition-attachments-submissions`, "POST", body),
  };
}
