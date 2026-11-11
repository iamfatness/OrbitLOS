import { createRemoteJWKSet, jwtVerify } from "jose";
import type { GoogleAttempt, StaffAuthStore, StaffIdentity } from "./staff-store";
import { brokerageIdPattern, brokerageUrl, demoBrokerageId, workspaceGuide, type Brokerage } from "./brokerage-model";

const attemptCookie = "__Host-orbit-google";
const sessionCookie = "__Host-orbit-session";
const workspaceCookie = "__Host-orbit-workspace";
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

function loginPage(settings: GoogleSettings, url: URL) {
  const ready = configured(settings);
  const error = url.searchParams.get("error");
  const brokerageId = safeBrokerageId(url.searchParams.get("brokerage"));
  const guide = workspaceGuide(url.searchParams.get("guide"));
  const start = new URLSearchParams();
  if (brokerageId) start.set("brokerage", brokerageId);
  if (guide) start.set("guide", guide);
  const startUrl = start.size ? `/auth/google?${start.toString().replaceAll("&", "&amp;")}` : "/auth/google";
  const message = !ready ? "Orbit staff sign-in is being configured."
    : error === "denied" ? (brokerageId ? "This Google account doesn’t have access to this brokerage." : "This Google account hasn’t been approved for Orbit.")
    : error ? "The sign-in attempt ended. Start again to continue." : "";
  return staffEntryPage({ title: "Sign in to OrbitLOS",
    description: brokerageId ? "Use the exact Google email your brokerage invited. Your invitation activates when you sign in." : "Use the Google account approved by your brokerage.",
    message: error === "denied" ? `${message} Ask your brokerage admin to confirm your invitation, or choose a different Google account.` : message,
    primary: ready ? { href: startUrl, label: error === "denied" ? "Choose another Google account" : "Continue with Google" } : undefined,
    secondary: brokerageId ? { href: "/workspace", label: "Open my available workspace" } : undefined,
  }, ready ? 200 : 503);
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

export function workspaceMaintenancePage(brokerage: Brokerage, canSwitch = false) {
  return staffEntryPage({title:"Workspace paused",description:"Your brokerage is reviewing this workspace before reopening it.",
    message:"Saved work is retained. New workspace actions and portal updates are temporarily unavailable.",
    primary:brokerage.role === "Admin" && brokerage.pilot ? {href:`/workspace-maintenance?brokerage=${brokerage.id}`,label:"Open maintenance review"} :
      {href:brokerageUrl(brokerage.id),label:"Check again"},
    secondary:canSwitch ? {href:"/workspace?available=1",label:"Open another available workspace"} : undefined},503);
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
    const session = randomToken();
    const now = Date.now();
    const previous = readCookie(request, sessionCookie);
    if (previous) await store.removeStaffSession(await hash(previous));
    await store.createStaffSession(await hash(session), identity, now + sessionSeconds * 1000, now);
    return redirect(brokerageId || guide ? brokerageUrl(brokerageId ?? demoBrokerageId, guide) : "/workspace", [cleared, cookie(sessionCookie, session, sessionSeconds)]);
  } catch {
    return restart(brokerageId, guide);
  }
}

export async function staffSessionHash(request: Request, settings: GoogleSettings): Promise<string | null> {
  const token = readCookie(request, sessionCookie);
  if (!token || !configured(settings)) return null;
  return hash(token);
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
