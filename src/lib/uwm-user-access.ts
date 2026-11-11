import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Store } from "./store";
import type { WorkspaceStaff } from "./staff-store";
import { UwmError, uwmJson, uwmWorkspaceEnabled, type UwmEnvironment } from "./uwm-live";

export function initializeUwmUserAccess(db: Store) {
  db.exec(`CREATE TABLE IF NOT EXISTS uwm_user_access (
    email TEXT NOT NULL, environment TEXT NOT NULL, revision TEXT NOT NULL, encrypted TEXT,
    expiresAt INTEGER NOT NULL DEFAULT 0, connectedAt TEXT, PRIMARY KEY(email, environment)
  )`);
}
export function uwmUserSettings(env: UwmEnvironment) {
  const environment = z.enum(["int", "stage", "production"]).parse(env.UWM_USER_ENVIRONMENT || "stage");
  const deployment = env.ORBIT_DEPLOYMENT;
  if (deployment && ({ dev: "int", stage: "stage", production: "production" } as Record<string, string>)[deployment] !== environment) {
    throw new UwmError("UWM environment does not match this Orbit deployment.");
  }
  if (!env.UWM_USER_CLIENT_ID || !env.UWM_USER_CLIENT_SECRET || !/^[a-f\d]{64}$/i.test(env.UWM_TOKEN_ENCRYPTION_KEY ?? "")) {
    throw new UwmError("Your administrator must configure UWM client access and token encryption.");
  }
  return { environment, api: environment === "production" ? "https://api.uwm.com" : "https://stg.api.uwm.com",
    tokenUrl: `https://${environment === "int" ? "sso.dev" : "sso"}.uwm.com/adfs/oauth2/token`,
    scope: `https://api.uwm.com/loanorigination${environment === "production" ? "" : environment === "int" ? "-int" : "-stg"}`,
    key: Buffer.from(env.UWM_TOKEN_ENCRYPTION_KEY!, "hex") };
}
function context(env: UwmEnvironment, staff: WorkspaceStaff) {
  if (!uwmWorkspaceEnabled(env, staff)) throw new UwmError("UWM user access is unavailable for this brokerage.");
  const settings = uwmUserSettings(env);
  return { ...settings, aad: Buffer.from(`${staff.brokerage.id}:${staff.email}:${settings.environment}`) };
}
const tokens = z.object({ access_token: z.string().min(1).max(32000), refresh_token: z.string().min(1).max(32000).optional(),
  expires_in: z.coerce.number().int().min(60).max(86400) });
type Tokens = z.infer<typeof tokens>;
function encrypt(value: Tokens, key: Buffer, aad: Buffer) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
}
function decrypt(value: string, key: Buffer, aad: Buffer) {
  try {
    const bytes = Buffer.from(value, "base64"), decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
    decipher.setAAD(aad); decipher.setAuthTag(bytes.subarray(12, 28));
    return tokens.parse(JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8")));
  } catch { throw new UwmError("Reconnect your UWM account to continue."); }
}
async function exchange(env: UwmEnvironment, settings: ReturnType<typeof uwmUserSettings>, grant: Record<string, string>) {
  const response = await uwmJson(settings.tokenUrl, { method: "POST", body: new URLSearchParams({
    client_id: env.UWM_USER_CLIENT_ID!, client_secret: env.UWM_USER_CLIENT_SECRET!, scope: settings.scope, ...grant,
  }) });
  const parsed = tokens.safeParse(response);
  if (!parsed.success) throw new UwmError("UWM returned an invalid user authorization response.");
  return parsed.data;
}
export const uwmSignInInput = z.object({ username: z.string().trim().min(1).max(254), password: z.string().min(1).max(1024) });
export async function connectUwmUser(db: Store, env: UwmEnvironment, staff: WorkspaceStaff, input: unknown) {
  const credentials = uwmSignInInput.parse(input), settings = context(env, staff), revision = randomUUID();
  db.prepare(`INSERT INTO uwm_user_access(email,environment,revision) VALUES(?,?,?)
    ON CONFLICT(email,environment) DO UPDATE SET revision=excluded.revision, encrypted=NULL, expiresAt=0, connectedAt=NULL`)
    .run(staff.email, settings.environment, revision);
  try {
    const value = await exchange(env, settings, { grant_type: "password", ...credentials });
    if (db.prepare("SELECT revision FROM uwm_user_access WHERE email=? AND environment=?").get(staff.email, settings.environment)?.revision !== revision) {
      throw new UwmError("UWM connection changed while signing in. Try again.");
    }
    db.prepare("UPDATE uwm_user_access SET encrypted=?, expiresAt=?, connectedAt=? WHERE email=? AND environment=? AND revision=?")
      .run(encrypt(value, settings.key, settings.aad), Date.now() + value.expires_in * 1000, new Date().toISOString(), staff.email, settings.environment, revision);
    return { message: "Your UWM account is connected." };
  } catch (error) {
    db.prepare("DELETE FROM uwm_user_access WHERE email=? AND environment=? AND revision=?").run(staff.email, settings.environment, revision);
    throw error;
  }
}
export function disconnectUwmUser(db: Store, staff: WorkspaceStaff) {
  db.prepare("DELETE FROM uwm_user_access WHERE email=?").run(staff.email);
  return { message: "Your stored UWM authorization was removed from this brokerage." };
}
export function uwmUserStatus(db: Store, env: UwmEnvironment, staff: WorkspaceStaff) {
  try {
    const settings = context(env, staff);
    const row = db.prepare("SELECT connectedAt, expiresAt FROM uwm_user_access WHERE email=? AND environment=?").get(staff.email, settings.environment);
    return { configured: true, environment: settings.environment, connectedAt: row?.connectedAt ?? null,
      expiresAt: row?.expiresAt ?? null, message: "" };
  } catch (error) {
    return { configured: false, environment: env.UWM_USER_ENVIRONMENT || "stage", connectedAt: null, expiresAt: null,
      message: error instanceof UwmError ? error.message : "UWM configuration needs attention." };
  }
}
export async function uwmUserToken(db: Store, env: UwmEnvironment, staff: WorkspaceStaff) {
  const settings = context(env, staff);
  const row = db.prepare("SELECT * FROM uwm_user_access WHERE email=? AND environment=?").get(staff.email, settings.environment);
  if (!row?.encrypted) throw new UwmError("Connect your UWM account in Integrations first.");
  const value = decrypt(String(row.encrypted), settings.key, settings.aad);
  if (Number(row.expiresAt) > Date.now() + 60_000) return value.access_token;
  if (!value.refresh_token) throw new UwmError("Your UWM authorization expired. Reconnect in Integrations.");
  let refreshed: Tokens;
  try {
    refreshed = await exchange(env, settings, { grant_type: "refresh_token", refresh_token: value.refresh_token });
  } catch (error) {
    if (error instanceof UwmError && /HTTP (400|401)\b/.test(error.message)) {
      // Retire only the rejected grant. A concurrent successful reconnect or
      // refresh must not be removed by this older request's rejection.
      db.prepare("UPDATE uwm_user_access SET encrypted=NULL,expiresAt=0,connectedAt=NULL WHERE email=? AND environment=? AND revision=? AND encrypted=?")
        .run(staff.email, settings.environment, String(row.revision), String(row.encrypted));
      throw new UwmError("UWM could not renew your authorization. Reconnect your UWM account in Integrations.");
    }
    throw error;
  }
  const current = db.prepare("SELECT revision, encrypted, expiresAt FROM uwm_user_access WHERE email=? AND environment=?").get(staff.email, settings.environment);
  if (!current?.encrypted || current.revision !== row.revision) throw new UwmError("Your UWM connection changed. Retry the action.");
  if (current.encrypted !== row.encrypted) return decrypt(String(current.encrypted), settings.key, settings.aad).access_token;
  db.prepare("UPDATE uwm_user_access SET encrypted=?, expiresAt=? WHERE email=? AND environment=? AND revision=?")
    .run(encrypt({ ...refreshed, refresh_token: refreshed.refresh_token ?? value.refresh_token }, settings.key, settings.aad), Date.now() + refreshed.expires_in * 1000, staff.email, settings.environment, String(row.revision));
  return refreshed.access_token;
}
