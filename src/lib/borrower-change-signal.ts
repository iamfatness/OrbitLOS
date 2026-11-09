import type { StaffApplication } from "./application-model";

const checklistWrites = new Set([
  "requestDocument", "requestSuggestedUwmDocuments", "applyDocumentPreset", "setDocumentDeadline",
  "reviewDocument", "reopenMockUwmCondition",
]);

export function borrowerChecklistToken(input: unknown, applications: readonly StaffApplication[]) {
  if (!input || typeof input !== "object" || !("type" in input) || typeof input.type !== "string" ||
    !checklistWrites.has(input.type) || !("loanId" in input) || typeof input.loanId !== "string") return;
  return applications.find((application) => application.loanId === input.loanId && application.submittedAt && !application.revokedAt)?.token;
}

export async function borrowerChangeChannel(token: string) {
  if (typeof BroadcastChannel === "undefined" || !globalThis.crypto?.subtle) return null;
  try {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
    const key = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    // Keep the borrower link and application details out of the signal.
    return new BroadcastChannel(`orbit-borrower-change:${key}`);
  } catch {
    return null;
  }
}

type BorrowerChange = "changed" | "checklist-changed";

export async function announceBorrowerChange(token: string, change: BorrowerChange = "changed") {
  const channel = await borrowerChangeChannel(token);
  if (!channel) return;
  try {
    channel.postMessage(change);
  } catch {
    // The other tab can still refresh when it becomes visible.
  } finally {
    channel.close();
  }
}

export function observeBorrowerChange(token: string, change: BorrowerChange, onChange: () => void) {
  let active = true;
  let channel: BroadcastChannel | null = null;
  void borrowerChangeChannel(token).then((connection) => {
    if (!active) { connection?.close(); return; }
    channel = connection;
    channel?.addEventListener("message", (event) => {
      if (active && event.data === change) onChange();
    });
  });
  return () => {
    active = false;
    channel?.close();
  };
}
