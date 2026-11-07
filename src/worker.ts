import { DurableObject } from "cloudflare:workers";
import { timingSafeEqual } from "node:crypto";
import app from "vinext/server/app-router-entry";
import { executeCommand } from "./lib/commands";
import { borrowerCommandResult } from "./lib/applications";
import { borrowerHttp } from "./lib/borrower-http";
import { initializeStore, workspace, type SqlValue, type Store } from "./lib/store";
import { googleSettings, handleStaffAuth, runtimeSetting, signedInStaff } from "./lib/staff-auth";
import { staffAuthStore, type StaffAuthStore, type StaffIdentity } from "./lib/staff-store";

export class OrbitWorkspace extends DurableObject<Cloudflare.Env> implements StaffAuthStore {
  readonly #store: Store;
  readonly #auth: StaffAuthStore;

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    const storage = ctx.storage;
    const sql = storage.sql;
    this.#store = {
      exec: (query) => { sql.exec(query).toArray(); },
      prepare(query) {
        return {
          get: (...args) => sql.exec<Record<string, SqlValue>>(query, ...args).toArray()[0],
          all: (...args) => sql.exec<Record<string, SqlValue>>(query, ...args).toArray(),
          run: (...args) => { sql.exec(query, ...args).toArray(); },
        };
      },
      transaction: (run) => storage.transactionSync(run),
    };
    initializeStore(this.#store);
    this.#auth = staffAuthStore(this.#store);
  }

  read() {
    return workspace(this.#store);
  }

  async write(input: unknown) {
    return executeCommand(this.#store, input);
  }

  borrower(input: unknown) {
    return borrowerCommandResult(this.#store, input);
  }

  startGoogle(...args: Parameters<StaffAuthStore["startGoogle"]>) { return this.#auth.startGoogle(...args); }
  consumeGoogle(...args: Parameters<StaffAuthStore["consumeGoogle"]>) { return this.#auth.consumeGoogle(...args); }
  createStaffSession(...args: Parameters<StaffAuthStore["createStaffSession"]>) { return this.#auth.createStaffSession(...args); }
  getStaffSession(...args: Parameters<StaffAuthStore["getStaffSession"]>) { return this.#auth.getStaffSession(...args); }
  removeStaffSession(...args: Parameters<StaffAuthStore["removeStaffSession"]>) { return this.#auth.removeStaffSession(...args); }
}

async function authorized(header: string | null, password: string) {
  if (!header || !header.startsWith("Basic ") || header.length > 200) return false;
  const encoder = new TextEncoder();
  const expected = `Basic ${btoa(`orbit:${password}`)}`;
  const [actualHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(header)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  return timingSafeEqual(new Uint8Array(actualHash), new Uint8Array(expectedHash));
}

export default {
  async fetch(request, env, context) {
    const url = new URL(request.url);
    if (url.hostname === "orbitlos.com" && url.protocol !== "https:") {
      url.protocol = "https:";
      return Response.redirect(url, 308);
    }
    const reading = request.method === "GET" || request.method === "HEAD";
    const marketingPage = /^\/(?:product\/?|integrations\/?)?$/.test(url.pathname);
    const publicIcon = url.pathname === "/icon.svg";
    // Public documents render independently of the workspace and sign-in.
    // Forward only the URL and method so routing and action headers cannot
    // change the destination of a public request.
    if (reading && (marketingPage || publicIcon)) {
      return app.fetch(new Request(url, { method: request.method }), env, context);
    }
    // Build assets are shared by the public site and the workspace.
    if (reading && /^\/_next\/static\/(?:css|chunks)\/[\w.-]+\.(?:js|css)$/.test(url.pathname)) {
      return env.ASSETS.fetch(request);
    }
    const google = googleSettings(env);
    const demoPassword = runtimeSetting(env, "DEMO_PASSWORD");
    if (!google && !demoPassword) {
      return new Response("Orbit demo is being configured.", { status: 503, headers: { "Cache-Control": "no-store" } });
    }
    const workspaceStore = () => env.WORKSPACE.getByName("orbit-demo");
    // This endpoint can reach only the token-scoped borrower command.
    if (request.method === "POST" && url.pathname === "/api/demo-application") {
      return borrowerHttp(request, (input) => workspaceStore().borrower(input));
    }
    const borrowerPage = reading && url.pathname === "/apply";
    if (google && ["/login", "/auth/google", "/auth/google/callback", "/auth/logout"].includes(url.pathname)) {
      return handleStaffAuth(request, url, google, workspaceStore());
    }
    let staff: StaffIdentity | null = null;
    if (!borrowerPage) {
      if (google) {
        try { staff = await signedInStaff(request, google, workspaceStore()); }
        catch { return new Response("Orbit sign-in is temporarily unavailable.", { status: 503, headers: { "Cache-Control": "no-store" } }); }
        if (!staff) {
          if (reading) return new Response(null, { status: 303, headers: { Location: "/login", "Cache-Control": "no-store" } });
          return new Response("Sign in to Orbit to continue.", { status: 401, headers: { "Cache-Control": "no-store" } });
        }
      } else if (!(await authorized(request.headers.get("Authorization"), demoPassword))) {
        return new Response("Enter the Orbit demo username and password.", {
          status: 401,
          headers: { "WWW-Authenticate": 'Basic realm="Orbit Demo", charset="UTF-8"', "Cache-Control": "no-store" },
        });
      }
    }
    if (!reading && request.headers.get("Origin") !== url.origin) {
      return new Response("This action must come from Orbit.", { status: 403, headers: { "Cache-Control": "no-store" } });
    }
    const appHeaders = new Headers(request.headers);
    appHeaders.delete("x-orbit-staff-email");
    appHeaders.delete("x-orbit-staff-name");
    if (staff) {
      appHeaders.set("x-orbit-staff-email", encodeURIComponent(staff.email));
      appHeaders.set("x-orbit-staff-name", encodeURIComponent(staff.name.toWellFormed()));
    }
    const response = url.pathname.startsWith("/_next/static/")
      ? await env.ASSETS.fetch(request)
      : await app.fetch(new Request(request, { headers: appHeaders }), env, context);
    const result = new Response(response.body, response);
    result.headers.set("Cache-Control", "private, no-store");
    result.headers.set("X-Robots-Tag", "noindex");
    if (borrowerPage) result.headers.set("Referrer-Policy", "no-referrer");
    return result;
  },
} satisfies ExportedHandler<Cloudflare.Env>;
