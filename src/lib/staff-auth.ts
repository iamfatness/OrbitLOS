import { randomInt } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { GoogleAttempt, StaffAuthStore, StaffEmailProof, StaffIdentity } from "./staff-store";
import { brokerageIdPattern, brokerageUrl, demoBrokerageId, workspaceGuide, type Brokerage } from "./brokerage-model";

import { staffEmail } from "./brokerages";

const attemptCookie = "__Host-orbit-google";
const emailCookie = "__Host-orbit-email";
const emailSessionCookie = "__Host-orbit-email-session";
const sessionCookie = "__Host-orbit-session";
const workspaceCookie = "__Host-orbit-workspace";
const attemptSeconds = 10 * 60;
const sessionSeconds = 8 * 60 * 60;
const opaqueToken = /^[A-Za-z0-9_-]{43}$/;
const googleCallback = "/auth/google/callback";
const emailRequest = "/auth/email/request";
const emailVerify = "/auth/email/verify";
const noStore = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" };

export interface GoogleSettings {
  clientId: string;
  clientSecret: string;
  allowedEmails: Set<string>;
}

export interface StaffEmailAuth {
  reserve(proof: StaffEmailProof): Promise<boolean>;
  consume(proof: StaffEmailProof): Promise<{ brokerageId: string; identity: StaffIdentity } | null>;
  allowRequest(): Promise<boolean>;
  send(email: string, code: string): void;
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

function cookieValue(request: Request, name: string) {
  const pair = request.headers.get("Cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return pair?.slice(name.length + 1);
}

function readCookie(request: Request, name: string) {
  const value = cookieValue(request, name);
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

export async function rememberedStaffWorkspace(request: Request, email: string) {
  const account = await hash(email);
  const selected = safeBrokerageId(cookieValue(request, `${workspaceCookie}-${account}`) ?? null);
  if (selected) return selected;

  const [owner, workspace, extra] = cookieValue(request, workspaceCookie)?.split(".") ?? [];
  if (!owner || !workspace || extra !== undefined || !safeBrokerageId(workspace)) return null;
  return owner === account ? workspace : null;
}

export async function staffWorkspaceCookie(email: string, brokerage: string) {
  return cookie(`${workspaceCookie}-${await hash(email)}`, brokerage, 90 * 24 * 60 * 60);
}

export function staffLoginUrl(brokerageId: string | null = null, error?: "denied" | "restart", guide?: ReturnType<typeof workspaceGuide>) {
  const search = new URLSearchParams();
  if (error) search.set("error", error);
  const target = safeBrokerageId(brokerageId);
  if (target) search.set("brokerage", target);
  if (guide) search.set("guide", guide);
  return search.size ? `/login?${search}` : "/login";
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function loginPage(settings: GoogleSettings, url: URL, emailEnabled: boolean, options: {
  emailForm?: boolean; address?: string; problem?: string; status?: number; cookie?: string;
} = {}) {
  const ready = configured(settings);
  const error = url.searchParams.get("error");
  const brokerageId = safeBrokerageId(url.searchParams.get("brokerage"));
  const guide = workspaceGuide(url.searchParams.get("guide"));
  const start = new URLSearchParams();
  if (brokerageId) start.set("brokerage", brokerageId);
  if (guide) start.set("guide", guide);
  const context = start.size ? `?${escapeHtml(start.toString())}` : "";
  const emailLink = `/login?${context ? `${context.slice(1)}&amp;` : ""}method=email`;
  const emailForm = ready && emailEnabled && (options.emailForm || url.searchParams.get("method") === "email");
  const address = options.address ? escapeHtml(options.address) : "";
  const enteringCode = emailForm && !!address;
  const message = options.problem ?? (!ready ? "Orbit staff sign-in is being configured."
    : error === "denied" ? (brokerageId ? "This Google account doesn’t have access to this brokerage." : "This Google account hasn’t been approved for Orbit.")
    : error ? "The sign-in attempt ended. Start again to continue." : "");
  const recoveryMessage = error === "denied" && !options.problem ? `${message} Ask your brokerage admin to confirm your invitation.` : message;
  const methods = ready ? (emailForm ? `
<form method="post" action="${enteringCode ? emailVerify : emailRequest}${context}">
${enteringCode ? `<input type="hidden" name="email" value="${address}">
<label for="code">Verification code</label>
<input id="code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required autofocus>
<button type="submit">Verify and sign in</button>
<div class="recovery"><button type="submit" class="text-action" formnovalidate formaction="${emailRequest}${context}">Resend code</button><a href="${emailLink}">Use a different email</a></div>` : `
<label for="email">Email address</label>
<input id="email" name="email" type="email" autocomplete="email" maxlength="254" required autofocus>
<button type="submit">Send sign-in code</button>`}
</form>
<a class="secondary" href="/auth/google${context}">Continue with Google</a>` : `
<a class="primary" href="/auth/google${context}">${error === "denied" ? "Choose another Google account" : "Continue with Google"}</a>
${emailEnabled ? `<a class="secondary" href="${emailLink}">Sign in with an email code</a>` : ""}
${brokerageId ? `<div class="recovery"><a href="/workspace">Open my available workspace</a></div>` : ""}`) : "";
  const headers = new Headers({
    ...noStore, "Content-Type": "text/html; charset=utf-8",
    "Referrer-Policy": "same-origin",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  });
  if (options.cookie) headers.append("Set-Cookie", options.cookie);
  return new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sign in · OrbitLOS</title>
<style>
@font-face{font-family:Inter;src:url('/fonts/InterVariable.woff2') format('woff2');font-style:normal;font-weight:100 900;font-display:swap}
*{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;background:#211833;color:#2d1b4b;font:16px/1.5 Inter,'Segoe UI',system-ui,sans-serif;padding:16px}
main{width:min(100%,440px);background:#fff;border-radius:12px;padding:clamp(20px,6vw,32px);box-shadow:0 18px 50px #120a2560}
h1{margin:0;font-size:clamp(26px,7vw,32px);font-weight:650;letter-spacing:-.03em}p{color:#686177;margin:8px 0 16px;overflow-wrap:anywhere}
label{display:block;font-weight:600;margin-bottom:4px}input,button{font:inherit}input{width:100%;min-height:44px;padding:8px 12px;border:1px solid #81768f;border-radius:8px;color:#252235}
.primary,.secondary,button{display:block;width:100%;min-height:44px;text-align:center;text-decoration:none;border:1px solid transparent;border-radius:8px;font-weight:600;padding:9px 12px;margin-top:12px;cursor:pointer}
.primary,button{background:#6749d3;color:white}.primary:hover,button:hover{background:#5539b9}
.secondary{border-color:#81768f;color:#2d1b4b}.secondary:hover{background:#f4efff}
a:focus-visible,button:focus-visible,input:focus-visible{outline:2px solid #6749d3;outline-offset:3px}
.status{border-radius:8px;background:#f4efff;padding:8px 12px;color:#2d1b4b}
.address{display:block;margin-bottom:8px;color:#2d1b4b}
.recovery{display:flex;flex-wrap:wrap;gap:0 16px;align-items:center;margin-top:4px}
.recovery a,.text-action{display:inline-flex;align-items:center;width:auto;min-height:44px;margin:0;padding:0;color:#5134ad;background:transparent;border:0;text-decoration:underline;font-size:14px;font-weight:600}
.text-action:hover{background:transparent;color:#2d1b4b}
</style></head><body><main><h1>${enteringCode ? "Check your email" : "Sign in to OrbitLOS"}</h1>
<p>${enteringCode ? `<strong class="address">${address}</strong>If this address has Orbit access, a code will arrive shortly. It expires in 10 minutes. Wait a minute before resending.`
    : emailForm ? "Enter the email address your brokerage invited." : "Use the account approved by your brokerage."}</p>
${recoveryMessage ? `<p class="status" role="alert">${recoveryMessage}</p>` : ""}
${methods}</main></body></html>`, { status: options.status ?? (ready ? 200 : 503), headers });
}

export function workspaceAccessDenied(brokerageId: string | null, guide?: ReturnType<typeof workspaceGuide>, remembered = false) {
  return staffEntryPage({ title: "Workspace access unavailable",
    description: remembered ? "Your signed-in account no longer has access to the last workspace you opened." :
      "Your signed-in account cannot open this brokerage. The link may be for another team, or your access may have changed.",
    message: "Ask your brokerage admin to confirm the Google email on your invitation. You can still open any workspace you have access to.",
    primary: { href: remembered ? "/workspace?available=1" : "/workspace", label: "Open my available workspace" },
    secondary: { href: staffLoginUrl(brokerageId, undefined, guide).replaceAll("&", "&amp;"), label: "Use a different Google account" },
  }, 403);
}

export function closedReleaseWorkspacePage() {
  return staffEntryPage({ title: "Release test closed",
    description: "This temporary workspace has closed and its records are retained.", message: "",
    primary: { href: "/workspace", label: "Open my workspace" },
  }, 403);
}

export function workspaceMaintenancePage(brokerage: Brokerage, alternateId?: string) {
  return staffEntryPage({title:"Workspace paused",description:"Your brokerage is reviewing this workspace before reopening it.",
    message:"Saved work is retained. New workspace actions and portal updates are temporarily unavailable.",
    primary:brokerage.role === "Admin" && brokerage.pilot ? {href:`/workspace-maintenance?brokerage=${brokerage.id}`,label:"Open maintenance review"} :
      {href:brokerageUrl(brokerage.id),label:"Check again"},
    secondary:alternateId ? {href:brokerageUrl(alternateId),label:"Open another available workspace"} : undefined},503);
}

function staffEntryPage({ title, description, message, primary, secondary }: {
  title: string; description: string; message: string;
  primary?: { href: string; label: string }; secondary?: { href: string; label: string };
}, status: number) {
  return new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} · OrbitLOS</title>
<style>
@font-face{font-family:Inter;src:url('/fonts/InterVariable.woff2') format('woff2');font-style:normal;font-weight:100 900;font-display:swap}
*{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;background:#211833;color:#2d1b4b;font:16px/1.5 Inter,'Segoe UI',system-ui,sans-serif;padding:16px}
main{width:min(100%,440px);background:#fff;border:1px solid #ded3f4;border-radius:12px;padding:clamp(20px,6vw,32px);box-shadow:0 18px 50px #120a2560}
small{font-weight:600;color:#6042bf}h1{margin:8px 0;font-size:clamp(26px,7vw,32px);font-weight:650;letter-spacing:-.035em}p{color:#686177}
a{display:block;min-height:44px;background:#6749d3;color:white;text-align:center;text-decoration:none;border-radius:8px;font-weight:600;padding:10px;margin-top:16px}
a:hover{background:#5539b9}a.secondary{background:#f4efff;color:#493191}a:focus-visible{outline:2px solid #6749d3;outline-offset:3px}.status{border-radius:8px;background:#f4efff;padding:8px 10px}
</style></head><body><main><small>Brokerage workspace</small><h1>${title}</h1><p>${description}</p>
${message ? `<p class="status" role="alert">${message}</p>` : ""}
${primary ? `<a href="${primary.href}">${primary.label}</a>` : ""}
${secondary ? `<a class="secondary" href="${secondary.href}">${secondary.label}</a>` : ""}</main></body></html>`, {
    status,
    headers: {
      ...noStore, "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'",
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
    guide: workspaceGuide(url.searchParams.get("guide")),
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

async function clearStaffSessions(request: Request, store: StaffAuthStore) {
  for (const tokenHash of await staffSessionHashes(request)) await store.removeStaffSession(tokenHash);
}

async function staffSessionHashes(request: Request) {
  const google = readCookie(request, sessionCookie);
  const email = readCookie(request, emailSessionCookie);
  // A Worker rolled back to Google-only sign-in cannot resolve email sessions.
  return Promise.all([...(google ? [hash(google)] : []), ...(email ? [hash(`email-session:${email}`)] : [])]);
}

async function signIn(request: Request, store: StaffAuthStore, identity: StaffIdentity, location: string, method: "google" | "email") {
  const session = randomToken();
  const now = Date.now();
  await clearStaffSessions(request, store);
  const google = method === "google";
  await store.createStaffSession(await hash(google ? session : `email-session:${session}`), identity, now + sessionSeconds * 1000, now, method);
  return redirect(location, [cookie(attemptCookie, "", 0), cookie(emailCookie, "", 0),
    cookie(google ? emailSessionCookie : sessionCookie, "", 0), cookie(google ? sessionCookie : emailSessionCookie, session, sessionSeconds)]);
}


async function completeGoogle(request: Request, url: URL, settings: GoogleSettings, store: StaffAuthStore, authorize: Authorize) {
  const cleared = cookie(attemptCookie, "", 0);
  const restart = (brokerageId: string | null = null, guide?: ReturnType<typeof workspaceGuide>) =>
    redirect(staffLoginUrl(brokerageId, "restart", guide), [cleared]);
  const browser = readCookie(request, attemptCookie);
  const state = url.searchParams.get("state");
  if (!browser || !state || !opaqueToken.test(state)) return restart();
  const attempt = await store.consumeGoogle(state, await hash(browser), Date.now());
  const brokerageId = safeBrokerageId(attempt?.brokerageId ?? null);
  const guide = workspaceGuide(attempt?.guide);
  const code = url.searchParams.get("code");
  if (!attempt || !code || code.length > 4096 || url.searchParams.has("error")) return restart(brokerageId, guide);

  try {
    // Workers rejects redirect: "error". Reject non-OK responses without following redirects.
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", redirect: "manual", signal: AbortSignal.timeout(8000),
      body: new URLSearchParams({
        grant_type: "authorization_code", code, redirect_uri: new URL(googleCallback, url.origin).href,
        client_id: settings.clientId, client_secret: settings.clientSecret, code_verifier: attempt.verifier,
      }),
    });
    if (!response.ok) return restart(brokerageId, guide);
    const token: unknown = await response.json();
    if (!token || typeof token !== "object" || !("id_token" in token) || typeof token.id_token !== "string") return restart(brokerageId, guide);
    const identity = await googleIdentity(token.id_token, attempt.nonce, settings);
    const brokerages = identity ? await authorize(identity) : [];
    if (!identity || !brokerages.length || (brokerageId && !brokerages.some((item) => item.id === brokerageId))) {
      return redirect(staffLoginUrl(brokerageId, "denied", guide), [cleared]);
    }
    return await signIn(request, store, identity, brokerageId || guide ? brokerageUrl(brokerageId ?? demoBrokerageId, guide) : "/workspace", "google");
  } catch {
    return restart(brokerageId, guide);
  }
}

async function readEmailForm(request: Request) {
  if (request.headers.get("Content-Type")?.split(";")[0] !== "application/x-www-form-urlencoded") return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder();
  let body = "";
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return new URLSearchParams(body + decoder.decode());
      bytes += value.byteLength;
      if (bytes > 4096) { await reader.cancel(); return null; }
      body += decoder.decode(value, { stream: true });
    }
  } finally { reader.releaseLock(); }
}

async function emailSignIn(request: Request, url: URL, settings: GoogleSettings, store: StaffAuthStore, emailAuth: StaffEmailAuth) {
  if (request.headers.get("Origin") !== url.origin) return new Response("Open the sign-in form on Orbit.", { status: 403, headers: noStore });
  const form = await readEmailForm(request);
  const address = staffEmail.safeParse(form?.get("email"));
  if (!address.success) return loginPage(settings, url, true, { emailForm: true, problem: "Enter a valid email address.", status: 400 });

  const brokerageId = safeBrokerageId(url.searchParams.get("brokerage"));
  const browser = readCookie(request, emailCookie);
  const now = Date.now();
  if (url.pathname === emailRequest) {
    if (!await emailAuth.allowRequest()) return loginPage(settings, url, true, {
      emailForm: true, address: browser ? address.data : undefined, problem: "Too many requests. Wait a minute and try again.", status: 429,
    });
    const token = browser ?? randomToken();
    const code = String(randomInt(1_000_000)).padStart(6, "0");
    // The browser token stays out of storage, so a stored digest cannot be searched for all six-digit codes.
    const [browserHash, codeHash] = await Promise.all([hash(token), hash(`${token}:${code}`)]);
    if (await emailAuth.reserve({ email: address.data, brokerageId, browserHash, codeHash, now })) emailAuth.send(address.data, code);
    return loginPage(settings, url, true, { emailForm: true, address: address.data, cookie: cookie(emailCookie, token, attemptSeconds) });
  }

  const code = form?.get("code")?.trim() ?? "";
  if (browser && /^[0-9]{6}$/.test(code)) {
    const [browserHash, codeHash] = await Promise.all([hash(browser), hash(`${browser}:${code}`)]);
    const result = await emailAuth.consume({ email: address.data, brokerageId, browserHash, codeHash, now });
    if (result) {
      const guide = workspaceGuide(url.searchParams.get("guide"));
      const destination = brokerageId || guide ? brokerageUrl(result.brokerageId, guide) : "/workspace";
      return signIn(request, store, result.identity, destination, "email");
    }
  }
  return loginPage(settings, url, true, {
    emailForm: true, address: address.data, problem: "This code couldn’t be verified. Check the latest code in your inbox or request a new one.", status: 400,
  });
}

export async function staffSessionHash(request: Request, settings: GoogleSettings): Promise<string | null> {
  if (!configured(settings)) return null;
  return (await staffSessionHashes(request))[0] ?? null;
}

export async function handleStaffAuth(request: Request, url: URL, settings: GoogleSettings, store: StaffAuthStore, authorize: Authorize, emailAuth?: StaffEmailAuth) {
  if (url.pathname === "/login" && request.method === "GET") return loginPage(settings, url, !!emailAuth);
  if (!configured(settings)) return redirect("/login");
  if (url.pathname === emailRequest || url.pathname === emailVerify) {
    if (request.method !== "POST") return new Response("Method not allowed.", { status: 405, headers: { ...noStore, Allow: "POST" } });
    if (!emailAuth) return redirect(staffLoginUrl(safeBrokerageId(url.searchParams.get("brokerage")), undefined, workspaceGuide(url.searchParams.get("guide"))));
    try { return await emailSignIn(request, url, settings, store, emailAuth); }
    catch { return loginPage(settings, url, true, { emailForm: true, problem: "Email sign-in is temporarily unavailable. Try again in a minute.", status: 503 }); }
  }
  try {
    if (url.pathname === "/auth/google" && request.method === "GET") return await beginGoogle(settings, url, store);
    if (url.pathname === googleCallback && request.method === "GET") return await completeGoogle(request, url, settings, store, authorize);
    if (url.pathname === "/auth/logout" && request.method === "POST") {
      if (request.headers.get("Origin") !== url.origin) return new Response("This action must come from Orbit.", { status: 403, headers: noStore });
      await clearStaffSessions(request, store);
      return redirect("/login", [cookie(sessionCookie, "", 0), cookie(emailSessionCookie, "", 0), cookie(emailCookie, "", 0)]);
    }
  } catch {
    if (url.pathname === "/auth/logout") return new Response("Orbit could not sign out. Try again.", { status: 503, headers: noStore });
    return redirect("/login?error=restart", [cookie(attemptCookie, "", 0)]);
  }
  return new Response("Method not allowed.", { status: 405, headers: noStore });
}
