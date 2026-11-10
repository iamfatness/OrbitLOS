import { z } from "zod";
import type { UwmConnector } from "./uwm";
import type { WorkspaceStaff } from "./staff-store";
import { demoBrokerageId } from "./brokerage-model";

export class UwmError extends Error {}
export type UwmEnvironment = Record<string, string | undefined>;

export function uwmPricingEnvironment(env: UwmEnvironment, staff: WorkspaceStaff | null): UwmEnvironment {
  const fictional = !staff || staff.brokerage.id === demoBrokerageId || staff.brokerage.pilot;
  if (!fictional && !uwmWorkspaceEnabled(env, staff)) {
    throw new UwmError("Configure this brokerage's UWM connection before requesting pricing.");
  }
  if (!fictional && env.ORBIT_PRICING_MODE !== "uwm-stage") {
    throw new UwmError("Live pricing is not configured. No sample rates were substituted.");
  }
  return { ...env, UWM_EQ_CLIENT_ID: env.UWM_CLIENT_ID || env.UWM_EQ_CLIENT_ID,
    UWM_EQ_CLIENT_SECRET: env.UWM_CLIENT_SECRET || env.UWM_EQ_CLIENT_SECRET };
}

export function uwmConnectionSettings(env: UwmEnvironment, staff: WorkspaceStaff | null) {
  const fictional = !staff || staff.brokerage.id === demoBrokerageId || staff.brokerage.pilot;
  const connected = uwmWorkspaceEnabled(env, staff);
  return {
    pricing: (fictional || connected) && env.ORBIT_PRICING_MODE === "uwm-stage" ? "UWM stage API" : fictional ? "Sample pricing" : "Not configured",
    pipeline: connected && env.UWM_INSIGHTS_CLIENT_ID && env.UWM_INSIGHTS_CLIENT_SECRET ? "UWM Insights" : fictional ? "Sample pipeline" : "Insights credentials required",
    lenderActions: "Simulated in fictional workspaces; live onboarding required",
  };
}

export async function checkUwmPublicConnection(env: UwmEnvironment, staff: WorkspaceStaff | null) {
  if (!staff || staff.brokerage.role !== "Admin") return { error: "A signed-in administrator can verify the UWM connection." };
  try {
    const settings = uwmPricingEnvironment(env, staff);
    if (settings.ORBIT_PRICING_MODE !== "uwm-stage") return { error: "UWM stage pricing is not enabled." };
    const token = await uwmPublicToken({ ...settings, UWM_ENVIRONMENT: "stage" });
    const disclosures = await uwmJson("https://stg.api.uwm.com/public/products/v1/disclaimers", { headers: { Authorization: `Bearer ${token}` } });
    if (!Array.isArray(disclosures) || !disclosures.length) throw new UwmError("UWM disclosures could not be verified.");
    return { message: `UWM stage connected. Authentication and ${disclosures.length} disclosure groups verified from this app. Pipeline access requires separate Insights credentials.` };
  } catch (error) { return { error: error instanceof UwmError ? error.message : "UWM verification failed." }; }
}

// A server configuration binds credentials to exactly one authenticated brokerage.
export function uwmWorkspaceEnabled(env: UwmEnvironment, staff: WorkspaceStaff | null) {
  return !!staff && !staff.brokerage.pilot && staff.brokerage.id !== demoBrokerageId &&
    !!env.UWM_BROKERAGE_ID && staff.brokerage.id === env.UWM_BROKERAGE_ID;
}

export async function uwmJson(url: string, init: RequestInit = {}) {
  let response: Response;
  try {
    response = await fetch(url, { ...init, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new UwmError("UWM could not be reached. Try again shortly.");
  }
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 401 || response.status === 403) throw new UwmError("UWM denied access. Check the credentials and broker-shop permissions.");
    if (response.status === 429) throw new UwmError("UWM is limiting requests. Wait one minute before trying again.");
    throw new UwmError(`UWM request failed (HTTP ${response.status}).`);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new UwmError("UWM returned an empty response.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8 * 1024 * 1024) {
        await reader.cancel();
        throw new UwmError("The UWM response exceeds Orbit's sync limit.");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch (error) {
    if (error instanceof UwmError) throw error;
    throw new UwmError("UWM returned an unreadable response. No pipeline changes were saved.");
  } finally { reader.releaseLock(); }
}

const tokenSchema = z.object({ access_token: z.string().min(1), expires_in: z.coerce.number().positive().optional() });
export async function uwmPublicToken(env: UwmEnvironment) {
  const environment = env.UWM_ENVIRONMENT ?? "stage";
  if (!["int", "stage", "production"].includes(environment)) throw new UwmError("Choose a valid UWM environment.");
  const clientId = env.UWM_CLIENT_ID || env.UWM_EQ_CLIENT_ID;
  const clientSecret = env.UWM_CLIENT_SECRET || env.UWM_EQ_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new UwmError("UWM Public API credentials are not configured.");
  const result = tokenSchema.safeParse(await uwmJson(
    `https://${environment === "int" ? "sso.dev" : "sso"}.uwm.com/adfs/oauth2/token`, {
      method: "POST", body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId,
        client_secret: clientSecret, scope: `https://api.uwm.com/loanorigination${environment === "production" ? "" : environment === "int" ? "-int" : "-stg"}` }),
    }));
  if (!result.success) throw new UwmError("UWM returned an invalid token response.");
  return result.data.access_token;
}

const loanSchema = z.object({ LoanId: z.union([z.string().min(1), z.number()]).transform(String),
  PrimaryBorrowerFirstName: z.string(), PrimaryBorrowerLastName: z.string(),
  ImportedDateTime: z.string(), LoanStatusDescription: z.string() });
const loansSchema = z.object({ data: z.object({ Loans: z.array(loanSchema).max(5000) }), errors: z.array(z.unknown()).optional() });
const conditionSchema = z.object({ id: z.string(), conditionCategory: z.string(), conditionDescription: z.string(),
  isConditionUploaded: z.boolean(), conditionSatisfactionDate: z.string().nullable() });
const conditionsSchema = z.object({ conditionGroups: z.array(z.object({ key: z.string(), countItems: z.number(),
  uploadedConditionsCount: z.number(), conditions: z.array(conditionSchema) })), clearedConditions: z.array(conditionSchema) });

export function uwmInsightsConnector(env: UwmEnvironment): UwmConnector {
  if (!env.UWM_INSIGHTS_CLIENT_ID || !env.UWM_INSIGHTS_CLIENT_SECRET) {
    throw new UwmError("Live UWM pipeline sync needs separate broker-shop Insights credentials. Public API credentials do not provide pipeline access.");
  }
  // Cache only within this sync operation, never across workspaces or requests.
  let token: string | undefined;
  let expiresAt = 0;
  async function headers() {
    if (!token || Date.now() >= expiresAt) {
      const result = tokenSchema.safeParse(await uwmJson("https://login.microsoftonline.com/13d3189d-22a4-4f96-bbc9-2af46c222581/oauth2/v2.0/token", {
        method: "POST", body: new URLSearchParams({ grant_type: "client_credentials", client_id: env.UWM_INSIGHTS_CLIENT_ID!,
          client_secret: env.UWM_INSIGHTS_CLIENT_SECRET!, scope: "api://5260c3e4-e629-4b1c-b26d-3bb08407fc75/.default" }),
      }));
      if (!result.success) throw new UwmError("UWM Insights returned an invalid token response.");
      token = result.data.access_token;
      expiresAt = Date.now() + Math.max(0, (result.data.expires_in ?? 300) - 60) * 1000;
    }
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  }
  return {
    async listLoans() {
      const result = loansSchema.safeParse(await uwmJson("https://api.uwm.com/brokers/insights/", {
        method: "POST", headers: await headers(), body: JSON.stringify({ query:
          "query OrbitPipeline { Loans { LoanId PrimaryBorrowerFirstName PrimaryBorrowerLastName ImportedDateTime LoanStatusDescription } }" }),
      }));
      if (!result.success || result.data.errors?.length) throw new UwmError("UWM Insights returned an invalid pipeline response. No changes were saved.");
      if (!result.data.data.Loans.length) throw new UwmError("UWM Insights returned no loans. Confirm broker-shop access before treating the pipeline as empty.");
      return result.data;
    },
    async getConditions(loanNumber) {
      const result = conditionsSchema.safeParse(await uwmJson(
        `https://api.uwm.com/public/underwriting/v1/loans/${encodeURIComponent(loanNumber)}/conditions`, { headers: await headers() }));
      if (!result.success) throw new UwmError("UWM returned an invalid conditions response. No pipeline changes were saved.");
      return result.data;
    },
  };
}
