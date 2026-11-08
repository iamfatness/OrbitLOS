import { createRemoteJWKSet, jwtVerify } from "jose";
import type { GoogleAttempt, StaffAuthStore, StaffIdentity } from "./staff-store";
import { brokerageIdPattern, brokerageUrl, type Brokerage } from "./brokerage-model";

const attemptCookie = "__Host-orbit-google";
const sessionCookie = "__Host-orbit-session";
const attemptSeconds = 10 * 60;
const sessionSeconds = 8 * 60 * 60;
const opaqueToken = /^[A-Za-z0-9_-]{43}$/;
const googleCallback = "/auth/google/callback";
const noStore = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" };

export interface GoogleSettings {
  clientId: string;
  clientSecret: string;
  allowedEmails: Set<string>;
}

export function runtimeSetting(env: object, key: string) {
  const value: unknown = Reflect.get(env, key);
  return typeof value === "string" ? value : "";
}

export function googleSettings(env: object): GoogleSettings | null {
  const setting = (key: string) => runtimeSetting(env, key).trim();
  if (setting("ORBIT_AUTH_MODE") !== "google") return null;
  return {
    clientId: setting("GOOGLE_CLIENT_ID"),
    clientSecret: setting("GOOGLE_CLIENT_SECRET"),
    allowedEmails: new Set([setting("ORBIT_STAFF_EMAILS"), setting("ORBIT_STAFF_EMAILS_EXTRA")]
      .flatMap((list) => list.split(",")).map((email) => email.trim().toLowerCase()).filter(Boolean)),
  };
}

function configured(settings: GoogleSettings) {
  return !!settings.clientId && !!settings.clientSecret && settings.allowedEmails.size > 0;
}

function base64url(value: Uint8Array) {
  return btoa(String.fromCharCode(...value)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

const randomToken = () => base64url(crypto.getRandomValues(new Uint8Array(32)));

async function hash(value: string) {
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}

function cookie(name: string, value: string, maxAge: number) {
  return `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

function readCookie(request: Request, name: string) {
  const pair = request.headers.get("Cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  const value = pair?.slice(name.length + 1);
  return value && opaqueToken.test(value) ? value : null;
}

function redirect(location: string, cookies: string[] = []) {
  const headers = new Headers({ ...noStore, Location: location });
  for (const value of cookies) headers.append("Set-Cookie", value);
  return new Response(null, { status: 303, headers });
}

function safeBrokerageId(value: string | null) {
  return value && brokerageIdPattern.test(value) ? value : null;
}

export function staffLoginUrl(brokerageId: string | null = null, error?: "denied" | "restart") {
  const search = new URLSearchParams();
  if (error) search.set("error", error);
  const target = safeBrokerageId(brokerageId);
  if (target) search.set("brokerage", target);
  return search.size ? `/login?${search}` : "/login";
}

function loginPage(settings: GoogleSettings, url: URL) {
  const ready = configured(settings);
  const error = url.searchParams.get("error");
  const brokerageId = safeBrokerageId(url.searchParams.get("brokerage"));
  const startUrl = brokerageId ? `/auth/google?brokerage=${brokerageId}` : "/auth/google";
  const message = !ready ? "Orbit staff sign-in is being configured."
    : error === "denied" ? (brokerageId ? "This Google account doesn’t have access to this brokerage." : "This Google account hasn’t been approved for Orbit.")
    : error ? "The sign-in attempt ended. Start again to continue." : "";
  return new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sign in · OrbitLOS</title>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;background:radial-gradient(ellipse at 75% 0%,#483361,transparent 67%),#211833;color:#2d1b4b;font:16px system-ui,sans-serif;padding:16px}
main{width:min(100%,440px);background:linear-gradient(145deg,#fff,#f1eafb);border:1px solid #ded3f4;border-radius:18px;padding:clamp(20px,6vw,36px);box-shadow:0 18px 50px #120a2560}
small{font-weight:750;letter-spacing:.12em;color:#6042bf}h1{margin:8px 0;font-size:clamp(26px,7vw,34px);letter-spacing:-.04em}p{color:#60596f;line-height:1.5}
a{display:block;background:#6749d3;color:white;text-align:center;text-decoration:none;border-radius:9px;font-weight:700;padding:11px;margin-top:18px}
a:hover{background:#5539b9}a:focus-visible{outline:2px solid #6749d3;outline-offset:3px}.status{border-radius:8px;background:#f4efff;padding:8px 10px}
</style></head><body><main><small>ORBITLOS WORKSPACE</small><h1>Sign in to OrbitLOS</h1><p>Use your approved Google account to open your brokerage workspace. The Demo Guide walks through a fictional referral and mock lender conditions.</p>
${message ? `<p class="status" role="alert">${message}</p>` : ""}
${ready ? `<a href="${startUrl}">Continue with Google</a>` : ""}</main></body></html>`, {
    status: ready ? 200 : 503,
    headers: {
      ...noStore, "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
    },
  });
}

async function beginGoogle(settings: GoogleSettings, url: URL, store: StaffAuthStore) {
  const now = Date.now();
  const browserToken = randomToken();
  const attempt: GoogleAttempt = {
    state: randomToken(), nonce: randomToken(), verifier: randomToken(),
    browserHash: await hash(browserToken), expiresAt: now + attemptSeconds * 1000,
    brokerageId: safeBrokerageId(url.searchParams.get("brokerage")),
  };
  await store.startGoogle(attempt, now);
  const target = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  target.search = new URLSearchParams({
    client_id: settings.clientId, redirect_uri: new URL(googleCallback, url.origin).href,
    response_type: "code", scope: "openid email profile", state: attempt.state, nonce: attempt.nonce,
    code_challenge: await hash(attempt.verifier), code_challenge_method: "S256", prompt: "select_account",
  }).toString();
  return redirect(target.href, [cookie(attemptCookie, browserToken, attemptSeconds)]);
}

export async function googleIdentity(token: string, nonce: string, settings: GoogleSettings) {
  const jwks = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"), { timeoutDuration: 8000 });
  const { payload } = await jwtVerify(token, jwks, {
    algorithms: ["RS256"], issuer: ["https://accounts.google.com", "accounts.google.com"], audience: settings.clientId,
    requiredClaims: ["sub", "iat", "exp", "nonce"], maxTokenAge: "10m", clockTolerance: "30s",
  });
  const multipleAudiences = Array.isArray(payload.aud) && payload.aud.length > 1;
  if (typeof payload.sub !== "string" || !payload.sub || payload.nonce !== nonce) return null;
  if ((payload.azp !== undefined || multipleAudiences) && payload.azp !== settings.clientId) return null;
  if (payload.email_verified !== true || typeof payload.email !== "string") return null;
  const email = payload.email.trim().toLowerCase();
  // Google is authoritative for Gmail and hosted Workspace accounts. A
  // verified third-party address can change owners outside Google.
  if (!email.endsWith("@gmail.com") && !(typeof payload.hd === "string" && payload.hd)) return null;
  const name = typeof payload.name === "string" ? payload.name.trim().slice(0, 100) : "";
  return { email, name: name || email };
}

type Authorize = (staff: StaffIdentity) => Promise<Brokerage[]>;

async function completeGoogle(request: Request, url: URL, settings: GoogleSettings, store: StaffAuthStore, authorize: Authorize) {
  const cleared = cookie(attemptCookie, "", 0);
  const restart = (brokerageId: string | null = null) => redirect(staffLoginUrl(brokerageId, "restart"), [cleared]);
  const browser = readCookie(request, attemptCookie);
  const state = url.searchParams.get("state");
  if (!browser || !state || !opaqueToken.test(state)) return restart();
  const attempt = await store.consumeGoogle(state, await hash(browser), Date.now());
  const brokerageId = safeBrokerageId(attempt?.brokerageId ?? null);
  const code = url.searchParams.get("code");
  if (!attempt || !code || code.length > 4096 || url.searchParams.has("error")) return restart(brokerageId);

  try {
    // Workers rejects redirect: "error". Reject non-OK responses without following redirects.
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", redirect: "manual", signal: AbortSignal.timeout(8000),
      body: new URLSearchParams({
        grant_type: "authorization_code", code, redirect_uri: new URL(googleCallback, url.origin).href,
        client_id: settings.clientId, client_secret: settings.clientSecret, code_verifier: attempt.verifier,
      }),
    });
    if (!response.ok) return restart(brokerageId);
    const token: unknown = await response.json();
    if (!token || typeof token !== "object" || !("id_token" in token) || typeof token.id_token !== "string") return restart(brokerageId);
    const identity = await googleIdentity(token.id_token, attempt.nonce, settings);
    const brokerages = identity ? await authorize(identity) : [];
    if (!identity || !brokerages.length || (brokerageId && !brokerages.some((item) => item.id === brokerageId))) {
      return redirect(staffLoginUrl(brokerageId, "denied"), [cleared]);
    }
    const session = randomToken();
    const now = Date.now();
    const previous = readCookie(request, sessionCookie);
    if (previous) await store.removeStaffSession(await hash(previous));
    await store.createStaffSession(await hash(session), identity, now + sessionSeconds * 1000, now);
    return redirect(brokerageId ? brokerageUrl(brokerageId) : "/workspace", [cleared, cookie(sessionCookie, session, sessionSeconds)]);
  } catch {
    return restart(brokerageId);
  }
}

export async function signedInStaff(request: Request, settings: GoogleSettings, store: StaffAuthStore): Promise<StaffIdentity | null> {
  const token = readCookie(request, sessionCookie);
  if (!token || !configured(settings)) return null;
  return store.getStaffSession(await hash(token), Date.now());
}

export async function handleStaffAuth(request: Request, url: URL, settings: GoogleSettings, store: StaffAuthStore, authorize: Authorize) {
  if (url.pathname === "/login" && request.method === "GET") return loginPage(settings, url);
  if (!configured(settings)) return redirect("/login");
  try {
    if (url.pathname === "/auth/google" && request.method === "GET") return await beginGoogle(settings, url, store);
    if (url.pathname === googleCallback && request.method === "GET") return await completeGoogle(request, url, settings, store, authorize);
    if (url.pathname === "/auth/logout" && request.method === "POST") {
      if (request.headers.get("Origin") !== url.origin) return new Response("This action must come from Orbit.", { status: 403, headers: noStore });
      const token = readCookie(request, sessionCookie);
      if (token) await store.removeStaffSession(await hash(token));
      return redirect("/login", [cookie(sessionCookie, "", 0)]);
    }
  } catch {
    if (url.pathname === "/auth/logout") return new Response("Orbit could not sign out. Try again.", { status: 503, headers: noStore });
    return redirect("/login?error=restart", [cookie(attemptCookie, "", 0)]);
  }
  return new Response("Method not allowed.", { status: 405, headers: noStore });
}
